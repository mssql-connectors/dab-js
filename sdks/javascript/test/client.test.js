import test from "node:test";
import assert from "node:assert/strict";
import { createDabClient } from "../dist/index.js";

function fakeFetch() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: [{ id: 1 }], nextLink: "https://next.example/page" })
    };
  };
  return { fetch, calls };
}

test("builds fluent DAB queries and escapes filter values", async () => {
  const fake = fakeFetch();
  const page = await createDabClient("https://localhost:5001/api", { fetch: fake.fetch })
    .entity("books")
    .select("id", "title")
    .where("title").eq("Dune's")
    .where("year").gte(1965)
    .orderBy("year", "desc")
    .first(5)
    .get();

  assert.equal(
    fake.calls[0].url,
    "https://localhost:5001/api/books?%24select=id%2Ctitle&%24filter=title+eq+%27Dune%27%27s%27+and+year+ge+1965&%24orderby=year+desc&%24first=5"
  );
  assert.deepEqual(page.value, [{ id: 1 }]);
  assert.equal(page.hasNextPage, true);
});

test("builds composite key paths and follows nextLink", async () => {
  const fake = fakeFetch();
  const page = await createDabClient("https://example.test/api", { fetch: fake.fetch })
    .entity("orderItems")
    .key({ orderId: 12, lineId: 3 })
    .getOne();
  assert.equal(fake.calls[0].url, "https://example.test/api/orderItems/orderId/12/lineId/3");
  assert.deepEqual(page.value, { id: 1 });
});

test("sends JSON mutations and reports failures without throwing by default", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: false, status: 400, statusText: "Bad Request", json: async () => ({ error: { code: "BadInput", message: "Invalid" } }) };
  };
  const result = await createDabClient("https://example.test/api", { fetch })
    .entity("books").key("id", 1).update({ title: "Dune" });
  assert.equal(calls[0].init.body, JSON.stringify({ title: "Dune" }));
  assert.deepEqual(result.error, { code: "BadInput", message: "Invalid", status: 400 });
});

test("groups and negates filters", async () => {
  const fake = fakeFetch();
  await createDabClient("https://example.test/api", { fetch: fake.fetch })
    .entity("books")
    .and(query => {
      query.where("title").eq("Dune");
      query.or(other => other.where("title").eq("Foundation"));
    })
    .not(query => query.where("available").eq(false))
    .get();

  const url = new URL(fake.calls[0].url);
  assert.equal(
    url.searchParams.get("$filter"),
    "(title eq 'Dune' or (title eq 'Foundation')) and not (available eq false)"
  );
});

test("formats Date values as OData DateTimeOffset literals", async () => {
  const fake = fakeFetch();
  await createDabClient("https://example.test/api", { fetch: fake.fetch })
    .entity("events")
    .where("occurredAt").gte(new Date("2026-09-21T12:00:00.000Z"))
    .get();

  assert.equal(
    new URL(fake.calls[0].url).searchParams.get("$filter"),
    "occurredAt ge 2026-09-21T12:00:00.000Z"
  );
});

test("calls fetch without binding it to the client", async () => {
  let receiver;
  const fetch = async function () {
    receiver = this;
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: [] })
    };
  };

  await createDabClient("https://example.test/api", { fetch })
    .entity("books")
    .get();

  assert.equal(receiver, undefined);
});
