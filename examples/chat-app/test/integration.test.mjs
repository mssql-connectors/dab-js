import assert from "node:assert/strict";
import test from "node:test";
import { createDabClient } from "@mssql-connectors/dab-js";
import WebSocket from "ws";

const socketUrl = process.env.CHAT_URL ?? "ws://localhost:4175/chat/ws";
const dab = createDabClient(process.env.DAB_URL ?? "http://localhost:5002/api");

function openClient(options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
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

test("limits concurrent sockets from one IP", {
  skip: socketUrl.startsWith("wss://")
}, async () => {
  const sockets = [];
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl, {
        headers: { "CF-Connecting-IP": "203.0.113.10" }
      });
      sockets.push(socket);
      socket.once("open", () => resolve(101));
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      socket.once("error", reject);
    })
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
