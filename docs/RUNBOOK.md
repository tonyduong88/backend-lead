# Local Operations Runbook

Run commands from `starter/`. This runbook describes the local implementation and its verification scripts. Provisioning a remote production database, production recovery and real PSP operations require environment-specific procedures.

## Credentials, configuration and storage

| Role | Purpose |
| --- | --- |
| `wallet_owner` | NOLOGIN owner of development application objects |
| `wallet_migrator` | Migration login with membership in owner; migration tooling sets the owner role |
| `wallet_app` | Restricted development API runtime |
| `wallet_test_owner` | Test migration/cleanup owner; cannot CONNECT to the development database |
| `wallet_test_app` | Restricted test API runtime |

The Docker image's local bootstrap administrator is for provisioning, not API use. Bootstrap generates role passwords and writes `.env.runtime` / `.env.ops`; these files and `.env` must not be submitted or deployed as application assets. The file creation requests mode 0600, but platform/filesystem behavior is not a replacement for proper secret management.

Runtime settings load allowlisted keys from `.env.runtime`, then `.env`. Operations scripts additionally load `.env.ops`. Existing process environment values win. The API does not load operations credentials from files; it does not automatically remove privileged credentials a parent shell already exported.

Defaults are in [.env.example](../starter/.env.example) and [config.ts](../starter/src/config.ts):

| Setting | Default | Meaning |
| --- | ---: | --- |
| PORT | 3000 | HTTP API port |
| DB_POOL_MAX | 5 | Runtime connections per process |
| DB_POOL_ACQUIRE_MS | 3000 | Maximum acquisition wait |
| DB_POOL_IDLE_MS | 10000 | Idle pool connection lifetime setting |
| DB_LOCK_TIMEOUT_MS | 1500 | Database lock wait limit |
| DB_STATEMENT_TIMEOUT_MS | 5000 | Statement execution limit |
| DB_IDLE_TRANSACTION_TIMEOUT_MS | 10000 | Idle-in-transaction session limit |
| DB_TRANSACTION_DEADLINE_MS | 15000 | Cooperative transaction/retry deadline |
| MAX_IN_FLIGHT | 64 | Per-app admission capacity |
| PSP_MOCK_ENABLED | true in local setup | Mock adapter availability; production must disable it |
| DB_SSL | false in local setup | Production requires verified SSL; optional CA via DB_SSL_CA_FILE |

Lock timeout must be below statement timeout. Total database connections include replicas × runtime pool plus coordinator, migration, observer and administrative connections. Increasing pool size is not a general fix for contention on one wallet.

PostgreSQL binds `127.0.0.1:5439` and stores data in the external named volume `mini-wallet-data` by default. This volume is not a backup. Existing storage must be adopted/verified before container recreation; follow [Setup](SETUP.md). If changing the host port, update Compose and all relevant connection URLs consistently, including generated files/process overrides.

Scripts default to container `starter-postgres-1`. Preserve the `starter/` directory and ordinary Compose project naming. If using another Compose project name, set `PG_CONTAINER` to the actual container name. For `db:up`, place it in the process environment, because that script loads runtime settings rather than `.env.ops`; restore/bootstrap operation tooling can also read it from `.env.ops`. Ensure the URLs actually point to that container.

## Safe test execution

```sh
npm run db:preflight:test
npm test
```

Guards check the test allowlist, target separation from development (including loopback aliases), actual database/role, marker and denied CONNECT to development. They run before migration/cleanup. Test, benchmark and restore share an advisory coordination lock; another cooperating job fails to acquire it instead of racing fixture changes.

The database suites and benchmark truncate test fixture data. Do not bypass guards or run concurrent manual writes into that database. A custom process ignoring the wrapper is not automatically prevented from writing by this advisory lock.

## Migrations

Use `npm run db:migrate` for development and `npm run db:migrate:test` for test. A separate migration advisory lock prevents concurrent schema runners. API startup does not perform DDL. Keep migration history; add forward migrations rather than editing applied history or using `sync()`.

```sh
npm run db:verify-migrations
```

This command builds and creates isolated `wallet_verify_<random>` databases. It checks:

