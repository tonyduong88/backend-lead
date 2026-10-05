# Setup and Running

## Prerequisites and local layout

- Node.js **20 or later** and npm, available on PATH.
- Docker Engine/Desktop running with the **Docker Compose v2** command (`docker compose`).
- Free local ports **5439** for PostgreSQL and **3000** for the API, unless deliberately reconfigured.
- Access to install npm packages and pull the `postgres:16-alpine` image.

The application runs on the host; Docker runs PostgreSQL. The fresh-installation blocks start at the submission root and enter `starter/`; all subsequent commands run from `starter/`. Keep that directory name: operational scripts default to the Compose container name `starter-postgres-1`. If your environment overrides the Compose project name, see [Runbook](RUNBOOK.md).

Use the committed [package-lock.json](../starter/package-lock.json) with `npm ci`. The recorded verification environment is listed in [Verification results](TESTING.md#verification-results); a supported Node version does not imply identical timing on another machine.

## Fresh installation

Copy the example environment only when `.env` does not already exist.

**macOS/Linux shell:**

```sh
cd starter
test -f .env || cp .env.example .env
npm ci
npm run db:up
npm run db:bootstrap
npm run db:migrate
npm run build
npm run db:preflight:test
npm test
npm run dev
```

**Windows PowerShell:**

```powershell
Set-Location starter
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run db:up
npm run db:bootstrap
npm run db:migrate
npm run build
npm run db:preflight:test
npm test
npm run dev
```

Run the commands sequentially and stop to resolve a failure before continuing. `npm run dev` stays running in the terminal. Open another terminal for API requests. The startup message is `mini-wallet-service listening on :3000`; GET `http://localhost:3000/health` should return HTTP 200.

| Step | What it does |
| --- | --- |
| `db:up` | Creates/reuses the configured Docker volume and starts PostgreSQL, waiting for health |
| `db:bootstrap` | Provisions local dev/test databases and roles, adopts known starter tables, and generates credentials |
| `db:migrate` | Applies development schema migrations using the migration role |
| `build` | Compiles TypeScript into `dist/` |
| `db:preflight:test` | Checks test database identity and isolation without truncating fixture data |
| `test` | Acquires the test coordination lock, migrates the test database and runs Jest serially across suites |
| `dev` | Runs the development server with TypeScript restart support |

Bootstrap preserves `.env` and writes `.env.runtime` for application/test runtime connections and `.env.ops` for privileged operations. Explicit shell environment variables take precedence over files. Old exported URLs can therefore override newly generated credentials; do not export owner/admin credentials into the API process.

`npm test` does not need the development server running. Its integration fixtures use a separate database and **truncate test data before cases**. Benchmark also replaces test data. Do not point the test URLs at development or production databases; the scripts intentionally reject unsafe targets.

## Existing local PostgreSQL container or data

If an older starter container is already running, use this order after installing dependencies:

```sh
npm run db:bootstrap
npm run db:up
npm run db:migrate
npm run build
npm test
```

Bootstrap first records the existing Docker volume so `db:up` can reuse it. Stop application/database jobs before `db:up`, which may recreate/restart the container to apply settings. A storage mismatch is a reason to inspect the mount and configuration, not delete the volume. Do not use `docker compose down -v` or volume pruning as a setup fix.

The wallet-flow migration refuses legacy wallets with nonzero balances because no opening ledger can be verified. It does not silently manufacture history. See [Runbook](RUNBOOK.md) for this case; never zero a real balance to bypass the check.

## Development and compiled execution

For development:

```sh
npm run dev
```

For compiled execution, stop the development process first:

```sh
npm run build
npm start
```

The API does not migrate schema on startup. It authenticates to PostgreSQL and rejects runtime roles that are privileged or own/inherit ownership of application objects. Use Ctrl+C to stop the API. The server handles SIGINT/SIGTERM, stops accepting connections, closes Sequelize after the server drains, and has a 30-second forced-exit limit.

To stop local PostgreSQL while retaining data, run `docker compose stop postgres` from `starter/`. Restart it with `npm run db:up`.

## Check the business flow

Use [API.md](API.md) for the complete deposit/replay/turnover/wager/withdrawal sequence and expected balances. You can import the supplied [Postman JSON](../starter/bruno/mini-wallet.postman_collection.json), which includes collection variables and test scripts. Change the username when repeating a manual flow to avoid a duplicate-username conflict.

## Optional operational verification

After the core build/tests pass, run these separately:

```sh
npm run db:verify-migrations
npm run db:stats:enable
npm run db:migrate:test
npm run benchmark
npm run db:restore-drill
```

Benchmark and restore prerequisites, output files and interpretation are described in [Runbook](RUNBOOK.md). They are not part of `npm test`. Restore is most informative after benchmark has populated the test database.

For a setup failure, use the troubleshooting table in [Runbook](RUNBOOK.md). The fresh submission check and its environment are recorded in [Verification results](TESTING.md#verification-results).
