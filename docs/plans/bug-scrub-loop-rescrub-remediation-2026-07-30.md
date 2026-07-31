# Bug Scrub Loop Remediation Plan — Iteration 2

Status: Implementing (Phase 1 delivered; Phase 2 complete locally, delivery pending)

Run: `bug-scrub-loop-20260730t000000z-361d68a`

Source SHA: `9a2c31af176bc61fed219d3257516d910919e480`

Target branch: `main`

Scope: whole repository

Blocking gate: every confirmed P0-P2 finding below must be resolved by merged,
target-CI-verified delivery before another fresh whole-repository rescrub.

## Goal

Repair the 13 confirmed iteration-2 correctness and security defects with
failing-first behavioral tests, small independently mergeable phases, protected
branch delivery, and no unrelated refactoring.

## Non-goals

- Product redesign, visual restyling, dependency upgrades, or version bumps.
- Starting a stopped Sanctuary application stack.
- Treating in-process state as authoritative for cross-process coordination.
- Broad API redesign beyond the wallet discriminator required for transaction
  identity and the response redaction required for webhook credentials.

## Invariants

- Every phase is delivered from a loop-owned branch through a reviewed PR.
- Existing error envelopes and authorization semantics remain stable.
- A backup advertised as complete is a single point-in-time database snapshot and
  is published under its final name only after the complete file is durable.
- Redis-backed coordination fails closed when Redis was selected as the
  distributed authority; local locks remain available only in explicitly
  single-process/no-Redis operation.
- BullMQ retry and DLQ behavior reflects actual handler success or failure.
- Webhook static-header secret values are never returned to any caller.
- Every outbound LLM provider hop is policy-checked before credentials or request
  content leave the process.
- A transaction row is identified by `(walletId, txid)` throughout the API and UI.
- Every production fix has a behavioral regression test, including concurrency,
  null/error, and boundary cases.

## Findings

| ID | Severity | Failure |
| --- | --- | --- |
| `backup-export-not-point-in-time-snapshot` | P1 | Backup tables and pages use independent Prisma reads, so concurrent writes can produce child-without-parent exports or omit rows around a cursor. |
| `scheduled-backup-non-atomic-publication` | P1 | Scheduled backup writes directly to its final retained filename; interruption leaves a truncated file that retention treats as valid. |
| `api-client-retries-non-idempotent-mutations` | P1 | The browser client automatically retries ambiguous POST/PUT/PATCH/DELETE network and 5xx failures without idempotency keys. |
| `distributed-lock-acquisition-fails-open` | P1 | A Redis command error falls through to a process-local lock, so separate workers can both acquire the same distributed key. |
| `transfer-confirm-serialization-conflict-http-500` | P2 | Confirm uses a serializable transaction without retry or domain mapping, exposing ordinary concurrent confirmation conflicts as HTTP 500. |
| `recurring-readiness-process-local-completions` | P2 | Recurring freshness uses completion timestamps observed only by one worker process, causing other replicas to become falsely unready. |
| `webhook-static-header-credentials-exposed-to-viewers` | P2 | Viewer-authorized webhook reads return stored arbitrary static header values, including credentials. |
| `llm-egress-redirect-bypasses-provider-endpoint-policy` | P2 | Provider URLs are checked only before a default-following fetch, allowing a redirect to an otherwise denied destination. |
| `worker-handler-failures-bypass-retry-and-dlq` | P2 | Wallet sync and confirmation handlers catch operational failures and resolve successfully, bypassing configured attempts and exhausted-job handling. |
| `dead-letter-queue-is-process-local` | P2 | Worker failures populate one process's in-memory DLQ while the API reads another; Redis restoration is deliberately unimplemented. |
| `recurring-interval-cron-conversion-corrupts-cadence` | P2 | Valid intervals such as 90 seconds or 90 minutes are floored into cron expressions with different execution frequencies. |
| `transaction-detail-txid-lookup-crosses-wallet-context` | P2 | The schema permits the same txid in multiple wallets, but detail and RBF callers query by txid alone and can receive another accessible wallet's row. |
| `transaction-deep-link-cannot-resolve-beyond-loaded-page` | P2 | A generated `?tx=` link resolves only against the first 50 loaded transactions, so older selections become empty after refresh or sharing. |

