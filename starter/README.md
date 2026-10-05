# Mini Wallet Service

Reviewer documentation is in [../docs/README.md](../docs/README.md). See
[Setup](../docs/SETUP.md) for prerequisites, installation and troubleshooting,
and [Testing](../docs/TESTING.md) for acceptance coverage.

From this directory, with Node.js 20+ and Docker running:

```sh
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

Run each command sequentially and resolve failures before continuing.
The API runs at `http://localhost:3000`. PostgreSQL uses local port `5439`.
Bootstrap generates runtime and operations credentials; preserve existing
`.env` files. Tests use the separate `wallet_test` database and truncate test
fixtures. See [API](../docs/API.md) for the complete money movement walkthrough.

Source conventions: TypeScript, Express, Sequelize, PostgreSQL and Jest;
Zod validation in routes, business logic in services, schema changes through
migrations, and string decimal amounts with `bignumber.js` arithmetic.
