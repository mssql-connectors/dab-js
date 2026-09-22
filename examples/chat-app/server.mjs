import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomInt } from "node:crypto";
import { Profanity } from "@2toad/profanity";
import { createDabClient } from "@mssql-connectors/dab-js";
import { WebSocket, WebSocketServer } from "ws";

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
const staticFiles = new Map([
  ["/chat", "index.html"],
  ["/chat/", "index.html"],
  ["/chat/app.js", "app.js"],
  ["/chat/styles.css", "styles.css"]
]);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);
const adjectives = ["brave", "bright", "calm", "clever", "kind", "lively", "swift", "witty"];
const animals = ["badger", "falcon", "fox", "otter", "panda", "raven", "tiger", "wolf"];

export function generateGuestName(pick = randomInt) {
  return `${adjectives[pick(adjectives.length)]}-${animals[pick(animals.length)]}`;
}

export function parseChatMessage(raw, filter) {
  let value;
  try {
    value = JSON.parse(raw.toString());
  } catch {
    throw new Error("Messages must be valid JSON.");
  }

  const author = typeof value.author === "string" ? value.author.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (value.type !== "send" || !author || !body) {
    throw new Error("A message requires an author and body.");
  }
  if (author.length > 50 || body.length > 1000) {
    throw new Error("Authors are limited to 50 characters and messages to 1000.");
  }
  if (filter?.exists(author) || filter?.exists(body)) {
    throw new Error("Please keep names and messages appropriate.");
  }
  return { author, body };
}

export function getClientIp(request, trustCloudflare) {
  const forwarded = request.headers["cf-connecting-ip"];
  if (trustCloudflare && typeof forwarded === "string" && isIP(forwarded)) {
    return forwarded;
  }
  return request.socket.remoteAddress ?? "unknown";
}

export function createChatServer({
  dabUrl = process.env.DAB_URL ?? "http://localhost:5002/api",
  maxConnectionsPerIp = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 5),
  trustCloudflare = process.env.TRUST_CLOUDFLARE === "true",
  allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "http://localhost:4175").split(",").map(value => value.trim())
  )
} = {}) {
  if (!Number.isInteger(maxConnectionsPerIp) || maxConnectionsPerIp < 1) {
    throw new Error("MAX_CONNECTIONS_PER_IP must be a positive integer.");
  }

  const filter = new Profanity({
    languages: (process.env.PROFANITY_LANGUAGES ?? "en").split(",").map(value => value.trim())
  });
  const dab = createDabClient(dabUrl);
  const connectionsByIp = new Map();
  const server = createServer((request, response) => {
    if (request.url === "/chat/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }

    const file = staticFiles.get(new URL(request.url, "http://localhost").pathname);
    if (request.method !== "GET" || !file) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": contentTypes.get(extname(file)),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(join(publicDirectory, file)).pipe(response);
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  let writes = Promise.resolve();

  async function loadMessages() {
    const result = await dab
      .entity("messages")
      .orderBy("createdAt", "desc")
      .first(100)
      .get();
    if (!result.ok) {
      throw new Error(`DAB ${result.error.status}: ${result.error.message}`);
    }
    return result.value.reverse();
  }

  function send(socket, value) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(value));
    }
  }

  async function broadcastMessages() {
    const payload = JSON.stringify({ type: "messages", messages: await loadMessages() });
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/chat/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const ip = getClientIp(request, trustCloudflare);
    const connectionCount = connectionsByIp.get(ip) ?? 0;
    if (connectionCount >= maxConnectionsPerIp) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    connectionsByIp.set(ip, connectionCount + 1);
    sockets.handleUpgrade(request, socket, head, webSocket => {
      webSocket.clientIp = ip;
      sockets.emit("connection", webSocket);
    });
  });

  sockets.on("connection", socket => {
    socket.isAlive = true;
    socket.messageWindow = { count: 0, startedAt: Date.now() };
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("close", () => {
      const count = connectionsByIp.get(socket.clientIp) ?? 1;
      if (count <= 1) connectionsByIp.delete(socket.clientIp);
      else connectionsByIp.set(socket.clientIp, count - 1);
    });

    loadMessages()
      .then(messages => send(socket, {
        type: "messages",
        author: generateGuestName(),
        messages
      }))
      .catch(error => send(socket, { type: "error", message: error.message }));

    socket.on("message", raw => {
      const now = Date.now();
      if (now - socket.messageWindow.startedAt >= 10000) {
        socket.messageWindow = { count: 0, startedAt: now };
      }
      socket.messageWindow.count += 1;
      if (socket.messageWindow.count > 10) {
        send(socket, { type: "error", message: "Message rate limit exceeded." });
        socket.close(1008, "Message rate limit exceeded.");
        return;
      }

      writes = writes
        .then(async () => {
          const message = parseChatMessage(raw, filter);
          const result = await dab.entity("messages").create(message);
          if (!result.ok) {
            throw new Error(`DAB ${result.error.status}: ${result.error.message}`);
          }
          await broadcastMessages();
        })
        .catch(error => send(socket, { type: "error", message: error.message }));
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.on("close", () => clearInterval(heartbeat));

  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 4175);
  const host = process.env.HOST ?? "0.0.0.0";
  createChatServer().listen(port, host, () => {
    console.log(`DAB chat listening on http://${host}:${port}/chat`);
  });
}
