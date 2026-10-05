# API Contract and Reviewer Walkthrough

Base URL: `http://localhost:3000`. POST requests use `Content-Type: application/json`. UUID placeholders below must be replaced with IDs from responses. Monetary input is a positive decimal **string**, with at most 18 integer and 18 fractional digits, no exponent notation or surrounding whitespace. Computed monetary output is formatted with 18 fractional digits. The starter has a single monetary unit and no authentication.

## Endpoints

| Method/path | Body | Successful response |
| --- | --- | --- |
| GET `/health` | None | 200 health response after a DB connectivity check |
| POST `/members` | `{ "username": "reviewer-001" }` | 201 `{ member: { id, username }, wallet: { id, balance } }` |
| GET `/members/:memberId/wallet` | None | 200 `{ id, memberId, balance, requiredTurnover, accruedTurnover }` |
| POST `/deposits` | `{ "memberId": "<uuid>", "amount": "100", "turnoverMultiplier": 1 }` | 201 `{ id, pspRef, status: "Pending" }`; no credit yet |
| POST `/psp/callbacks` | `{ "pspRef": "<ref>", "status": "completed", "amount": "100" }` | 200 `{ id, status: "Completed" }`; matching replay has the same financial effect as one call |
| POST `/wallets/:walletId/wagers` | `{ "amount": "100" }` | 201 `{ id, walletId, amount, balance }` |
| POST `/withdrawals` | `{ "memberId": "<uuid>", "amount": "10" }` | 201 `{ id, status: "Pending", balance }`; debit is immediate |

Username length is 3–64 characters and usernames are unique. Deposit multiplier is a nonnegative safe integer, default 1 when omitted. Callback status accepts only lowercase `completed` or `failed`; a failed callback returns funding status `Failed` without credit. Mock callback payloads reject unsupported fields, including a self-declared provider.

Source: [routes](../starter/src/routes), [services](../starter/src/services), [mock adapter](../starter/src/integrations/psp/mockAdapter.ts).

## A complete example

For the full current Bruno collection, open [`starter/bruno`](../starter/bruno/README.md), select Local and run in numbered order. Its 96 OpenCollection YAML requests include the main flow, validation, precision, turnover carryover and overflow scenarios, with dynamic fixture IDs and response assertions. On 4 October, all 96 YAML requests and 239 assertions passed against the running API using a Node harness; Bruno UI compatibility was not exercised. The JSON collection is independently covered by Jest.

Import [mini-wallet.postman_collection.json](../starter/bruno/mini-wallet.postman_collection.json) into a compatible client, or send the requests below with your preferred HTTP tool. The collection contains all 20 requests and response scripts. It stores memberId, walletId and the relevant PSP references in collection variables. If an importer does not preserve scripts, copy those values from responses manually.

Bruno can also open `starter/bruno` as a collection and select Local. The `.bru` files do not include the JSON collection's two additional username-type/length cases numbered 07/08; the automated collection test uses the JSON file. Do not import `bruno.json` as a Postman collection.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Create a member with a new username; retain both IDs | 201; initial balance 0 |
| 2 | Deposit 100 with multiplier 1; retain pspRef | 201 Pending; balance remains 0 |
| 3 | Complete that deposit with callback amount `100` | 200; balance 100, required 100, accrued 0 |
| 4 | Repeat the exact callback | 200; counters unchanged; no additional credit |
| 5 | Deposit another 50 with multiplier 0 and complete it | Balance 150, required 100, accrued 0 |
| 6 | Attempt withdrawal 10 | 422 `turnover_locked`, outstanding 100 |
| 7 | Wager 100 | 201; balance 50, accrued 100 |
| 8 | Withdraw 10 | 201 Pending; balance 40 |
| 9 | GET the member wallet | Balance 40, required 100, accrued 100 |
| 10 | Send amount `99` for the first completed deposit | 422 `callback_amount_mismatch`; no counter change |
| 11 | Create a deposit 20 and send a matching failed callback | Pending → Failed; no credit or turnover effect |

The extra multiplier-0 deposit makes it possible to wager the required amount and still have funds to withdraw. Meeting turnover and having enough balance are independent conditions.

The final successful wallet read at step 9 includes:

```json
{
  "id": "<walletId>",
  "memberId": "<memberId>",
  "balance": "40.000000000000000000",
  "requiredTurnover": "100.000000000000000000",
  "accruedTurnover": "100.000000000000000000"
}
```

A blocked withdrawal includes:

```json
{
  "error": "turnover_locked",
  "outstandingTurnover": "100.000000000000000000",
  "requiredTurnover": "100.000000000000000000",
  "accruedTurnover": "0.000000000000000000"
}
```

## Failure and replay behavior

| Situation | HTTP / error |
| --- | --- |
| Invalid UUID, amount, multiplier or request schema | 400, typically `validation_error` |
| Malformed JSON | 400 `invalid_json` |
| Duplicate username | 409 `username_taken` |
| Unknown member/wallet for a money operation | 404 `member_or_wallet_not_found` |
| Wallet GET for a missing member | 404 with the existing starter message `wallet not found` |
| Unknown callback reference | 404 `funding_not_found` |
| Callback amount mismatch, including after terminal state | 422 `callback_amount_mismatch` |
| completed after Failed or failed after Completed | 409 `invalid_funding_transition` |
| Same valid terminal callback again | 200, no additional ledger effect |
| Insufficient spendable balance | 422 `insufficient_funds` |
| Insufficient turnover | 422 `turnover_locked` with counter details |
| Body over the configured 16 KB limit | 413 `payload_too_large` |
| Callback without expected JSON body / unsupported encoding | 415 `expected_json` / `unsupported_encoding`, as applicable |
| Admission limit reached | 503 `server_busy` |
| Relevant database timeout/abort/acquisition failure | 503 `database_busy` |
| Cooperative transaction deadline exceeded | 503 `transaction_deadline` |
| Unexpected failure | 500 `internal_error` |

Range overflow in otherwise valid arithmetic is a 422 business rejection. A 503 or broken connection does not by itself prove that any arbitrary client operation can be safely retried. Callback identity supports safe replay; wager/withdrawal requests do not yet have client idempotency keys.

For concurrency evidence, use [Testing](TESTING.md). A sequential HTTP demo cannot demonstrate that simultaneous callbacks/debits are safe.
