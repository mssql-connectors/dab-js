import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomInt, randomUUID } from "node:crypto";
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
const sessionCookie = "dab_chat_session";
const sessionTtlMs = 15 * 60 * 1000;

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

export async function verifyTurnstile({
  token,
  secret,
  remoteIp,
  expectedHostname,
  expectedAction = "chat",
  fetcher = fetch
}) {
  if (!token || token.length > 2048) return false;
  const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: remoteIp,
      idempotency_key: randomUUID()
    })
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true
    && (!expectedAction || result.action === expectedAction)
    && (!expectedHostname || result.hostname === expectedHostname);
}

function readJson(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", chunk => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function getCookie(request, name) {
  for (const value of (request.headers.cookie ?? "").split(";")) {
    const [key, ...parts] = value.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
}

export function createChatServer({
  dabUrl = process.env.DAB_URL ?? "http://localhost:5002/api",
  maxConnectionsPerIp = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 5),
  maxVerificationsPerIp = Number(process.env.MAX_VERIFICATIONS_PER_IP ?? 10),
  trustCloudflare = process.env.TRUST_CLOUDFLARE === "true",
  secureCookies = process.env.COOKIE_SECURE !== "false",
  turnstileSiteKey = process.env.TURNSTILE_SITE_KEY,
  turnstileSecret = process.env.TURNSTILE_SECRET_KEY,
  turnstileHostname = process.env.TURNSTILE_HOSTNAME,
  turnstileAction = process.env.TURNSTILE_ACTION ?? "chat",
  allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "http://localhost:4175").split(",").map(value => value.trim())
  )
} = {}) {
  if (!Number.isInteger(maxConnectionsPerIp) || maxConnectionsPerIp < 1) {
    throw new Error("MAX_CONNECTIONS_PER_IP must be a positive integer.");
  }
  if (!Number.isInteger(maxVerificationsPerIp) || maxVerificationsPerIp < 1) {
    throw new Error("MAX_VERIFICATIONS_PER_IP must be a positive integer.");
  }
  if (!turnstileSiteKey || !turnstileSecret) {
    throw new Error("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required.");
  }
  turnstileSiteKey = turnstileSiteKey.trim();
  turnstileSecret = turnstileSecret.trim();
  turnstileHostname = turnstileHostname?.trim();
  turnstileAction = turnstileAction.trim();

  const filter = new Profanity({
    languages: (process.env.PROFANITY_LANGUAGES ?? "en").split(",").map(value => value.trim())
  });
  const dab = createDabClient(dabUrl);
  const connectionsByIp = new Map();
  const verificationsByIp = new Map();
  const sessions = new Map();
  function getSession(request) {
    const id = getCookie(request, sessionCookie);
    const session = sessions.get(id);
    const ip = getClientIp(request, trustCloudflare);
    if (!session || session.ip !== ip) {
      return;
    }
    if (session.expiresAt <= Date.now()) {
      sessions.delete(id);
      return;
    }
    return session;
  }

  const server = createServer(async (request, response) => {
    if (request.url === "/chat/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }

    if (request.method === "GET" && request.url === "/chat/config") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        turnstileSiteKey,
        verified: Boolean(getSession(request))
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/chat/verify") {
      try {
        const ip = getClientIp(request, trustCloudflare);
        const now = Date.now();
        const window = verificationsByIp.get(ip);
        if (!window || now - window.startedAt >= 60000) {
          verificationsByIp.set(ip, { count: 1, startedAt: now });
        } else {
          window.count += 1;
          if (window.count > maxVerificationsPerIp) {
            response.writeHead(429, { "Content-Type": "application/json" });
            response.end('{"error":"Verification rate limit exceeded."}');
            return;
          }
        }

        const { token } = await readJson(request);
        const verified = await verifyTurnstile({
          token,
          secret: turnstileSecret,
          remoteIp: ip,
          expectedHostname: turnstileHostname,
          expectedAction: turnstileAction
        });
        if (!verified) {
          response.writeHead(403, { "Content-Type": "application/json" });
          response.end('{"error":"Verification failed."}');
          return;
        }

        const session = randomUUID();
        sessions.set(session, { ip, expiresAt: Date.now() + sessionTtlMs });
        response.writeHead(204, {
          "Cache-Control": "no-store",
          "Set-Cookie": `${sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/chat; Max-Age=900${secureCookies ? "; Secure" : ""}`
        });
        response.end();
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    const file = staticFiles.get(new URL(request.url, "http://localhost").pathname);
    if (request.method !== "GET" || !file) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com wss:; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
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
    const session = getSession(request);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const connectionCount = connectionsByIp.get(ip) ?? 0;
    if (connectionCount >= maxConnectionsPerIp) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    connectionsByIp.set(ip, connectionCount + 1);
    sockets.handleUpgrade(request, socket, head, webSocket => {
      webSocket.clientIp = ip;
      webSocket.sessionExpiresAt = session.expiresAt;
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
    const now = Date.now();
    for (const [ip, window] of verificationsByIp) {
      if (now - window.startedAt >= 60000) verificationsByIp.delete(ip);
    }
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
    for (const socket of sockets.clients) {
      if (!socket.isAlive || socket.sessionExpiresAt <= now) {
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