## Phase 1 — Snapshot-safe, atomically published backups

Findings: `backup-export-not-point-in-time-snapshot`,
`scheduled-backup-non-atomic-publication`.

- [x] Add a real-PostgreSQL barrier test that inserts a related parent/child pair
      between exported tables and inserts around a paginated cursor. Prove the
      completed backup represents one consistent database snapshot.
- [x] Run all table pages and the applied-schema-version read through one injected
      Prisma transaction client at `RepeatableRead`, with explicit transaction
      timeout and cooperative abort checkpoints between queries.
- [x] Keep dynamic model access behind a small typed adapter rather than adding
      per-table exceptions or bypassing the repository boundary elsewhere.
- [x] Add interruption tests for write, sync, rename, retention, and abort.
- [x] Write in the configured backup directory to a unique non-final temporary
      name, sync and close the file, atomically rename it to the final name, and
      best-effort sync the directory where supported. Remove only the owned
      temporary file on failure.
- [x] Make retention count only parsed, policy-valid complete backups. Ignore and
      separately clean stale temporary files; never let a corrupt final-looking
      file evict a valid backup.

Acceptance:

- Concurrent writes cannot create a backup state impossible at a single database
  snapshot, including across pagination.
- No partial file is visible under a retained final filename.
- Focused unit tests, real-PostgreSQL concurrency tests, backup round-trip tests,
  typechecks, repository-boundary checks, and full backend coverage pass.

Rollback: no schema or format change; rolling back code leaves previously
published valid backups readable.

Delivery: one backend backup PR.

## Phase 2 — Retry-safe browser mutations

Finding: `api-client-retries-non-idempotent-mutations`.

- [x] Add deferred-fetch tests for GET and every state-changing method where the
      server may have committed before the client sees a network error or 5xx.
- [x] Make automatic transport retries default only for safe/idempotent reads.
      Preserve the single authentication-refresh replay policy separately from
      transport retries.
- [x] Do not add a generic mutation-retry opt-in in this phase. A future retryable
      mutation must have an endpoint-enforced stable idempotency key, a separately
      typed client contract, and reuse the same key across transport attempts and
      authentication refresh.
- [x] Audit all client wrappers and file-transfer helpers so method inference,
      custom methods, omitted methods, and `upload` use the same policy. Add an
      inventory test proving no current mutation opts into transport retries.
- [x] Lock an exact request-count matrix: GET network/503 retains bounded backoff;
      POST/PUT/PATCH/DELETE/upload network or 5xx sends once; mutation
      401→refresh→200 sends exactly two operation requests; mutation
      401→refresh→network/503 still sends exactly two and surfaces the replay
      failure. For GET, share one counter across pre/post-refresh execution:
      at most `maxRetries` transport retries plus one authentication replay, so
      total operation calls are at most `1 + maxRetries + 1` (five by default);
      refresh never resets the counter. Test 503→401→refresh→503 and
      503×N→401-at-the-last-transport-attempt boundaries. Retain single-shot
      behavior for refresh-exempt auth endpoints and refresh failure.

Acceptance:

- Ambiguous mutation completion produces one surfaced error and no automatic
  duplicate request.
- Existing GET retry/backoff, timeout, refresh, and download behavior remains
  covered.
- Frontend API tests, app/test typechecks, lint, and full coverage pass.

Rollback: internal retry default only; endpoint request/response shapes do not
change.

Delivery: one frontend API-client PR.

## Phase 3A — Fail-closed distributed-lock authority

Finding: `distributed-lock-acquisition-fails-open`.

- [x] Define an immutable authority mode during initialization. Production is
      `redis-required` under the current configuration contract; local mode is
      explicit and test/single-process only, never inferred from connection state.
- [x] Add two-process tests proving `SET` rejection and
      disconnected/reconnecting/not-ready Redis cannot grant the same key to two
      workers.
