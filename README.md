# DAB Native JavaScript SDK

A small, dependency-free JavaScript and TypeScript client for
[Microsoft Data API builder (DAB)](https://learn.microsoft.com/azure/data-api-builder/).
It provides a fluent API for DAB's native REST model without hiding the concepts
that make DAB different: entities, primary-key paths, OData-style filters,
cursor pagination, and response envelopes.

```ts
import { createDabClient } from "@azure/data-api-builder-js";

const dab = createDabClient("https://localhost:5001/api", {
  headers: {
    Authorization: `Bearer ${token}`
  }
});

const page = await dab
  .entity("books")
  .select("id", "title", "year")
  .where("year").gte(2000)
  .orderBy("title", "asc")
  .first(20)
  .get();

if (page.ok) {
  console.log(page.value);

  if (page.hasNextPage) {
    const nextPage = await page.next();
  }
}
```

## Why a fluent SDK?

DAB's OpenAPI document is the machine-readable map of an application's API. It
describes paths, operations, parameters, and schemas, and remains valuable for
discovery, validation, documentation, and code-generation tools.

OpenAPI alone does not provide a concise application programming model. A
generic OpenAPI client still asks developers to think in HTTP and assemble
query strings:

```ts
await client.GET("/api/books", {
  params: {
    query: {
      $select: "id,title",
      $filter: "year ge 2000 and title ne 'Untitled'",
      $orderby: "title asc",
      $first: 20
    }
  }
});
```

The same request is clearer and safer through the fluent API:

```ts
await dab
  .entity("books")
  .select("id", "title")
  .where("year").gte(2000)
  .where("title").ne("Untitled")
  .orderBy("title", "asc")
  .first(20)
  .get();
```

The SDK formats values, escapes strings, composes filters, builds key paths, and
exposes continuation links directly. OpenAPI and this SDK are complementary:
OpenAPI describes what roads exist; the SDK provides the developer-friendly way
to travel them.

| Area | Raw OpenAPI client | DAB Native SDK |
| --- | --- | --- |
| Main model | Paths and HTTP operations | Entities and fluent operations |
| Filters | Hand-built `$filter` strings | Typed methods such as `.eq()` and `.gte()` |
| Primary keys | Manually supplied path parameters | `.key("id", value)` |
| Composite keys | Manually assembled route values | `.key({ orderId, lineId })` |
| Pagination | Read and call `nextLink` manually | `.first()`, `.after()`, and `page.next()` |
| Errors | Transport/client-specific response | Consistent DAB error envelope |
| DAB concepts | Available but low-level | Visible and convenient |

## Installation

```sh
npm install @azure/data-api-builder-js
```

The package targets modern JavaScript runtimes with the standard `fetch` API.
A custom `fetch` implementation can be supplied when needed.

## Query entities

Omitting `select()` returns every field that DAB allows the caller to access.

```ts
const allFields = await dab.entity("books").get();

const selectedFields = await dab
  .entity("books")
  .select("id", "title", "price")
  .get();
```

### Filters

The SDK models DAB's supported OData-style comparison grammar:

```ts
const books = await dab
  .entity("books")
  .where("title").eq("Dune")
  .where("available").eq(true)
  .where("year").gte(1965)
  .where("rating").isNotNull()
  .get();
```

Supported comparisons are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `isNull`, and
`isNotNull`. Groups and negation are also supported:

```ts
const books = await dab
  .entity("books")
  .and(query => {
    query.where("title").eq("Dune");
    query.or(other => other.where("title").eq("Foundation"));
  })
  .not(query => query.where("available").eq(false))
  .get();
```

### Sorting and pagination

DAB uses cursor continuation rather than offset ranges:

```ts
const firstPage = await dab
  .entity("books")
  .orderBy("year", "desc")
  .orderBy("title", "asc")
  .first(50)
  .get();

if (firstPage.ok && firstPage.hasNextPage) {
  const secondPage = await firstPage.next();
}

const pageFromToken = await dab
  .entity("books")
  .first(50)
  .after(continuationToken)
  .get();
```

## Read and write records

DAB identifies individual records through primary-key path segments.

```ts
const book = await dab
  .entity("books")
  .key("id", 1010)
  .getOne();

const orderItem = await dab
  .entity("orderItems")
  .key({ orderId: 12, lineId: 3 })
  .getOne();
```

Create, update, replace, and delete operations map directly to DAB's `POST`,
`PATCH`, `PUT`, and `DELETE` operations:

```ts
await dab.entity("books").create({
  title: "Leviathan Wakes",
  year: 2011
});

await dab
  .entity("books")
  .key("id", 2000)
  .update({ title: "Leviathan Wakes" });

await dab
  .entity("books")
  .key("id", 2000)
  .replace({ title: "Leviathan Wakes", year: 2011, pages: 577 });

await dab.entity("books").key("id", 2000).delete();
```

DAB keyless `PATCH` and `PUT` operations are explicit:

```ts
await dab
  .entity("books")
  .keyless()
  .update({
    title: "Generated Identity Book",
    publisher_id: 1234
  });
```

## Stored procedures

Stored-procedure-backed entities use procedure terminology rather than implying
an unrelated RPC protocol:

```ts
const result = await dab
  .procedure("searchBooks")
  .param("q", "dune")
  .param("limit", 10)
  .execute();
```

## Error handling

Requests return a discriminated result by default, keeping expected HTTP errors
out of exception control flow:

```ts
const result = await dab.entity("books").where("badColumn").eq(1).get();

if (!result.ok) {
  console.error(result.error.code);
  console.error(result.error.message);
  console.error(result.error.status);
}
```

Use throwing mode when it fits the application better:

```ts
const books = await dab
  .entity("books")
  .where("title").eq("Dune")
  .throwOnError()
  .get();
```

## Design principles

1. Preserve DAB concepts rather than renaming them to resemble another backend.
2. Make primary-key operations explicit.
3. Prefer DAB cursor pagination over offset-style APIs.
4. Preserve DAB's `{ value, nextLink, error }` response model.
5. Build and escape filters instead of asking callers to concatenate strings.
6. Keep the runtime small and use platform APIs before adding dependencies.
7. Treat OpenAPI as a source for future discovery and validation, not as the
   developer-facing programming model.

## Development

```sh
npm install
npm test
```

`npm test` builds the TypeScript package and runs the Node.js test suite.
