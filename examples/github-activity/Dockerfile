FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY examples/github-activity/dist ./dist
COPY examples/github-activity/server.mjs examples/github-activity/sync.mjs ./
COPY sdks/javascript/package.json ./node_modules/@mssql-connectors/dab-js/package.json
COPY sdks/javascript/dist ./node_modules/@mssql-connectors/dab-js/dist
EXPOSE 4177
CMD ["node", "server.mjs"]
