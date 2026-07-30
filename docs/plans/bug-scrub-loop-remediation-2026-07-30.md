# Bug Scrub Loop Remediation Plan — Iteration 1

Status: Reviewed (three recursive passes; final pass had no actionable comments)

Run: `bug-scrub-loop-20260730t000000z-361d68a`

Source SHA: `361d68a0f832bf61e78fa2b722175e23ba8a6738`

Target branch: `main`

Scope: whole repository
Blocking gate: every confirmed P0-P2 finding below must be resolved by merged,
target-CI-verified delivery before a fresh whole-repository rescrub.

## Goal

Repair the 17 confirmed iteration-1 correctness and security defects with
failing-first behavioral tests, small independently mergeable phases, protected
branch delivery, and no unrelated refactoring.

## Non-goals

- Product redesign, visual restyling, dependency upgrades, or version bumps.
- Production data repair, destructive migrations, or branch-protection changes.
- P3 hardening such as legacy clipboard fallback behavior.
- Starting a stopped local Sanctuary stack.

## Assumptions and invariants

- `main` remains protected; every phase uses a loop-owned branch and PR.
- The backend repository layer remains the only ordinary Prisma boundary.
- Existing public API shapes remain compatible unless a request is unsafe; unsafe
  requests fail closed with the existing error envelope.
- Complete backups preserve durable business/user data. Runtime sessions and
  one-time security tokens may be intentionally invalidated on restore, but they
  must be explicitly classified and deleted rather than silently left stale.
- Lock-loss remediation prioritizes preventing overlapping mutators. JavaScript
  promise rejection is not cancellation.
- Every code bug gets a behavioral non-regression test before its production fix.
- P3 backlog is outside the blocking fix set.

## Findings

| ID | Severity | Evidence and failure |
| --- | --- | --- |
| `complete-backup-can-silently-omit-durable-data` | P1 | `backupService/constants.ts` omits many durable Prisma models; `creation.ts` converts export failures to empty tables; restore only touches the incomplete manifest. |
| `distributed-lock-loss-leaves-mutating-handler-running` | P1 | `jobProcessor.ts` rejects a `Promise.race` on lock loss while `registered.handler(job)` continues, allowing BullMQ retry overlap. |
| `wallet-detail-route-state-cross-contamination` | P1 | `useWalletData.ts` resets only UTXOs, preserves failed auxiliary fields, and has no request-generation guard across wallet route changes. |
| `authenticated-electrum-probe-arbitrary-network-target` | P2 | `/api/v1/node/test` accepts any authenticated caller and passes arbitrary host/port to `net.connect` or `tls.connect`. |
| `payjoin-ssrf-validation-not-bound-to-network-hop` | P2 | Payjoin checks one DNS result, then unpinned `fetch` re-resolves and follows redirects. |
| `payjoin-response-body-unbounded` | P2 | Payjoin reads attacker-controlled success and error bodies with unbounded `response.text()`, allowing memory exhaustion and oversized error reflection. |
| `webhook-retry-enqueue-failure-strands-delivery` | P2 | Retry persistence ignores a `false` queue result and no due-row recovery loop exists. |
| `stale-migration-manifest-masks-pending-migrations` | P2 | A 28-entry legacy manifest is compared by count against 67 migration directories, so deploy can be skipped while current migrations are missing. |
| `expired-transfer-update-rolls-back` | P2 | Confirm updates an expired status and then throws inside the same transaction, rolling the update back. |
| `recurring-schedule-failure-leaves-worker-falsely-healthy` | P2 | Scheduling catches Redis failures as `null`; startup ignores them and health treats never-run jobs as healthy. |
| `transfer-ownership-check-outside-serializable-snapshot` | P2 | Initiation performs ownership reads through global clients inside a serializable callback. |
| `transaction-detail-late-response-overwrites-current-selection` | P2 | An older detail promise can replace the active transaction and clear its loading state. |
| `transaction-url-unresolvable-retains-prior-selection` | P2 | A present but unresolvable `?tx` leaves the prior transaction selected. |
| `send-route-change-retains-stale-wallet-form` | P2 | A shared mounted flag admits late prior-wallet loads; provider state can remain bound to new wallet props. |
| `docker-image-classifier-omits-frontend-build-inputs` | P2 | Root `package.json` and `public/*` affect `Dockerfile` output but do not select the frontend image. |
| `console-fallback-wallet-worth-plans-market-only` | P2 | Bare `worth` wins the first fallback and emits market status without selected-wallet data. |
| `console-wallet-set-tools-ignore-selected-scope` | P2 | Device and approval aggregate tools ignore `context.walletScopeIds`, unlike the dashboard tool. |

