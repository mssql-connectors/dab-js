import test from "node:test";
import assert from "node:assert/strict";
import { createDabClient } from "../../dist/index.js";

const dab = createDabClient(process.env.DAB_URL ?? "http://localhost:5000/api");

function assertOk(result) {
  assert.equal(
    result.ok,
    true,
    result.ok ? undefined : JSON.stringify(result.error)
  );
}

test("queries, filters, sorts, and follows DAB pagination", async () => {
  const firstPage = await dab
    .entity("books")
    .select("id", "title", "year")
    .where("year").gte(2020)
    .orderBy("id", "asc")
    .first(1)
    .get();

  assertOk(firstPage);
  assert.deepEqual(firstPage.value.map(book => book.id), [1000]);
  assert.equal(firstPage.hasNextPage, true);

  const secondPage = await firstPage.next();
  assertOk(secondPage);
  assert.deepEqual(secondPage.value.map(book => book.id), [1002]);
});

test("reads and mutates records through DAB key paths", async () => {
  const created = await dab.entity("books").create({
    id: 2000,
    title: "Leviathan Wakes",
    year: 2011,
    pages: 577
  });
  assertOk(created);

  const read = await dab.entity("books").key("id", 2000).getOne();
  assertOk(read);
  assert.equal(read.value.title, "Leviathan Wakes");

  const updated = await dab
    .entity("books")
    .key("id", 2000)
    .update({ title: "Leviathan Wakes: Updated" });
  assertOk(updated);

  const replaced = await dab
    .entity("books")
    .key("id", 2000)
    .replace({
      title: "Leviathan Wakes",
      year: 2011,
      pages: 577
    });
  assertOk(replaced);

  const deleted = await dab.entity("books").key("id", 2000).delete();
  assertOk(deleted);

  const missing = await dab.entity("books").key("id", 2000).getOne();
  assertOk(missing);
  assert.equal(missing.value, null);
});
