# GitHub contribution timeline

A private-by-default dashboard for open GitHub issues and pull requests where
the configured user:

- opened the issue or pull request;
- posted an issue or pull request conversation comment;
- posted an inline pull request review comment; or
- submitted a review containing written feedback.

Review requests, assignments, mentions, and subscriptions do not qualify on
their own.

```text
GitHub API -> 15-minute Node sync -> private write DAB -> SQL Server
                                                      |
Browser <- dab-js cursor pagination <- read-only DAB <-+
```

The worker and browser both use `@mssql-connectors/dab-js`; neither connects to
SQL directly. The dashboard is bound to localhost and is not added to the public
Cloudflare tunnel because the timeline may contain private repository data.

## Run

Start the Todo sample SQL Server first so this sample can share its persistent
volume and Docker network:

```sh
npm --prefix ../todo-app run dab:up
```

Create `dab/.env`:

```dotenv
MSSQL_SA_PASSWORD=the-password-used-by-the-Todo-SQL-container
GITHUB_SYNC_PASSWORD=a-new-strong-password
GITHUB_READ_PASSWORD=another-new-strong-password
GITHUB_LOGIN=your-github-login
GITHUB_TOKEN=a-token-that-can-read-your-repositories
SYNC_INTERVAL_MS=900000
```

The file is ignored by Git. Then run:

```sh
npm run stack:up
```

Open <http://localhost:4177/github>.

## GitHub access

The token determines the repositories the sync can inspect. For GitHub CLI
users, `gh auth token` supplies the active account token; do not commit or print
it. Organization SSO policies still apply.

GitHub search returns at most 1,000 results per query. The worker fails rather
than silently reconciling incomplete data if that limit is exceeded.

## Data and pagination

The sync stores threads, timeline events, and sync status in the
`GitHubActivity` database. A private DAB instance can write those tables. A
separate least-privilege SQL login and DAB instance expose only:

- `OpenContributions`
- `ContributionTimeline`
- `GitHubSyncState`

The browser requests 50 timeline events at a time and follows DAB `nextLink`
cursors through `page.next()`. Repository, issue/PR type, participation, and
one-day through six-month date ranges are applied as DAB filters before
pagination.
