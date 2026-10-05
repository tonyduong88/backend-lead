# Testing and Acceptance Guide

## Core checks

Run from `starter/` after [Setup](SETUP.md):

```sh
npm run build
npm run db:preflight:test
npm test -- --verbose
```

The build checks TypeScript compilation. Tests check behavior against PostgreSQL. `npm test` uses `NODE_ENV=test`, acquires a database advisory coordination lock, applies test migrations, then invokes Jest with `--runInBand`. Do not invoke Jest directly to bypass the wrapper.

Each database suite checks the owner/runtime roles, guards the target before TRUNCATE, restores spies after each test and closes its connections. Cleanup uses `wallet_test_owner`; API operations use restricted `wallet_test_app`. The API server does not need to be started separately.

## Suite inventory

| Suite | Cases in this snapshot | Main evidence |
| --- | ---: | --- |
| [members.test.ts](../starter/test/members.test.ts) | 2 | Member creation, zero wallet/readback and invalid username |
| [walletFlow.test.ts](../starter/test/walletFlow.test.ts) | 33 | Pending deposit, terminal/replay rules, turnover boundaries/carryover, precision, input rejection, overflow and atomic rollback |
| [concurrency.test.ts](../starter/test/concurrency.test.ts) | 11 | Duplicate callbacks, competing wagers/withdrawals, different deposits, conflicting callbacks, mixed races, FK-compatible locks, pool/timeout/deadline recovery |
| [databaseSafety.test.ts](../starter/test/databaseSafety.test.ts) | 10 | Restricted roles, dev/test isolation, append-only permissions/trigger, uniqueness, composite FK, CHECK/NOT NULL and durability settings |
| [requestSafety.test.ts](../starter/test/requestSafety.test.ts) | 5 | Original raw bytes, replay on a new app instance, disconnect/admission lifecycle, whole-transaction retry and runtime credential loading |
| [psp/contract.test.ts](../starter/test/psp/contract.test.ts) | 10 | Offline completed/failed fixtures, malformed provider data, registry and kill switch |
| [apiCollection.test.ts](../starter/test/apiCollection.test.ts) | 1 | All 20 published JSON collection requests and their assertions, followed by reconciliation |
| **Total** | **72 / 7 suites** | Parameterized cases count individually; the collection flow counts as one Jest case |

These are mostly integration tests, not isolated unit tests. The adapter contract cases are narrow offline tests without direct database operations, but the standard wrapper still performs database preflight/migration. Benchmark, migration verification and restore are separate scripts and are not included in the 72 cases.

## Acceptance mapping

| Assignment criterion | What to inspect |
| --- | --- |
| A1 — Pending deposit, amount/multiplier validation, no early credit | walletFlow default-multiplier case asserts persisted amount/state, zero ledger and reconciliation; invalid input cases reject numeric/nonpositive/exponent/excess-precision amounts and invalid multipliers |
| A2/A5 — Sequential duplicate callback | Two equivalent decimal representations receive 200; balance 100.5, required 201 and exactly one entry |
| A2/A5 — Concurrent duplicate callbacks | A real DB barrier blocks both requests before release; both receive 200, only one credit/turnover effect remains |
| A2 — Unknown/mismatched/conflicting callback | 404/422/409; mismatched Pending remains unchanged; later valid callback works; terminal replay cannot hide a wrong amount |
| A2 — Reconstructible append-only ledger | Balance/required/accrued reconciliation; runtime cannot UPDATE/DELETE/TRUNCATE ledger; owner UPDATE/DELETE hits the append-only trigger |
| A3/A5 — Concurrent wagers cannot overdraw | Two wagers of 80 against 100 produce one 201 and one 422, balance 20 and accrued 80 |
| A4/A5 — Turnover blocks/unblocks | Deposit 100×1 plus 50×0; outstanding 100, then 0.01, then withdrawal succeeds exactly at accrued=required; funding Pending and balance debit are asserted |
| Part B — Provider isolation/testing approach | Adapter fixtures/registry tests and HTTP raw-byte test; read [PSP Design](DESIGN-PSP.md) for real-provider extension work |

## How concurrency is made observable

[`raceOnWallet()`](../starter/test/helpers/database.ts) acquires a wallet `FOR NO KEY UPDATE` lock through the owner connection, starts the competing runtime requests, and polls PostgreSQL activity/blocking information until enough runtime sessions are blocked. It then rolls back the holder and awaits both requests.

This verifies actual contention rather than assuming two Promise calls overlapped. Suites run serially to avoid shared cleanup conflicts, but requests within a concurrency case run concurrently. The barrier checks blocked sessions for the test runtime role/database, so the environment must remain isolated from unrelated work using the same role.

Some races intentionally allow either serial outcome. For a callback racing a wager on an empty wallet, the wager may succeed after the credit or fail before it; the test asserts the corresponding final balance. For opposite terminal callbacks, one wins and the other conflicts. It does not require one request to win nondeterministically.

