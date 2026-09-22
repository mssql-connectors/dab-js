# DAB WebSocket chat

A minimal multi-user chat demonstrating a Node.js middleware that:

- reads and writes messages only through `@mssql-connectors/dab-js`;
- broadcasts successful writes to connected browsers over WebSockets; and
- serves the browser application from the same process.

```text
Browser <-- WebSocket --> Node middleware <-- dab-js --> DAB --> SQL Server
```

The Node process never opens a SQL connection. The sample shares the Todo
sample's SQL Server container and persistent volume, but uses its own `ChatApp`
database and DAB container.

## Run

From this directory:

```sh
npm ci
npm --prefix ../todo-app run dab:up
npm run dab:up
npm start
```

Open <http://localhost:4175/chat> in two browser windows and send a message from
either one. Stop the backend with:

```sh
npm run dab:down
```

`dab:down` removes only the chat DAB container. Chat history remains in the
Todo sample's SQL Server volume.

## Public deployment

The middleware defaults to five concurrent WebSocket connections per client IP,
a 16 KiB WebSocket payload limit, ten messages per ten seconds per socket, and a
30-second ping/pong heartbeat. Browser upgrades are accepted only from
`http://localhost:4175` by default; set `ALLOWED_ORIGINS` to a comma-separated
list for deployment. Set `TRUST_CLOUDFLARE=true` only when the origin is
reachable exclusively through Cloudflare Tunnel so `CF-Connecting-IP` cannot be
spoofed. `MAX_CONNECTIONS_PER_IP` changes the concurrent connection limit.

Cloudflare rate limiting can restrict repeated `/chat/ws` upgrade requests, but
Cloudflare inspects only the initial WebSocket upgrade. The middleware therefore
enforces connection and message limits after the upgrade.

New clients receive a Docker-style guest name such as `brave-badger`, which they
can replace before sending. The middleware uses the MIT-licensed
`@2toad/profanity` package to reject inappropriate names and messages before
writing them to DAB. English is enabled by default; set
`PROFANITY_LANGUAGES=en,fr` to select supported dictionaries.

## Scope

This sample intentionally uses one middleware process. Writes made through
another process or directly through DAB are not pushed to connected browsers.
For horizontal scaling, add a shared pub/sub backplane and publish an event only
after the DAB write succeeds. Authentication and authorization are also omitted
from this local sample.