## Phase 1 — Complete backup integrity

Findings: `complete-backup-can-silently-omit-durable-data`.

- [ ] Add a schema/manifest contract test enumerating every Prisma model and
      classifying it as durable-restored, cache-optional, or security-ephemeral.
- [ ] Add failing backup tests for representative omitted FK chains
      (`DeviceUser`/`DeviceAccount`, webhook endpoint/delivery, vault policy and
      approval rows, feature flags/audit, AI conversation/message/insight).
- [ ] Add a failing test proving any table export error aborts backup creation
      instead of emitting a valid-looking empty table.
- [ ] Replace the ad hoc manifest with one dependency-ordered canonical table
      policy shared by create, validation, delete, and restore.
- [ ] Bump newly created complete backups to format `1.1.0` and add an explicit
      table-policy version/hash. Validate `1.0.0` with the legacy policy (including
      a same-schema backup created before this fix), while `1.1.0` must satisfy the
      complete canonical policy.
- [ ] Restore all durable models in FK-safe order. Explicitly invalidate and
      delete session/one-time-token models that must not become active after a
      restore; never leave pre-restore rows behind.
- [ ] Extend large-table pagination and restore credential transforms where the
      newly classified models require them.
- [ ] Add a transaction-backed round-trip integration test with one record per
      durable relation plus explicit cache and ephemeral assertions.

Acceptance:

- A current-schema complete backup cannot omit a durable model or hide an export
  failure.
- Restore deletes stale pre-restore state, recreates the durable graph atomically,
  and fails closed for external/security credentials.
- Focused backup unit/integration tests, server typechecks, full server coverage,
  and repository boundary checks pass.

Rollback/compatibility:

- Keep backup format `1.0.0` readable under an explicit legacy policy; do not infer
  provenance from `schemaVersion`. Newly created complete backups use `1.1.0` and
  the complete table-policy discriminator. Test pre-fix same-schema `1.0.0`,
  post-fix `1.1.0`, unknown policy, and downgrade/missing-policy cases.
- No database migration is required.

Delivery: one backend PR.

## Phase 2 — Distributed-lock ownership

Finding: `distributed-lock-loss-leaves-mutating-handler-running`.

- [ ] Add a failing two-job/two-worker test where worker A performs a delayed side
      effect after lock loss and worker B acquires the key. Prove B cannot commit a
      side effect while A remains alive and unfenced.
- [ ] Replace rejection-as-cancellation with explicit lost-ownership state and an
      execution signal for cooperative handlers.
- [ ] Because lock loss already makes the key acquirable, synchronously invoke an
      injectable hard-termination boundary (`process.exit(1)` in production)
      before any further await when an active handler loses ownership. Do not
      release the lost lock or wait for a cancellation-ignoring handler in the
      production process; cooperative settlement is only the normal shutdown path.
      Child-process integration tests must prove the old mutator is dead before a
      second owner commits.
- [ ] Thread the execution signal through lock-owning long-running handlers at
      safe phase/loop boundaries without interrupting an in-flight database
      transaction mid-commit.
- [ ] Test lock refresh success, definitive loss, Redis refresh error, handler
      success/failure, ignored cancellation, release ownership, and shutdown.

Acceptance:

- No retry or different owner can commit while stale work remains alive: cooperative
  work settles before ordinary release, while definitive ownership loss hard-stops
  the process before the processor performs another asynchronous step.
- Lock release never removes another owner's lock.
- Focused worker tests, server typechecks, full server coverage, and integration
  queue tests pass.

Rollback/compatibility: internal worker contract only; preserve existing job data
and queue names. Roll back the PR if worker readiness or graceful shutdown regresses.

Delivery: one worker/backend PR.

## Phase 3 — Frontend request and route ownership

Findings: `wallet-detail-route-state-cross-contamination`,
`transaction-detail-late-response-overwrites-current-selection`,
`transaction-url-unresolvable-retains-prior-selection`, and
`send-route-change-retains-stale-wallet-form`.

- [ ] Add deferred-promise wallet-detail tests for A→B, B-before-A completion,
      partial B auxiliary failure, unmount, and two same-wallet refreshes completing
      newest-first.
