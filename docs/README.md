# Mini Wallet — Reviewer Guide

This submission implements a deposit → wager → withdrawal flow using TypeScript, Express, Sequelize and PostgreSQL. Its central requirement is money correctness: duplicate payment callbacks must not credit twice, concurrent debits must not overdraw a wallet, and every balance change must remain reconstructible from an append-only ledger.

This English documentation is the reviewer-facing handover. All submitted documentation and API collection descriptions are in English. The submission layout was reviewed on **4 October 2026**. The latest setup and test results are recorded in [Verification results](TESTING.md#verification-results).

## Start here

1. Follow [Setup and Running](SETUP.md) to install dependencies, provision local PostgreSQL, migrate and start the API.
2. Run the build and test commands in [Testing and Acceptance](TESTING.md). The core suite uses real PostgreSQL and restricted runtime credentials.
3. Follow the [API walkthrough](API.md) or run the supplied Postman collection to inspect the business flow.
4. Read [Architecture](ARCHITECTURE.md), [Design Decisions](DECISIONS.md) and [PSP Design](DESIGN-PSP.md) for the reasoning behind the implementation.
5. Use the [Runbook](RUNBOOK.md) for operational checks, benchmark reproduction, migrations, troubleshooting and a local restore drill.

| Document | Purpose |
| --- | --- |
| [SETUP.md](SETUP.md) | Prerequisites, fresh/existing database setup, development and compiled execution |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, data model, invariants and transaction flow |
| [DECISIONS.md](DECISIONS.md) | Trade-offs, alternatives, limitations and AI disclosure |
| [DESIGN-PSP.md](DESIGN-PSP.md) | Part B: adding providers without changing wallet correctness logic |
| [API.md](API.md) | Endpoint contract, example requests, errors and expected demo results |
| [TESTING.md](TESTING.md) | Test inventory, acceptance mapping, verification results and evidence limits |
| [RUNBOOK.md](RUNBOOK.md) | Configuration, diagnosis, benchmark, migration and restore procedures |

## Implemented scope

| Requirement | Implementation |
| --- | --- |
| A1 — Create a deposit | Creates Pending funding with a generated PSP reference; no money moves yet; multiplier defaults to 1 |
| A2 — PSP callback | Completed deposits credit once under sequential or concurrent replay; failed deposits do not credit; explicit terminal transitions, amount checks and ledger entries |
| A3 — Wagers | Atomic debit and accrued-turnover increment; rejects insufficient balance; serializes competing wallet writers |
| A4 — Withdrawals | Requires accrued turnover ≥ required turnover; returns outstanding turnover when blocked; debits immediately and creates Pending withdrawal funding |
| A5 — Tests | Real-database replay, concurrency, turnover-boundary and rollback tests, plus precision, constraints, permissions and resource checks |
| Part B — PSP extensibility | Adapter/registry boundary, mock fixtures and contract tests, plus a design for verified provider integrations |

Additional work includes separate runtime/migration/test roles, guarded test cleanup, pool and timeout configuration, diagnostics, benchmark scripts, migration verification and a logical restore drill. These support the implementation; they do not constitute a production-readiness claim.

There is no real PSP integration, authentication, withdrawal approval, outbound payout or client idempotency key for wagers/withdrawals. The ledger is a wallet movement ledger, not a complete double-entry accounting system. See [Decisions](DECISIONS.md) for the implications.

## Source map

All commands run from [`starter/`](../starter), not from this documentation folder.

| Location | Responsibility |
| --- | --- |
| [src/app.ts](../starter/src/app.ts), [src/index.ts](../starter/src/index.ts) | App wiring/error handling/admission control; server startup and shutdown |
| [src/routes](../starter/src/routes) | HTTP parsing and Zod validation |
| [src/services](../starter/src/services) | Business operations, transactions and wallet mutations |
| [src/lib/money.ts](../starter/src/lib/money.ts) | Decimal validation, arithmetic and formatting |
| [src/db/models](../starter/src/db/models), [migrations](../starter/src/db/migrations) | Persistent model, constraints, indexes and grants |
| [src/integrations/psp](../starter/src/integrations/psp) | Provider contract, registry and mock adapter |
| [test](../starter/test) | Seven Jest suites and shared fixtures/reconciliation helpers |
| [scripts](../starter/scripts) | Database lifecycle, guarded verification, benchmark and recovery scripts |
| [bruno/mini-wallet.postman_collection.json](../starter/bruno/mini-wallet.postman_collection.json) | Twenty-request example flow with response assertions |
| [bruno/import](../starter/bruno/import/README.md) | Full 96-request Bruno YAML collection; independent scenarios, dynamic IDs and response assertions; 96 requests and 239 assertions verified over HTTP with a Node harness |

Keep `starter/` and `docs/` next to each other when extracting or moving the submission so documentation links remain valid.