1. All migrations apply to a fresh database and reconciliation succeeds.
2. A legacy member/wallet schema containing a synthetic balance of 1 refuses upgrade; the new funding table is absent and the balance is unchanged.
3. Returning only that synthetic fixture to zero permits upgrade and preserves a wallet that reconciles.

Read `artifacts/migrations.json` for fresh/legacy counts, `reconciled` and `nonzeroLegacyRefused`. The legacy assertions are not a fingerprint of every schema/data property. Existing real nonzero wallets need a reviewed opening-ledger migration and reconciled history; never zero them to bypass the guard. The financial migration's down path deliberately refuses to drop financial history.

For a future large production schema, rehearse on a representative copy and plan expand/backfill/verify/contract and DDL locking. Concurrent indexes and partitioning require their own integrity and migration design; these are not enabled here.

## Benchmark and diagnostics

Prepare statistics and test schema first; benchmark builds the application but does not run migrations:

```sh
npm run db:stats:enable
npm run db:migrate:test
npm run benchmark
```

To compare pool settings on macOS/Linux:

```sh
DB_POOL_MAX=2 BENCH_LABEL=pool-2 npm run benchmark
DB_POOL_MAX=5 BENCH_LABEL=pool-5 npm run benchmark
DB_POOL_MAX=5 BENCH_REQUESTS=1500 BENCH_LEDGER_ROWS=10000 BENCH_LABEL=larger-fixture npm run benchmark
```

PowerShell equivalents (use a dedicated shell or restore previous environment values afterwards):

```powershell
$env:DB_POOL_MAX = '2'
$env:BENCH_LABEL = 'pool-2'
npm run benchmark
$env:DB_POOL_MAX = '5'
$env:BENCH_LABEL = 'pool-5'
npm run benchmark
$env:BENCH_REQUESTS = '1500'
$env:BENCH_LEDGER_ROWS = '10000'
$env:BENCH_LABEL = 'larger-fixture'
npm run benchmark
```

Defaults: 20 wallets, 1000 warm-up wagers, 180 requests per phase and concurrency 12. `BENCH_REQUESTS` accepts 1–10000, `BENCH_CONCURRENCY` 1–64, and `BENCH_LEDGER_ROWS` 1–100000. Labels accept 1–40 lowercase letters/digits/hyphens. Reusing a label overwrites the old report.

Each invocation resets the fixture, funds the wallets, warms up through the API and runs four consecutive phases on an ephemeral local HTTP server:

| Workload | Requests | New ledger effects on successful completion |
| --- | --- | ---: |
| distributed-wagers | Wager 0.01 across 20 wallets | N |
| hot-wallet-wagers | Wager 0.01 on one wallet | N |
| duplicate-callbacks | N callbacks for one Pending deposit | 1 |
| mixed | Approximately one third callbacks, wagers and withdrawals | N |

Read `artifacts/benchmark-<label>.json`; the console prints only label/workloads. For example in PowerShell:

```powershell
$report = Get-Content -Raw artifacts/benchmark-pool-5.json | ConvertFrom-Json
$report.workloads | Select-Object name, successful, acknowledgementsPerSecond, newMonetaryEffects, monetaryEffectsPerSecond, p95Ms, p99Ms
$report.workloads[1].metricDelta
$report.workloads[1].lockSamples
$report.diagnostics.plans
```

| Metric | Interpretation |
| --- | --- |
| successful / codes | Response counts by status/error; examine failures before throughput |
| acknowledgementsPerSecond | Successful responses divided by phase duration; includes replay ACKs |
| newMonetaryEffects / monetaryEffectsPerSecond | Ledger-count delta and its rate; duplicate ACKs do not each create a new credit |
| p50Ms / p95Ms / p99Ms | Percentiles measured by the HTTP load driver, including local HTTP/JSON overhead |
| metricDelta.poolWait.meanMs | Mean successful pool acquisition time; may include new connection setup, not a percentile |
| metricDelta.sql / transaction / request | Means/counts from application instrumentation; scopes differ and do not add up directly to HTTP latency |
| lockSamples.meanBlocked / maxBlocked | Sampled number of runtime sessions waiting on locks, not lock latency in milliseconds |
| ledger.reconciled and counts | Consistent snapshot checks after each phase |

