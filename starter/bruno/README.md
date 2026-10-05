# BE Lead — Complete Mini Wallet collection

This is the full reviewer-facing Bruno collection for the current implementation. It uses **OpenCollection YAML**. The smaller `.bru` and Postman JSON collections are available in the parent folder.

## Open and run

1. Set up the application using [the English setup guide](../../docs/SETUP.md) and start it from `starter/` with `npm run dev`.
2. In a Bruno version supporting OpenCollection YAML (3.0+), choose **Open Collection** and select this `starter/bruno/import` folder, whose root is `opencollection.yml`. Do not select the parent `bruno` directory or import this as Postman JSON.
3. Select the **Local** environment. `baseUrl` defaults to `http://localhost:3000`; change it if your local API uses another port. No credentials are required by the starter API.
4. Use Collection Runner to execute all requests **sequentially, in numeric order**. Do not run them in parallel. Scripts must be enabled: creation responses supply IDs for subsequent requests.
5. Inspect each request's Tests result. Expected 400/404/409/422 responses are successful checks when their status and error assertions pass.

Format reference: [Bruno OpenCollection YAML documentation](https://docs.usebruno.com/opencollection-yaml/overview).

This collection makes actual writes through the running API, normally to the development database. It does not switch the server to the test database, truncate data, or delete existing records. Run it only against a local disposable/review instance, especially the maximum-money scenario. Every scenario starts with a fresh member; repeated full runs create additional members and financial history.

## Scenarios and expected results

There are **96 numbered requests**, covering all seven current endpoints. Each scenario below can be run as a contiguous selection from its Create Member request through its final wallet check. When sending individual requests, run their prerequisites first; runtime variables must come from that same scenario.

| Range | Scenario | What it checks |
| --- | --- | --- |
| 001–023 | Core flow and callback states | Health/member; default multiplier 1; Pending does not credit; complete and equivalent-decimal replay; terminal mismatch/conflict; multiplier 0 funding; exact turnover boundary; withdrawal; failed callback/replay/conflict |
| 024–061 | Validation and rejected requests | Duplicate/invalid usernames; unknown and invalid IDs; invalid money/multipliers/extra fields; callback contract rejection; insufficient balance; missing route; unchanged wallet |
| 062–072 | Mismatch recovery and precision | Wrong amount while Pending has no effect; later correct callback works; exact 18-digit decimal addition; smallest wager and withdrawal preserve precision |
| 073–083 | Cumulative turnover carryover | Failed wager does not accrue; previous accrued turnover satisfies a new multiplier-2 deposit; withdrawal keeps counters |
| 084–096 | Product and aggregate overflow | Reject MAX×2; fund maximum amount; reject another credit without changing wallet; free capacity, retry Pending callback successfully, then replay without crediting twice |

Core flow: complete 100×1 and 50×0 → wager 99.99 → still locked by 0.01 → wager 0.01 → withdraw 10. Final wallet is **balance 40, required 100, accrued 100**. The later failed deposit leaves those counters unchanged.

Precision flow ends at **balance `0.300000000000000001`, required `0.000000000000000000`, accrued `0.000000000000000001`**. Carryover ends with balance 0 and both turnover counters 20. Overflow ends at maximum supported balance `999999999999999999.999999999999999999`, with zero required/accrued turnover.

## Variables and assertions

`environments/Local.yml` contains only `baseUrl`, a deliberately missing UUID and an unknown PSP reference. It contains no real IDs or secrets. Each Create Member request generates a unique username using time/random text and saves `memberId` / `walletId`; successful deposits save their PSP reference and funding ID. Dynamic values use runtime `bru.setVar`, not persistent environment writes.

Every request asserts its expected HTTP status. Error samples also assert the API error code; meaningful success responses assert states/balances and wallet reads assert all three counters. Monetary expectations are quoted strings with exact precision. No money value is converted to a JavaScript number or compared using float arithmetic. Numeric input samples are intentional validation failures, not money calculations.

The collection tests HTTP-visible behavior. It cannot prove ledger cardinality/append-only permissions, true concurrency or rollback of every DB write solely from wallet reads. Run the PostgreSQL Jest suites for those guarantees:

```sh
# From starter/
npm test -- --runTestsByPath test/walletFlow.test.ts test/concurrency.test.ts test/databaseSafety.test.ts
```

There are no endpoints for withdrawal approval, real payouts, ledger listing or provider administration in this codebase, so no fictitious requests are included. Malformed transport payloads, resource exhaustion, runtime permission failures and DB fault injection remain in the dedicated test/tooling workflows rather than the sequential collection.

## Verification status

On **4 October 2026**, all **96 requests and 239 response assertions passed**
against the running compiled API and a fresh PostgreSQL instance. A lightweight
Node harness parsed the YAML, substituted runtime variables, sent real HTTP
requests and executed the existing scripts with `bru`, `test` and `expect`
compatibility methods. This verifies the collection's HTTP behavior and assertions,
but does not verify the Bruno UI or its importer. The existing Jest
`apiCollection.test.ts` independently passed the older 20-request Postman JSON.
See [Verification results](../../../docs/TESTING.md#verification-results) for the environment and limits.

On an actual run, unexpected 400 usually means malformed input or a missing runtime variable; 409 on Create Member can mean a stale/manual username; unexpected 422 requires checking the scenario's balance/turnover; connection errors require checking the server/baseUrl. Restart from the current scenario's Create Member when earlier steps were skipped or failed.