## Assertions beyond HTTP status

The shared reconciliation helper reads a read-only REPEATABLE READ snapshot and checks:

- Wallet balance and both turnover counters equal their respective ledger sums, and balance is nonnegative.
- Completed deposits have one linked entry, Pending/Failed deposits have none, and withdrawals have one debit entry even while Pending.

Financial cases also assert response values, funding state and ledger counts as appropriate. Not every case calls reconciliation; isolated validation/config/resource cases have their own assertions.

Fault injection fails a final funding update or a wallet update after earlier real database writes. Tests check that partial entries/projections disappear and that a later valid callback can succeed. The retry case injects SQLSTATE `40001` after a real Member insert, asserts two attempts and only one surviving row. It does not construct an actual deadlock or a lost connection during COMMIT.

## Focused runs and optional coverage

```sh
npm test -- --runTestsByPath test/concurrency.test.ts --verbose
npm test -- --runTestsByPath test/walletFlow.test.ts -t "sequential replay"
npm test -- --runTestsByPath test/apiCollection.test.ts
npm test -- --coverage --collectCoverageFrom="src/**/*.ts"
```

A filtered run does not replace the full suite. Coverage is optional; no coverage threshold is configured or percentage claimed here. With Jest's default coverage reporters, inspect `coverage/lcov-report/index.html`. Executed lines/branches do not measure the strength of assertions or exhaust all race schedules.

## Additional checks

| Command | Output/evidence | Important limitation |
| --- | --- | --- |
| `npm run db:verify-migrations` | `artifacts/migrations.json`; fresh schema and legacy fixture upgrade/refusal | Synthetic fixtures, not a production-data migration rehearsal |
| `npm run benchmark` | `artifacts/benchmark-<label>.json`; four workloads, latency, ACK/effect rates, metrics and reconciliation | Short closed-loop local workload; no performance pass/fail threshold |
| `npm run db:restore-drill` | `artifacts/restore.json` and logical dump; fingerprints, reconciliation and selected runtime grant checks | Not PITR, HA, storage-loss recovery or complete post-restore permission testing |

Follow [Runbook](RUNBOOK.md) for prerequisites and sequencing. A command must exit successfully and produce a current report; an older JSON file left by a prior run is not evidence that the latest run passed.

## Evidence boundaries

The fresh submission check on 4 October passed 7 suites/72 tests; see [Verification results](#verification-results) below for the environment and collection checks. New-app replay is not an OS/process crash test. There is no multi-process deployment race, real PSP signature test, full network-failure simulation, property-based/mutation suite or production capacity test. The collection runner uses a small `pm` shim and Supertest; it does not test the Postman/Bruno UI or every feature of those clients.


## Verification results

Checked on **4 October 2026**.

The submission was copied to a clean temporary directory without dependencies,
build output or local credentials. The documented setup was executed using
Node **23.9.0**, npm **10.9.2** and a fresh PostgreSQL **16.15** Docker instance. To preserve
an existing stopped local container, the verification copy used Compose project
`wallet-submission-review`, a dedicated volume and PostgreSQL host port **55439**
instead of **5439**. The submitted defaults remain unchanged.

| Check | Current result |
| --- | --- |
| `npm ci` | PASS; 496 packages installed from the lockfile |
| `npm run db:up` | PASS; fresh PostgreSQL container became healthy |
| `npm run db:bootstrap` | PASS; local roles, dev/test databases and separate credential files generated |
| `npm run db:migrate` | PASS; all four development migrations applied |
| `npm run build` | PASS |
| `npm run db:preflight:test` | PASS; isolated test database verified |
| `npm test` | **7 suites / 72 tests PASS**, 14.111 seconds |
| `npm start` | PASS; compiled API started at localhost:3000 |
| `npm run dev` | PASS; development API started and GET /health returned HTTP 200 |
| Full YAML collection over HTTP | **96 requests / 239 assertions PASS** |
| `npm run db:verify-migrations` | PASS; fresh schema and legacy upgrade, including nonzero legacy refusal |
| `npm run db:stats:enable` | PASS; statistics enabled on dev/test databases |
| `npm run benchmark` | PASS; default pool 5, four phases, 180/180 successful requests per phase, ledger reconciled |
| `npm run db:restore-drill` | PASS; 20 wallets / 141 funding rows / 1,561 ledger entries preserved, fingerprints match, runtime grants verified |

The YAML requests and their existing scripts were executed against the running
API with a lightweight Node harness implementing the collection's `bru`, `test`
and `expect` calls. This checks HTTP behavior and assertions; it does not verify
Bruno UI compatibility. The Postman JSON collection's 20 requests and scripts
also passed through the existing Jest harness. npm emitted deprecation warnings
for transitive dependencies; installation completed successfully.
