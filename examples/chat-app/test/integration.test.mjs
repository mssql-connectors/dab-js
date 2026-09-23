import assert from "node:assert/strict";
import test from "node:test";
import { createDabClient } from "@mssql-connectors/dab-js";
import WebSocket from "ws";

const socketUrl = process.env.CHAT_URL ?? "ws://localhost:4175/chat/ws";
const verifyUrl = process.env.CHAT_VERIFY_URL
  ?? socketUrl.replace(/^ws/, "http").replace(/\/ws$/, "/verify");
const origin = new URL(socketUrl);
origin.protocol = origin.protocol === "wss:" ? "https:" : "http:";
origin.pathname = "";
const turnstileToken = process.env.TURNSTILE_TEST_TOKEN ?? "XXXX.DUMMY.TOKEN.XXXX";
const dab = createDabClient(process.env.DAB_URL ?? "http://localhost:5002/api");

async function openClient(options = {}) {
  const headers = { ...options.headers };
  headers.Cookie = await authorize(headers["CF-Connecting-IP"]);
  headers.Origin = origin.origin;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, { ...options, headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function authorize(ip) {
  const verification = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ip
        ? { "CF-Connecting-IP": ip }
        : {})
    },
    body: JSON.stringify({ token: turnstileToken })
  });
  assert.equal(verification.status, 204);
  const setCookie = verification.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  return setCookie.split(";")[0];
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for chat update.")), 10000);
    const listener = raw => {
      const value = JSON.parse(raw.toString());
      if (predicate(value)) {
        clearTimeout(timeout);
        socket.off("message", listener);
        resolve(value);
      }
    };
    socket.on("message", listener);
  });
}

function closeClient(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise(resolve => {
    socket.once("close", resolve);
    socket.close();
  });
}

test("broadcasts a DAB-persisted message to connected clients", async () => {
  const first = await openClient();
  const second = await openClient();
  const body = `integration-${Date.now()}`;

  try {
    const firstUpdate = waitForMessage(first, value =>
      value.type === "messages" && value.messages.some(message => message.body === body)
    );
    const secondUpdate = waitForMessage(second, value =>
      value.type === "messages" && value.messages.some(message => message.body === body)
    );
    first.send(JSON.stringify({ type: "send", author: "CI", body }));

    const [left, right] = await Promise.all([firstUpdate, secondUpdate]);
    const persisted = left.messages.find(message => message.body === body);
    assert.ok(persisted);
    assert.ok(right.messages.some(message => message.id === persisted.id));

    const rejected = waitForMessage(first, value =>
      value.type === "error" && value.message.includes("appropriate")
    );
    first.send(JSON.stringify({ type: "send", author: "CI", body: "big butts" }));
    await rejected;

    const deletion = await dab.entity("messages").key("id", persisted.id).delete();
    assert.equal(deletion.ok, true);
  } finally {
    await Promise.all([closeClient(first), closeClient(second)]);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
});

test("requires an IP-bound Turnstile session", {
  skip: socketUrl.startsWith("wss://")
}, async () => {
  async function upgradeStatus(headers) {
    return new Promise(resolve => {
      const socket = new WebSocket(socketUrl, {
        headers: { Origin: origin.origin, ...headers }
      });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      socket.once("open", () => {
        socket.close();
        resolve(101);
      });
      socket.once("error", () => {});
    });
  }

  assert.equal(await upgradeStatus({}), 401);
  const cookie = await authorize("203.0.113.10");
  assert.equal(await upgradeStatus({
    Cookie: cookie,
    "CF-Connecting-IP": "203.0.113.11"
  }), 401);
  assert.equal(await upgradeStatus({
    Cookie: cookie,
    "CF-Connecting-IP": "203.0.113.10"
  }), 101);
});

test("limits concurrent sockets from one IP", {
  skip: socketUrl.startsWith("wss://")
}, async () => {
  const sockets = [];
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    openClient({ headers: { "CF-Connecting-IP": "203.0.113.10" } })
      .then(socket => {
        sockets.push(socket);
        return 101;
      })
      .catch(error => error.message.includes("429") ? 429 : Promise.reject(error))
  ));

  assert.deepEqual(results.sort(), [101, 101, 101, 101, 101, 429]);
  await Promise.all(sockets.map(closeClient));
});

test("closes sockets that exceed the message rate", {
  skip: socketUrl.startsWith("wss://")
}, async () => {
  const socket = await openClient();
  const closed = new Promise(resolve => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  for (let index = 0; index < 11; index += 1) {
    socket.send("not json");
  }

  assert.deepEqual(await closed, {
    code: 1008,
    reason: "Message rate limit exceeded."
  });
});