- [ ] Reset every wallet-owned view field synchronously on route identity change
      and apply results only when a monotonically increasing request generation
      still owns the current route. Advance the generation for every invocation,
      not only route changes.
- [ ] Add deferred transaction-detail tests for A→B reverse completion and
      loading-state ownership; ignore stale promise completion.
- [ ] Add valid→missing and valid→replaced `?tx` tests and clear the selection
      when the URL cannot resolve in the filtered list.
- [ ] Add send-controller deferred A→B tests and a provider rerender test with an
      edited A form. Assert stale success and failure cannot mutate `data`, `error`,
      or `loading`, including writes currently performed by `useLoadingState`.
- [ ] Give send-page loads request-generation ownership and key/reset the wizard
      by wallet identity so recipient, amount, selected UTXOs, step, and draft
      state cannot cross wallets.

Acceptance:

- No stale request can mutate state owned by a newer wallet/transaction route.
- Loading flags belong to the active request.
- Wallet changes clear stale UI before the new wallet header/actions render.
- Focused component/hook tests, frontend app/test typechecks, full frontend
  coverage, and browser smoke pass.

Rollback/compatibility: URL shape and API contracts stay unchanged. Route changes
may briefly show the existing loading state instead of stale content.

Delivery: one cohesive frontend async-ownership PR.

## Phase 4 — Outbound-network security

Findings: `authenticated-electrum-probe-arbitrary-network-target`,
`payjoin-ssrf-validation-not-bound-to-network-hop`, and
`payjoin-response-body-unbounded`.

- [ ] Add a failing `/node/test` test showing a non-admin caller cannot initiate
      a loopback/private/link-local/arbitrary-port probe.
- [ ] Preserve the documented `/node/test` request/response shape and legitimate
      operator-configured LAN/self-signed Electrum support, but add `requireAdmin`
      after authentication. Test 401, non-admin 403 without any socket call, and
      admin TCP/TLS success. Keep the existing admin node-config endpoints
      unchanged.
- [ ] Update the published OpenAPI operation to say admin-only, document its 403
      envelope, and extend route/OpenAPI contract tests so ordinary bearer access
      is no longer advertised.
- [ ] Add Payjoin tests for redirect-to-private, redirect chains, multiple DNS
      answers, IPv4-mapped IPv6, and DNS rebinding.
- [ ] Extract a shared outbound-address policy and pinned-address transport.
      Payjoin permits only globally routable resolved addresses; table-test
      multicast, unspecified/broadcast, loopback, link-local/metadata, private,
      CGNAT, benchmark/documentation/reserved IPv4, IPv4-mapped IPv6, IPv6
      loopback/ULA/link-local, and valid global IPv4/IPv6. Validate every DNS
      answer, connect to a validated address with correct SNI/Host, and set
      redirects to manual (or validate and pin every hop explicitly).
- [ ] Cap both non-2xx error text and successful proposal PSBT bodies at 100 KiB
      (102,400 raw response bytes, before text decoding). Abort/destroy the
      response when exceeded, return the same sanitized fail-closed error class for
      oversized 2xx and non-2xx responses, and test oversized chunked bodies.
- [ ] Preserve BIP78 HTTPS, timeout, and proposal validation behavior; sanitize
      returned/logged endpoint errors.

Acceptance:

- Unprivileged callers cannot use Sanctuary as a TCP/TLS network oracle, while
  admins retain documented custom LAN Electrum testing and OpenAPI advertises the
  admin-only/403 contract.
- Payjoin never connects to an address or redirect hop that was not policy-checked.
- Payjoin never buffers more than the documented response cap.
- Node, Payjoin, webhook transport, server typecheck, coverage, and integration
  suites pass.

Rollback/compatibility: `/node/test` remains present but becomes admin-only;
Payjoin endpoints remain supported and unsafe/private/oversized responses fail
closed. No branch-protection or deployment-network changes.

Delivery: one security-boundary PR.

## Phase 5 — Durable job scheduling and retry recovery

Findings: `webhook-retry-enqueue-failure-strands-delivery` and
`recurring-schedule-failure-leaves-worker-falsely-healthy`.

- [ ] First make required schedule replacement failure-safe: add/upsert the new
      repeatable definition before removing the stale key, or restore the old
      definition if add fails. Test remove-success/add-failure and prove a
      stale-but-running required schedule never becomes no schedule.