- [x] Make acquire/withLock/isLocked distinguish `held` from
      `authority_unavailable`. Ensure subscription election, wallet sync, and
      maintenance callers delay/retry without performing unlocked work.
- [x] Ensure subscription management does not catch authority unavailability and
      relabel it as ordinary ownership by another process.

Acceptance:

- Configured Redis failure never silently weakens distributed exclusion.
- Every lock caller treats unavailable authority as an infrastructure failure,
  not lock contention.
- Focused unit tests, real two-process Redis proofs, typechecks, and full backend
  coverage pass.

Rollback: preserve lock keys. Roll back if worker startup or deliberate test-local
mode regresses.

Delivery: one distributed-lock/caller-migration PR.

Implementation verification:

- Explicit local mode is confined to unit/single-process tests; API, worker, and
  MCP entrypoints select Redis-required authority only after Redis initializes.
- Focused distributed-lock, worker, Electrum, and sync-service suites pass
  (316 tests), and the full backend suite passes 10,451 tests with literal 100%
  statements, branches, functions, and lines.
- Production/test typechecks, server lint and safety guards, Prisma boundaries,
  blocking-I/O, architecture links, complexity, large-file classification, and
  diff hygiene pass. Redis-gated two-process probes are committed for CI because
  no local Redis service is running.
- Independent adversarial review found and drove fixes for wallet retry
  retention, API subscription recovery, initial-setup shutdown cleanup, and
  rapid stop/start generation handoff; the final pass is clear of P0-P2
  findings.

## Phase 3B — Globally truthful recurring scheduling

Findings: `recurring-readiness-process-local-completions`,
`recurring-interval-cron-conversion-corrupts-cadence`.

- [x] Replace process-local recurring completion authority with versioned durable
      Redis scheduler-generation records written only from successful BullMQ
      scheduler jobs whose `repeatJobKey`, recurrence fingerprint, and
      unpredictable job-carried generation token match the active generation.
      Manual same-name jobs cannot refresh readiness.
      Generation activation time, completion time, TTL, restart, Redis
      read/write failure, recovery, and stale scheduler-ID cleanup are tested.
- [x] Test two worker instances where either instance consumes a recurring job and
      both converge on the same freshness result by their next health read,
      including restart without a process-local grace reset.
- [x] Extend recurring definitions to use BullMQ's millisecond `every` strategy
      for configurable intervals while retaining cron only for calendar
      schedules with explicit UTC timezone. Define and test 1 second, 90 seconds,
      90 minutes, exact hours, defaults, strategy migration, and invalid/overflow
      boundaries without flooring or duplicate future occurrences.

Acceptance:

- All healthy replicas derive recurring freshness from the same durable
  scheduler generation; Redis failures fail readiness closed.
- Configured recurrence is either represented exactly or rejected with a clear
  startup validation error.
- Focused unit tests, real two-process Redis proofs, typechecks, and full backend
  coverage pass.

Rollback: preserve queue names and scheduler IDs. Roll back if
startup/readiness compatibility regresses.

Delivery: one recurring-scheduling PR.

Verification and review:

- Production and test TypeScript pass; 103 focused recurring/queue tests pass,
  with three committed Redis-gated integration proofs skipped locally because
  `REDIS_URL` is unset.
- Full backend coverage passes 471 files and 10,469 tests with 100% statements,
  branches, functions, and lines. Server lint and safety guards, architecture,
  blocking-I/O, large-file classification, changed-file `CCN <= 15`, and diff
  hygiene pass.
- Two independent adversarial reviews drove fixes for per-scheduler write
  latching, durable grace identity, malformed-generation repair, completion
  authenticity, first-job publication ordering, cross-clock comparisons, and
  same-recurrence remove/re-add races. Both final reviews are clear of P0-P2
  findings.

## Phase 4 — BullMQ failure and durable DLQ semantics

Findings: `worker-handler-failures-bypass-retry-and-dlq`,
`dead-letter-queue-is-process-local`.

