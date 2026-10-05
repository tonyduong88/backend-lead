# Design Decisions and Trade-offs

## Preserve the starter structure

The implementation keeps TypeScript, Express, Sequelize, PostgreSQL, Jest, Zod and BigNumber. Routes handle HTTP/validation, services own business operations, and migrations own schema changes. It does not add a queue, cache, generic repository framework or dependency-injection container without a concrete requirement. App startup does not run schema synchronization.

## Exact decimal money with explicit range checks

Money is represented as strings at input/output boundaries and calculated with BigNumber. `DECIMAL(36,18)` supports 18 integer and 18 fractional digits. Inputs with exponent notation, whitespace, excess precision or invalid ranges are rejected instead of silently rounded. Product, balance and turnover overflow are checked separately before writes.

This is more verbose than native arithmetic but avoids binary floating-point errors and preserves the stored precision. Direct SQL can still apply PostgreSQL numeric scale coercion, so database constraints do not replace application validation.

## Ledger plus wallet projection

The ledger stores balance and turnover deltas; the wallet stores current totals for fast decisions under a row lock. This avoids scanning all historical entries during every wager. The trade-off is that both representations must commit together and be reconciled.

The ledger is append-only for runtime operations. Corrections would require an explicit compensating-entry design rather than rewriting history. It is not double-entry accounting: counterparty accounts, currencies and settlement accounting are not implemented. Legacy nonzero balances are rejected during migration rather than assigned invented opening entries.

## Row locking with READ COMMITTED

All money writers lock the wallet before checking and changing its counters. `FOR NO KEY UPDATE` is strong enough to serialize those writers while allowing foreign-key reference checks for Pending deposits. Callback handling uses the common wallet-then-funding lock order after locating the immutable funding identity.

This keeps the transaction reasoning explicit without making every query SERIALIZABLE. The cost is serialization on a hot wallet. Any future money-writing path must obey the same invariant and lock order; the isolation level does not make arbitrary new code correct automatically.

## Durable idempotency, not exactly-once network delivery

The callback identifies persisted funding by `(provider, pspRef)`. Under lock, same terminal state means successful replay; opposite terminal state means conflict. Amount must match numerically before replay is accepted. Unique operation keys and funding effects provide additional protection against duplicate ledger entries.

This handles repeated delivery and lost acknowledgements for deposits. It does not promise exactly-once message delivery. Provider event IDs may be useful for audit, but do not replace the funding identity when multiple events describe the same payment.

## Turnover semantics and withdrawal scope

Required and accrued turnover are wallet-lifetime totals. Multiplier 0 adds no requirement; previous accrued turnover can satisfy a later requirement. Withdrawals do not reset or consume accrued turnover. This follows the assignment's cumulative comparison and is made explicit in tests.

A valid withdrawal debits immediately and creates Pending funding atomically. Human approval, outbound payout and reversal after payout failure are intentionally not invented for this exercise. The client does not yet supply idempotency keys for wagers/withdrawals; that is the next prerequisite for safe retry after an ambiguous HTTP result.

## Bounded resources and restricted credentials

Runtime credentials cannot own schema or modify ledger history/immutable funding identity. Migration and test cleanup use separate roles. API configuration reads runtime settings, while privileged scripts load operations credentials. Test guards verify target, role, marker and isolation before cleanup.

Pool limits, finite wait timeouts, an application transaction deadline and admission control bound resource usage. A client disconnect does not free an admission slot until its handler settles. The deadline is cooperative, not a mechanism that forcibly cancels any query or COMMIT at an exact millisecond.

These controls reduce accidental damage and runaway work. They do not substitute for authentication, wallet authorization, auditing or production secret management. A compromised runtime can still perform allowed inserts/updates; minimum privileges are not a complete fraud-prevention boundary.

## Indexes and operational additions

Indexes support identity lookups, uniqueness, wallet foreign keys and history ordered by `(wallet_id, created_at, id)`. Balance/turnover/updated timestamps are not indexed without a query requiring it, limiting write amplification. Durability and autovacuum remain enabled. Partitioning, replicas, RLS, PgBouncer and global tuning are deferred until workload/tenant requirements justify them.

Benchmark reports distinguish successful acknowledgements from new monetary effects and report HTTP percentiles separately from metric means. A logical restore drill verifies data/migration fingerprints and reconciliation in an isolated database. These are concrete local checks, not claims of production capacity, HA or point-in-time recovery.

## Evidence and remaining work

[Testing](TESTING.md) describes the assertions and records the latest setup, test and operational verification results. Failure injection uses real writes with selected injected errors. The current evidence does not include real-provider signatures, process/storage failure at COMMIT, a multi-process race test, remote TLS validation, sustained production load or PITR/HA rehearsal. Independent review was not recorded as completed in the implementation handover.

Before handling real money, priorities include authentication/authorization, a verified PSP contract, client debit idempotency, settlement reconciliation, payout state handling, and recovery objectives tested on the target infrastructure. An outbox/inbox becomes appropriate when durable external messaging is introduced; it is not currently implemented.

## AI assistance

AI (Codex) assisted with requirements analysis, implementation, test development and debugging. The author owns the design decisions, trade-offs and final implementation, with a focus on money correctness, concurrency safety and verifiable results.
