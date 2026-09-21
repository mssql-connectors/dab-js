# DAB todo app

A small browser app that uses `@mssql-connectors/dab-js` for list, create,
update, and delete operations against a real DAB REST API.

## Run locally

Docker and Node.js 20 or newer are required.

```sh
npm install
npm run dab:up
npm run dev
```

Open the Vite URL shown in the terminal. Vite proxies `/api` to DAB at
`http://localhost:5000`, so local development needs no browser CORS changes.

Stop and remove the local database when finished:

```sh
npm run dab:down
```

Set `MSSQL_SA_PASSWORD` before `dab:up` to replace the development-only default.
For a separately hosted DAB instance, set `VITE_DAB_URL` when starting or
building the app.