- [x] Add queue-backed tests proving transient wallet sync and confirmation errors
      consume configured attempts and exhausted jobs create one retriable DLQ
      entry.
- [x] Keep best-effort status cleanup/logging, then rethrow operational failures.
      For multi-wallet confirmation updates, process the batch deterministically,
      collect failures, and reject the job after successful wallets are handled.
- [x] Make Redis the canonical DLQ store when configured, with indexed/listable
      entries, atomic add/update/claim/ack behavior, TTL, bounded retention,
      and startup-independent reads.
- [x] Use a direct Redis repository with propagated errors and Lua/MULTI atomicity;
      the best-effort cache abstraction is not an authority. Give each exhausted
      job a stable identity such as `(queue, jobId, exhaustedAttempt)` and
      atomically upsert duplicate failure events.
- [x] Persist a versioned job envelope containing queue, job name, original data,
      and retry-relevant options. Add startup/periodic reconciliation from
      BullMQ's exhausted failed jobs so a fire-and-forget event callback is not
      the sole durability boundary.
- [x] Make every consumer—including admin list/stats/retry and support-package
      collectors—query the async canonical store. Preserve an in-memory
      implementation only for explicit test/single-process mode.
- [x] Replace destructive retry dequeue with claim/lease/ack: atomically claim
      using a token and expiry, await the canonical BullMQ dispatcher, acknowledge
      deletion only after accepted enqueue, and release or recover failed/expired
      claims.
- [x] Decode the versioned operation envelope and route wallet sync through the
      awaited worker sync queue; never report retry success from a void in-process
      emitter or an incompatible top-level payload.
- [x] Add worker-process/API-process and restart tests proving visibility,
      expiration, Redis-error behavior, duplicate failed events, interrupted
      callbacks, reconciliation, concurrent admin claims, enqueue false/error,
      process death at each claim/enqueue/ack boundary, and lease recovery.
- [x] Add an end-to-end exhausted `sync-wallet` → API retry → accepted BullMQ job
      test and API-process support-package tests against worker-produced entries.

Acceptance:

- BullMQ sees operational failure until success or attempt exhaustion.
- The API can list and retry entries produced by another worker or before restart.
- Each exhausted job yields exactly one visible entry despite duplicate events,
  callback interruption, or worker restart.
- Retry never loses an entry and accepts at most one concurrent redispatch.
- Focused queue/DLQ tests, real Redis integration, typechecks, admin API contracts,
  and full backend coverage pass.

Rollback: preserve DLQ response schema and job payload shapes; Redis keys are
versioned so rollback can ignore them safely.

Delivery: one worker/DLQ PR.

## Phase 5 — Serializable transfer confirmation

Finding: `transfer-confirm-serialization-conflict-http-500`.

- [ ] Add a real-PostgreSQL barrier test for two confirmations of the same accepted
      transfer and adapter-level tests for Prisma serialization error variants.
- [ ] Extract and reuse the bounded full-transaction serialization-conflict
      classifier/retry policy already used by transfer initiation.
- [ ] On retry, re-read state inside the new serializable snapshot. Return one
      success and map the losing confirmation to the existing conflict envelope;
      never replay only a fragment of the ownership mutation.
- [ ] Test retry exhaustion, expiration, owner changes, wallet and device paths,
      and logging without leaking internal database errors.
- [ ] Race confirm against cancellation and expiry cleanup. Assert one legal
      terminal state, no ownership mutation when cancellation/expiry wins, and no
      raw P2034/P2010/internal error on either path.

Acceptance:

- Concurrent confirmation produces one committed ownership transfer and one
  deterministic domain conflict, never HTTP 500 or duplicate side effects.
- Transfer unit/integration tests, real PostgreSQL proof, typechecks, repository
  boundaries, and full backend coverage pass.

Rollback: no schema or public success-shape change.

Delivery: one transfer-service PR.

## Phase 6 — Webhook header credential confidentiality

Finding: `webhook-static-header-credentials-exposed-to-viewers`.

