import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { syncGitHub } from "./sync.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const readDabUrl = (process.env.READ_DAB_URL ?? "http://localhost:5004/api").replace(/\/$/, "");
const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 900000);
const state = {
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null
};

async function runSync() {
  if (state.running) return;
  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  try {
    const result = await syncGitHub({
      token: process.env.GITHUB_TOKEN,
      login: process.env.GITHUB_LOGIN,
      dabUrl: process.env.SYNC_DAB_URL ?? "http://localhost:5003/api",
      onProgress: progress => {
        console.log(`Synced ${progress.completed}/${progress.total}: ${progress.repository}#${progress.number}`);
      }
    });
    state.lastCompletedAt = new Date().toISOString();
    console.log(`GitHub sync complete: ${result.threadCount} threads, ${result.eventCount} events`);
  } catch (error) {
    state.lastError = error.message;
    console.error(`GitHub sync failed: ${error.message}`);
    if (process.argv.includes("--sync-once")) process.exitCode = 1;
  } finally {
    state.running = false;
  }
}

async function proxyDab(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  const suffix = request.url.slice("/github/api".length);
  if (!suffix.startsWith("/") || suffix.includes("..")) {
    response.writeHead(400).end();
    return;
  }
  const upstream = await fetch(`${readDabUrl}${suffix}`, {
    headers: { Accept: "application/json" }
  });
  const text = await upstream.text();
  let body = text;
  if (upstream.headers.get("content-type")?.includes("application/json")) {
    const value = JSON.parse(text);
    if (value.nextLink) {
      const next = new URL(value.nextLink, readDabUrl);
      value.nextLink = `/github/api${next.pathname.replace(/^\/api/, "")}${next.search}`;
    }
    body = JSON.stringify(value);
  }
  response.writeHead(upstream.status, {
    "Cache-Control": "no-store",
    "Content-Type": upstream.headers.get("content-type") ?? "application/json"
  });
  response.end(body);
}

function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const relative = url.pathname === "/github" || url.pathname === "/github/"
    ? "index.html"
    : url.pathname.replace(/^\/github\//, "");
  const file = normalize(join(dist, relative));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const contentType = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"]
  ]).get(extname(file)) ?? "application/octet-stream";
  response.writeHead(200, {
    "Cache-Control": relative === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  createReadStream(file).pipe(response);
}

if (process.argv.includes("--sync-once")) {
  await runSync();
  process.exit(process.exitCode ?? 0);
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/github/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }
    if (request.url.startsWith("/github/api/")) {
      await proxyDab(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    console.error(error);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Dashboard backend unavailable." }));
  }
});

const port = Number(process.env.PORT ?? 4177);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`GitHub activity dashboard listening on http://localhost:${port}/github`);
});
void runSync();
setInterval(runSync, intervalMs).unref();
