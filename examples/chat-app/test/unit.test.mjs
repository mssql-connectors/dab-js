import assert from "node:assert/strict";
import test from "node:test";
import {
  generateGuestName,
  getClientIp,
  parseChatMessage,
  verifyTurnstile
} from "../server.mjs";

test("validates and normalizes incoming chat messages", () => {
  assert.deepEqual(
    parseChatMessage('{"type":"send","author":" Ada ","body":" Hello " }'),
    { author: "Ada", body: "Hello" }
  );
  assert.throws(
    () => parseChatMessage('{"type":"send","author":"","body":"Hello"}'),
    /requires an author and body/
  );
  assert.throws(
    () => parseChatMessage(Buffer.from("not json")),
    /valid JSON/
  );
  assert.throws(
    () => parseChatMessage(
      '{"type":"send","author":"Ada","body":"blocked message"}',
      { exists: value => value.includes("blocked") }
    ),
    /keep names and messages appropriate/
  );
});

test("generates a Docker-style guest name", () => {
  assert.equal(generateGuestName(() => 0), "brave-badger");
});

test("trusts Cloudflare client IPs only when configured", () => {
  const request = {
    headers: { "cf-connecting-ip": "203.0.113.10" },
    socket: { remoteAddress: "127.0.0.1" }
  };

  assert.equal(getClientIp(request, true), "203.0.113.10");
  assert.equal(getClientIp(request, false), "127.0.0.1");
});

test("validates Turnstile action and hostname", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ success: true, action: "chat", hostname: "todo.example" })
  });

  assert.equal(await verifyTurnstile({
    token: "token",
    secret: "secret",
    remoteIp: "203.0.113.10",
    expectedHostname: "todo.example",
    expectedAction: "chat",
    fetcher
  }), true);
  assert.equal(await verifyTurnstile({
    token: "token",
    secret: "secret",
    remoteIp: "203.0.113.10",
    expectedHostname: "other.example",
    expectedAction: "chat",
    fetcher
  }), false);
  assert.equal(await verifyTurnstile({
    token: "token",
    secret: "secret",
    remoteIp: "203.0.113.10",
    expectedHostname: "todo.example",
    expectedAction: "other",
    fetcher
  }), false);
});