- [ ] Add owner/approver/signer/viewer authorization-matrix tests across list,
      detail, delivery history, replay, create, and update responses using
      `Authorization`, `X-API-Key`, and arbitrary header names. Treat every
      configured static header value as secret, independent of its name.
- [ ] Pass the authorized wallet role into response projection and omit/redact all
      static header values for every caller, preserving safe HMAC configuration
      and configured header names/presence. Missing or unknown role fails closed.
- [ ] Never re-disclose stored static header values, including to owners. Define
      one wire contract: responses omit `headerConfig.headers` values and expose
      an additive `configuredHeaderNames` list while retaining non-secret HMAC
      configuration. In PATCH input, an omitted `headers` map preserves all
      values, string entries set/replace individual names, and explicit `null`
      entries delete individual names. Reject output-only redaction markers as
      input; test retain, partial replacement, removal, literal marker rejection,
      and auth-type changes in service, OpenAPI, client, and UI layers.
- [ ] Redact every configured static header value before persisting delivery
      diagnostics; name-based `authorization`/`signature` matching is
      insufficient.
- [ ] Add an idempotent legacy-data scrub for existing
      `WebhookDelivery.requestHeadersRedacted`, defense-in-depth response
      projection for unsanitized rows, and restore-time sanitization so old
      backups cannot reintroduce values. Seed legacy arbitrary-header credentials
      and prove list, replay, restore, and subsequent reads remain redacted.
- [ ] Ensure logs, audit records, OpenAPI examples, delivery diagnostics, and
      create/update responses follow the same redaction contract.

Acceptance:

- No caller can recover any configured static header value through webhook reads,
  writes, delivery history, replay, diagnostics, logs, or audit data.
- Owners can retain, replace, and remove headers without accidentally blanking
  hidden values.
- Focused webhook API/service/UI tests, typechecks, OpenAPI contracts, and full
  backend coverage pass.

Rollback: response fields remain structurally compatible; redacted markers must
not be accepted as literal replacement secrets.

Delivery: one webhook security PR.

## Phase 7 — Redirect-safe LLM provider egress

Finding: `llm-egress-redirect-bypasses-provider-endpoint-policy`.

- [ ] Add local-server tests for relative and absolute redirects, denied private
      targets, chains/loops, missing `Location`, 301/302/303 method conversion,
      307/308 body preservation, cross-origin credentials, chained origin
      changes, same-host/different-port redirects, and HTTPS downgrade.
- [ ] Add one shared manual-redirect fetch helper that resolves each `Location`,
      evaluates every hop with `evaluateProviderEndpoint`, resolves and validates
      every DNS answer according to policy mode, connects to one validated/pinned
      address with the original Host/SNI, and enforces a small redirect limit.
- [ ] Add resolver/transport tests for multiple DNS answers, rebinding,
      IPv4-mapped IPv6, and public-host-to-private-address resolution.
- [ ] Specify the redirect state machine: compare canonical origins by scheme,
      hostname, and effective port; 301/302 convert POST to GET and 303 converts
      non-GET/HEAD to GET; conversions drop body/entity headers; 307/308 preserve
      method/body only after destination validation. Strip authorization on any
      cross-origin hop and never reconstruct it later in a chain. Reject HTTPS
      downgrade.
- [ ] Use one abort deadline for the complete chain rather than resetting timeouts
      per hop.
- [ ] Route chat/completion, model listing, Ollama detection, and provider tests
      through the helper so no provider fetch keeps default redirect following.
- [ ] Add one raw-byte response cap shared by chat success/error, model listing,
      and detection. Abort the stream on oversized fixed-length or chunked bodies
      and return a sanitized bounded error.

Acceptance:

- No request body or credential reaches a redirect destination before that exact
  URL and the connected address pass endpoint policy.
- All provider call sites share one tested redirect contract.
- Proxy unit/integration tests, build, typecheck, lint, and full coverage pass.

Rollback: provider configuration schema remains unchanged; redirect-dependent
providers may fail closed with a clear bounded error.

Delivery: one LLM-egress proxy PR.

## Phase 8 — Wallet-scoped transaction identity and durable deep links