- [ ] Make recurring schedule results explicit (`created`/`unchanged`/`failed`)
      rather than overloading `null`.
- [ ] Add a failing webhook retry test for queue result `false`.
- [ ] Add a required recurring due-delivery recovery job. It claims persisted
      deliveries whose `nextAttemptAt <= now` without first making them ineligible,
      then enqueues the existing deterministic attempt job ID. Only the executing
      job conditionally transitions the expected due attempt before HTTP, so
      concurrent recovery cannot double-send. A crash before/during enqueue leaves
      the row due; a crash after enqueue is recovered by the same deterministic ID
      and delivery-state guard. Do not use immediate inline fallback for delayed
      retries.
- [ ] Add a focused recovery integration test proving queue failure causes no HTTP
      attempt before `nextAttemptAt`, then recovers after worker restart. Include a
      failpoint after due-row selection but before enqueue and prove the same
      attempt becomes eligible again without an early or duplicate HTTP send.
- [ ] Fail or degrade startup when a required recurring job cannot be reconciled,
      and periodically reconcile the required schedule set.
- [ ] Define one canonical baseline required-schedule set:
      `sync:check-stale-wallets`, `confirmations:update-all-confirmations`,
      every existing non-feature maintenance job, and the new webhook due-recovery
      job. Keep autopilot/intelligence schedules explicitly conditional on their
      feature flags. Make reconciliation and readiness inspect every applicable
      definition; freshness windows apply to stale-wallet and webhook recovery,
      while long-period jobs require schedule presence until their first due run.
- [ ] Test readiness is 503 when stale-wallet is present/fresh but webhook recovery
      or any other baseline definition is absent.
- [ ] Test initial Redis failure, stale cron replacement, already-correct schedule,
      reconciliation recovery, and health transitions.

Acceptance:

- A retryable webhook delivery always has a provable queued or durable recovery
  path and its persisted backoff is preserved.
- Reconciliation never converts a stale-but-running required schedule into no
  schedule.
- Worker readiness cannot be green while a required schedule is absent.
- Focused worker/webhook tests, server typechecks, coverage, and Redis-backed
  integration tests pass.

Rollback/compatibility: keep queue/job names and deterministic attempt IDs. Recovery
must remain at-least-once with repository-level attempt ownership.

Delivery: one async-durability PR.

## Phase 6 — Migration and transfer consistency

Findings: `stale-migration-manifest-masks-pending-migrations`,
`expired-transfer-update-rolls-back`, and
`transfer-ownership-check-outside-serializable-snapshot`.

- [ ] Replace the hand-maintained migration list/count shortcut with the migration
      directory names packaged in the backend image. Compare exact successful
      `_prisma_migrations` names and states; add a filesystem-to-runtime drift gate.
- [ ] Add tests for more historical applied rows than the old list, one missing
      current migration, failed/rolled-back rows, and fully current state.
- [ ] Move the expired status transition to a transaction that commits before
      returning the domain error, or return a transaction result and throw only
      after commit; add a DB-backed post-error assertion.
- [ ] Add transaction-client ownership repository methods and use them for both
      owner and target checks inside initiation's serializable transaction.
- [ ] Add bounded P2034 retry around the entire initiation serializable callback,
      re-running ownership and active-transfer checks on every attempt. Map
      exhaustion to the existing conflict envelope; never retry only the insert or
      reuse reads from outside the callback.
- [ ] Make the Compose `migrate` service the single migration owner in both local
      and GHCR definitions. Remove its backend dependency; make backend and worker
      depend on `migrate: service_completed_successfully`, and remove in-process
      migrate-and-continue startup behavior. Migration failure must prevent either
      database consumer from starting or becoming ready.
- [ ] Use the same packaged `/app/scripts/migrate.sh` entrypoint in both Compose
      variants so legacy pre-restructure migration resolution, deploy, and seed
      behavior cannot diverge.
- [ ] Add compose/startup contract tests for a fresh install, one-pending-migration
      upgrade, a legacy pre-migration-table database, and migration failure. Add
      transfer tests for coordinated ownership handoff, one P2034 then success, and
      retry exhaustion; retain active-transfer uniqueness behavior.

Acceptance:

- Migration status and `runMigrations` cannot report current while a filesystem
  migration is unapplied.
- Backend and worker do not consume the database until the sole migration owner has
  completed successfully.