Each phase reconciles the ledger, and the script fails if not all scheduled responses succeed. There is **no TPS or latency pass/fail threshold**. The report is written at the end; after an error, a previous report may still exist. Check command exit status and report freshness.

Diagnostics include database settings, table/index statistics, `pg_stat_io`, filtered statement statistics and EXPLAIN ANALYZE BUFFERS JSON for wallet lookup, funding lookup and wallet history. Statistics are cumulative and can lag; `n_live_tup` is not an exact reconciliation count. Statement statistics exclude query text/binds. Small tables can reasonably use sequential scans; compare actual/estimated rows and buffers on representative data instead of forcing index scans.

The driver is closed-loop: workers send their next request after finishing the previous one. Short local samples are sensitive to cache, JIT, phase order and host load. Repeat under comparable conditions and use longer, representative workloads before making capacity claims. Do not disable durability or autovacuum to improve numbers.

## Logical backup and restore drill

After benchmark has populated the test database:

```sh
npm run db:restore-drill
```

The script builds, locks the test workflow, reconciles the source and fingerprints the four application tables plus `SequelizeMeta` in stable row order. It uses `pg_dump` inside the configured Docker container to dump schema `public` in custom format without ownership/ACLs, then restores into a newly created `wallet_restore_<random>` database.

It reapplies grants/function ACLs, compares the data/migration fingerprint, reconciles again, and checks that runtime can reconcile but lacks UPDATE privilege on the ledger. This is a selected permission check, not a rerun of the full permission suite or a fingerprint of every DDL/ACL object.

Outputs are `artifacts/wallet-test.dump` and `artifacts/restore.json`. Expected report flags are `identical: true`, `runtimeGrantsVerified: true`, and reconciled before/after counts. Cluster roles are provisioned separately by bootstrap; monitoring is set up separately. Scratch databases are dropped in finally, while dump/report remain. A hard-killed process may leave a scratch database; inspect its identity before any manual cleanup.

This drill does not establish PITR, HA/failover, RPO/RTO, whole-cluster recovery or survival of host/storage loss. Production backup needs off-host storage, retention, encryption and rehearsed objectives. Restoring to an earlier point can roll back deduplication state while a PSP still considers a payment processed; reconcile external payment state before replaying external effects.

## Troubleshooting

| Symptom | What to check / next step |
| --- | --- |
| Docker/Compose unavailable | Confirm Docker is running and `docker compose version` works in the same shell |
| Port 5439/3000 already occupied | Identify the current service; stop the intended local process or update configuration consistently |
| Existing PostgreSQL storage differs | Inspect the mounted volume, then bootstrap/adopt it; do not delete data to silence the check |
| Authentication failure after bootstrap | Check stale process environment overrides and generated file precedence without printing passwords |
| API rejects privileged runtime role | Use the generated app connection, not admin/migrator/test owner; check ownership/membership |
| Refusing test migration/cleanup | Verify target/allowlist, marker, role and dev CONNECT denial; rerun proper bootstrap instead of bypassing the guard |
| Another test/benchmark/restore or migration runner is active | Wait for the existing job to finish; inspect active jobs before terminating anything |
| Concurrency barrier did not observe blocking | Check pool size, unrelated runtime work, machine load and lock timing; two competing requests need to reach PostgreSQL |
| 503 server_busy | Admission is full; investigate slow handlers and active work |
| 503 database_busy | Inspect pool acquisition, blocking sessions and statement times; more pool connections may worsen a hot wallet |
| 422 turnover_locked / insufficient_funds | Inspect all three counters and fixture multiplier; a business rejection may be expected |
| Statistics/monitoring query fails | Verify preload/restart configuration, then run db:stats:enable; do not reset global stats casually |
| Restore cannot find container/database | Verify PG_CONTAINER and that source/admin URLs refer to that container |
| Nonzero legacy migration refused | Stop and design a verified opening ledger; do not change real balances to zero |

Record the failing command, exit code, case name/error code and environment without exposing URL credentials or raw payment payloads. A timeout/disconnect alone is not evidence that a client debit did not commit; apply the retry limitations in [Decisions](DECISIONS.md).
