# DAB schema browser

A read-only database structure browser built with the DAB Native JavaScript
SDK. It displays schemas, tables, views, columns, indexes, primary keys, and
foreign-key relationships. It does not expose table rows or accept SQL.

## Run locally

Docker and Node.js 20 or newer are required.

```sh
npm install
npm run dab:up
npm run dev
```

Open the Vite URL shown in the terminal. The example uses port `5001` for DAB
and `1434` for SQL Server so it can run beside the todo example.

```sh
npm run dab:down
```

## Read-only boundary

The database initialization creates four `catalog` views over SQL Server system
catalogs. DAB exposes only those views and grants only its `read` action. DAB
connects as `dab_schema_reader`, which has `VIEW DEFINITION` and `SELECT` only
on the `catalog` schema.

For production:

- replace the development passwords and anonymous DAB role
- use your identity provider and a dedicated least-privilege database principal
- deploy the catalog views into each database you intend to inspect
- keep business-table entities out of this DAB configuration

This design intentionally does not support arbitrary SQL or table-row browsing.
