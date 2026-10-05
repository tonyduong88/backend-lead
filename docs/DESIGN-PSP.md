# Part B — Integrating the 50th PSP

Keep provider-specific trust and format handling outside the wallet core. Each adapter receives original bytes and headers, verifies authenticity, then returns a normalized event. It must not read or write wallets. The existing mock demonstrates the boundary while preserving `POST /psp/callbacks`; it is unsigned and must be disabled in production.

```mermaid
flowchart LR
    P[PSP webhook] --> R[Raw-body route and size limit]
    R --> A[Trusted registry and provider adapter]
    A --> V[Verify and normalize]
    V --> S[Core callback service]
    S --> D[Wallet lock, funding lock, atomic DB writes]
    D --> C[Commit]
    C --> K[Provider-specific acknowledgement]
```

**Implemented contract.** [`PspAdapter`](../starter/src/integrations/psp/types.ts) exposes `verifyAndNormalize({ rawBody, headers })` and `acknowledgement(result)`. Events contain provider, PSP reference and string amount; terminal events carry completed/failed, while observations carry pending with an optional amount. The mock accepts only completed/failed. Pending observation handling is tested directly at the service boundary and cannot move a terminal record backwards.

**Verification and normalization.** A real adapter would verify signatures against original bytes according to the provider protocol, using appropriate constant-time comparison, timestamp/replay checks and key rotation where supported. It would validate merchant/account, environment and currency before invoking core logic. Minor units must be converted through decimal/string arithmetic using the configured currency exponent, never JavaScript Number. Unknown statuses must be rejected, not guessed as failed. Provider selection comes from trusted routing/configuration, not a provider name supplied in the body.

**Configuration.** Extend the registry/configuration with an enabled flag, contract version, account/environment, currency scale, mapping and secret references. Secrets belong in the deployment's secret manager. The current registry only implements mock selection and its kill switch; a general multi-provider configuration system and outbound payment calls are proposed extensions, not completed features. Deposit creation currently assigns the mock provider and must be wired to a trusted provider selection when adding a real integration.

**Retries and ordering.** The core deduplicates the monetary effect using persisted `(provider, pspRef)` and funding state under lock. Event IDs can support audit but are not the financial identity. Conflicting terminal states or amount mismatches require investigation/reconciliation, not automatic credit reversal. A provider-specific ACK is produced after commit. If a provider requires earlier acknowledgement, first persist an inbox record and process it with an idempotent worker; an in-memory queue is not sufficient.

**Offline onboarding.** A junior engineer starts from the adapter contract, adds configuration and fixtures, implements verification/mapping, and runs the shared core suite plus adapter tests before sandbox rollout and review. Fixtures should include success/failure/intermediate/out-of-order messages, duplicates, invalid signatures, rotated keys, expired timestamps and amount/currency mismatch. Use test keys and independently specified signature vectors; CI must not require a live PSP. Current tests cover mock fixtures, malformed data, registry behavior, exact raw-byte delivery, replay, conflict and wallet invariants. Actual cryptographic/provider tests must be added against the chosen PSP specification.

**Operational follow-through.** Add provider/status/retry-lag metrics, redacted correlation IDs and settlement reconciliation. Outbound create-payment/payout calls belong outside the wallet transaction, with provider idempotency and an outbox when durable dispatch is needed. One-day onboarding is a reasonable goal only when protocol documentation, credentials, fixtures and review support already exist; waiting for the provider is an external dependency.
