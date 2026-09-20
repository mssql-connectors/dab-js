# DAB Native SDKs

Native, fluent SDKs for
[Microsoft Data API builder (DAB)](https://learn.microsoft.com/azure/data-api-builder/).
The repository currently contains the JavaScript and TypeScript SDK and reserves
a separate package for a future Rust SDK.

```text
sdks/
├── javascript/   # @azure/data-api-builder-js
└── rust/         # Future Rust crate
```

## Why native SDKs?

DAB's OpenAPI document is the machine-readable map of an application's API. It
describes paths, operations, parameters, and schemas and is valuable for
discovery, validation, documentation, and tooling.

OpenAPI alone does not give application developers a concise programming model.
A generic OpenAPI client still requires hand-built HTTP query values:

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

DAB Native SDKs make the same request clear while preserving DAB's actual
contract:

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

OpenAPI describes what roads exist; a native SDK provides the safe,
language-friendly way to travel them. The SDKs format values, compose filters,
build primary-key paths, follow cursor continuation, and consistently expose
DAB response envelopes.

| Area | Raw OpenAPI client | DAB Native SDK |
| --- | --- | --- |
| Main model | Paths and HTTP operations | Entities and fluent operations |
| Filters | Hand-built `$filter` strings | Methods such as `.eq()` and `.gte()` |
| Primary keys | Manually supplied path parameters | Explicit key operations |
| Pagination | Read and call `nextLink` manually | Native cursor workflow |
| Errors | Transport-specific response | Consistent DAB error model |
| Language fit | Generated HTTP surface | Idiomatic API for each language |

## SDKs

- [JavaScript and TypeScript](sdks/javascript/README.md) - implemented, tested,
  and packaged as `@azure/data-api-builder-js`
- [Rust](sdks/rust/README.md) - directory and design boundary reserved for the
  future crate

## Examples

- [Todo web app](examples/todo-app/README.md) - a cozy browser app using the
  JavaScript SDK with a local SQL Server 2025 and DAB environment

## Development and releases

Pull requests and pushes to `main` run unit coverage, npm package inspection,
and integration tests against disposable SQL Server and DAB containers. Each
SDK is an independent build and release unit under `sdks`.

Release Please manages versions and changelogs. Maintainer setup for Codecov,
Release Please, npm publishing, repository permissions, and required checks is
documented in [Repository setup](docs/repository-setup.md).