Findings: `transaction-detail-txid-lookup-crosses-wallet-context`,
`transaction-deep-link-cannot-resolve-beyond-loaded-page`.

- [ ] Add repository/API tests with the same txid in two accessible wallets and
      distinct wallet-specific labels. Require wallet scope in the canonical
      detail lookup and return 404 for inaccessible/mismatched wallet context.
- [ ] Make `GET /wallets/:walletId/transactions/:txid` the canonical detail route.
      Legacy `/transactions/:txid` returns 404 for zero accessible matches, the
      sole row for exactly one, and deterministic 409 without data for multiple
      accessible matches. Preserve its JSON body and carry deprecation through
      HTTP `Deprecation`, `Sunset`, and `Link` headers. Document removal in the
      next major API version and test 0/1/2 accessible matches plus inaccessible
      scope.
- [ ] Make `GET /wallets/:walletId/transactions/:txid/raw` canonical for signing.
      The legacy raw route preserves external mainnet lookup when there are zero
      accessible stored matches, uses the sole accessible row/network when there
      is one, and returns 409 without bytes when there are multiple matches. Its
      existing success JSON body remains unchanged and uses the same deprecation
      headers. Cover both routes in OpenAPI and 0/1/2-match integration tests.
- [ ] Migrate and detail-test JSON detail, raw-signing lookup, frontend
      `getTransaction`, RBF status/check, RBF creation and label copying, OpenAPI,
      and all unit/integration callers. Every persisted-transaction lookup on
      those paths receives walletId; test duplicate txids with different labels
      and networks.
- [ ] Add refresh/share tests for a selected transaction older than the initial
      50-row page, including invalid txid, route changes, rapid URL changes,
      delegated lists, unmount, and stale response completion.
- [ ] Resolve owned `?tx=` selection through the permission-checked wallet-scoped
      detail endpoint when absent from the loaded page. Give that fetch the same
      request-generation ownership as ordinary detail loading and avoid duplicate
      requests after the row enters the list.
- [ ] Define an `idle | loading | resolved | not-found | error` state keyed by
      normalized `(walletId, txid)`. Pass explicit walletId to owning lists; one
      fetch populates selected summary and detail; only the current generation may
      commit. Clear `?tx` only for current-generation invalid/404/replaced state;
      retain it and show a retryable error for network/5xx. Delegating lists never
      fetch from URL state.
- [ ] Render a resolved off-page detail even when the visible/filtered list is
      empty. Test zero rows, filtered rows, 404 vs 500, retry, delegated lists,
      wallet A→B with the same txid, stale A completion, and no duplicate fetch
      when the row later enters the list.

Acceptance:

- Transaction detail and RBF always use the requested wallet's row.
- Any authorized transaction link generated by the app resolves after refresh
  regardless of list pagination; invalid links do not retain stale selection.
- Focused repository/API/component tests, real database duplicate-tx proof,
  OpenAPI contracts, frontend/backend typechecks, lint, and full coverage pass.

Rollback: keep compatibility only where wallet identity is unambiguous; frontend
and backend changes land in the same PR.

Delivery: one full-stack transaction PR.

## Delivery and loop closeout

For every phase:

1. Refresh `origin/main`, rebase the loop-owned branch, and rerun focused checks.
2. Re-read the phase diff for root-cause completeness, reuse, complexity, tests,
   and scope creep; obtain independent adversarial review.
3. Commit, push, open/update the PR, monitor all required CI and review feedback,
   fix failures, and merge only when green.
4. Verify target-branch ancestry and post-merge CI, record merge SHA/evidence, then
   clean only loop-owned branches/worktrees.
5. Rebuild only Sanctuary application containers already running at loop start;
   do not start a stopped stack.

After all phases:

- Run a fresh complete eight-domain scrub at the new exact target SHA.
- If any P0-P2 finding remains or appears, create another reviewed plan and repeat.
- Complete only when a full scrub has zero P0-P2 findings, all owned resources are
  cleaned, target CI is green, deployment handling is recorded, and local
  `main` exactly matches `origin/main`.
