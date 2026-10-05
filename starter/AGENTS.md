# Starter codebase rules

## Scope and source

These rules apply to this directory and all its descendants. They translate
the conventions in `README.md` into instructions for code changes. Consult
`../readme.md` for the assignment's business requirements; do not treat
features described there as already implemented.

## Stack and structure

- Use the existing TypeScript, Express, Sequelize, PostgreSQL, and Jest stack.
- Keep application source in `src/` and tests in `test/`.
- Keep `src/index.ts` responsible for starting the server and
  `src/app.ts` responsible for creating and wiring the Express application.
- Define HTTP routes in `src/routes/`. Validate incoming data with Zod and
  delegate business operations to `src/services/`.
- Keep business logic in services, not route handlers.
- Keep Sequelize model definitions in `src/db/models/` and schema migrations
  in `src/db/migrations/`.
- Use `src/config.ts` for application environment configuration and
  `src/db/cli-config.js` for migration connection configuration. Keep database
  selection consistent between the application and migration CLI.

## Money

- Store monetary values in PostgreSQL as `DECIMAL(36,18)`.
- Represent money as strings at JSON and application input/output boundaries.
- Use `bignumber.js` through the helpers in `src/lib/money.ts` for monetary
  arithmetic and comparisons.
- Do not convert money to JavaScript `number`, including with `Number()`,
  `parseFloat()`, unary `+`, or BigNumber's `toNumber()`.
- Do not use native JavaScript arithmetic on monetary values.
- Validate monetary input against the business operation's requirements;
  converting a value to BigNumber alone is not business validation.

## Database writes

- Run every operation that writes more than one row inside a single database
  transaction. Follow the pattern in `src/services/memberService.ts`.
- Pass the same transaction explicitly to each database operation belonging
  to that unit of work, so partial writes are rolled back on failure.
- Create new tables through migrations. Do not use Sequelize `sync()` to
  create or alter the schema.
- Keep model definitions and migrations consistent when changing the schema.

## Local workflow

Run commands from this directory. Prerequisites are Node.js 20+ and Docker.

```sh
# First-time setup: copy only when .env does not already exist.
cp .env.example .env
npm install
npm run db:up
npm run db:bootstrap
npm run db:migrate

# Development and verification
npm run dev
npm run build
npm test
```

- Preserve an existing `.env` rather than overwriting local configuration.
- PostgreSQL defaults to host port `5439`; update `docker-compose.yml` and
  the database URLs in `.env` together if that port changes.
- Use a separate test database. Verify `DATABASE_URL_TEST` does not point to
  a development or production database: the existing tests truncate data.
- `npm test` runs test database migrations before Jest; it requires PostgreSQL
  to be available.
- For code changes, run the build and tests relevant to the change. Report
  any checks that could not run and the reason. Documentation-only changes
  do not require starting the database or running application tests.

The setup and core architecture rules above come from `README.md`. The
configuration-preservation and verification guidance makes those conventions
operational without changing the assignment's scope.
