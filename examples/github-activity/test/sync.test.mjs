import assert from "node:assert/strict";
import test from "node:test";
import { participationFor, sameTimestamp, stableId, summarize } from "../sync.mjs";

test("tracks only authored or explicit comment participation", () => {
  const item = { user: { login: "someone-else" } };
  assert.deepEqual(participationFor("me", item, [], [], []), []);
  assert.deepEqual(
    participationFor("me", item, [{ user: { login: "me" } }], [], []),
    ["commented"]
  );
  assert.deepEqual(
    participationFor("me", item, [], [], [{ user: { login: "me" }, body: "" }]),
    []
  );
  assert.deepEqual(
    participationFor("me", item, [], [], [{ user: { login: "me" }, body: "Feedback" }]),
    ["reviewed"]
  );
});

test("normalizes timeline values deterministically", () => {
  assert.equal(stableId("owner/repo#1"), stableId("owner/repo#1"));
  assert.equal(summarize("one\n \t two"), "one two");
  assert.equal(
    sameTimestamp("2026-09-22T12:00:00.0000000", "2026-09-22T12:00:00Z"),
    true
  );
});
