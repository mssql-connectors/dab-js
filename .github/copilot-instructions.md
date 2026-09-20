# Copilot instructions

This repository contains JavaScript/TypeScript and Rust SDKs for Microsoft Data
API builder (DAB). Each SDK lives under `sdks/<language>` and is an independent
build and release unit.

## Product contract

- Preserve DAB's REST concepts and names: entities, `$select`, `$filter`,
  `$orderby`, `$first`, `$after`, key paths, `nextLink`, and DAB error
  envelopes.
- Do not add PostgREST behavior or names such as offset ranges, upsert, or RPC
  unless DAB itself gains that contract.
- Keep primary-key operations explicit through `key()` and keyless writes
  explicit through `keyless()`.
- Keep the JavaScript runtime dependency-free unless a platform API cannot meet
  a confirmed requirement. Keep the future Rust dependency graph small and
  justify new crates.
- Treat OpenAPI as a discovery and validation input, not the public programming
  model.

## Changes and tests

- Add or update unit tests for query construction, escaping, validation, and
  response normalization.
- Add an integration test when behavior depends on DAB or SQL Server rather
  than only on local request construction.
- Run `npm test` and `npm run check:package` from `sdks/javascript` for
  JavaScript SDK changes.
- Run `npm run test:integration` against the Docker Compose environment for
  changes to transport, response handling, or DAB integration.
- Keep public types strict and avoid casts that hide invalid values.
- Run the relevant `cargo fmt`, `cargo clippy`, and `cargo test` checks after a
  Rust crate is introduced.
- Keep cross-language behavior consistent, but use idiomatic public APIs for
  each language.
- Use Conventional Commit subjects so Release Please can calculate versions and
  changelogs.

## Pull requests

- Explain the DAB behavior being changed and its corresponding REST request.
- Call out public API or package compatibility changes.
- Do not include generated `dist`, coverage output, or dependencies in commits.