- Expired confirmation durably records `expired`.
- Transfer initiation cannot persist from a stale owner snapshot.
- Focused migration/transfer tests, server typechecks, coverage, Prisma-boundary,
  and guarded integration tests pass.

Rollback/compatibility: no new application schema migration is planned; Compose
startup ordering changes. Preserve legacy migration compatibility plus transfer
response and error shapes.

Delivery: one persistence-consistency PR.

## Phase 7 — Assistant scope and deterministic planning

Findings: `console-wallet-set-tools-ignore-selected-scope` and
`console-fallback-wallet-worth-plans-market-only`.

- [ ] Add Console execution tests proving device and pending-approval results are
      intersected with a one-wallet or subset wallet scope.
- [ ] Filter before redaction/projection so counts and audit wallet counts also
      reflect the selected scope; retain unrestricted caller-accessible behavior
      only when the adapter supplies no wallet scope.
- [ ] Add planner regressions for “what is my wallet worth?”, “what is bitcoin
      worth?”, and maximum-tool-call limits.
- [ ] Make wallet-worth fallback include selected wallet data and market data when
      both tools and budget are available; otherwise emit an explicit partial-plan
      warning instead of silently answering a different question.
- [ ] Extend the safe Console result projection so synthesis receives numeric
      currency price and as-of metadata from market results alongside
      `balance_total_sats`. Keep raw `envelope.data` and redacted associations out
      of stored/exposed facts.
- [ ] Verify synthesis receives both projected inputs and can calculate wallet
      worth without exposing redacted wallet associations.

Acceptance:

- Wallet-set tools never return resources outside `context.walletScopeIds`.
- Bitcoin-price wording still plans market status; wallet-worth wording has both
  balance and price inputs or an explicit limitation.
- Focused server/proxy tests, both typechecks, and both coverage gates pass.

Rollback/compatibility: tool names and request schemas remain stable.

Delivery: one assistant/backend/proxy PR.

## Phase 8 — Docker image classifier completeness

Finding: `docker-image-classifier-omits-frontend-build-inputs`.

- [ ] Change the currently incorrect `package.json` regression expectation.
- [ ] Add `public/*` and representative root build/config inputs to classifier
      fixtures, including a production `.md`/`.mdx` asset and negative docs-only
      cases.
- [ ] Align `is_frontend_image_file` with every non-ignored frontend Docker build
      input. Prefer a maintainable explicit shared predicate or conservative
      frontend fallback over an incomplete allowlist.
- [ ] Evaluate production build inputs before the docs-only exemption (or scope
      that exemption to non-build-input documentation paths), so `public/help.md`
      cannot be skipped.
- [ ] Run classifier, workflow-composition, shell portability, and a dry image
      scope check against representative diffs.

Acceptance:

- Root dependency/metadata and public-asset changes always select the frontend
  image; docs-only and unrelated monitoring changes retain intended skips.
- CI classifier and workflow-composition tests pass.

Rollback/compatibility: may build an extra frontend image for ambiguous inputs;
must never skip a changed build input.

Delivery: one CI PR.

## Verification and delivery gates

For every phase:

- [ ] Re-read the finding against refreshed `origin/main` before implementation.
- [ ] Write and observe the non-regression test fail before production changes.
- [ ] Run the focused suite and affected package typechecks.
- [ ] Run the repository-required full local tests and coverage before push:
      backend `npx tsc --noEmit`, backend Vitest/coverage; frontend app/test
      typechecks and Vitest/coverage; gateway/proxy gates when touched.
- [ ] Run `git diff --check`, the project simplification/self-review pass, and the
      explicit null/empty/boundary/error/race audit.
- [ ] Perform an independent adversarial implementation review.
- [ ] Deliver through `$pr-delivery`; require green PR checks, verified squash
      merge ancestry, green target-branch CI, and owned branch/worktree cleanup.
- [ ] Update this plan and the durable run ledger with plan revision, PR heads,
      merge SHA, target CI, and verification evidence.

Final completion:

- [ ] All eight phases are merged and target CI verified.
- [ ] A fresh whole-repository rescrub at the resulting `origin/main` SHA covers
      all eight domains and finds zero P0-P2 bugs.
- [ ] All loop-owned PRs/branches/worktrees are settled.
- [ ] Because no Sanctuary app stack was running at startup, record final
      deployment as skipped and do not start containers.
