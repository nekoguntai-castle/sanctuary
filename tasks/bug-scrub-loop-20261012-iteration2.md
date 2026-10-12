# Bug scrub loop — iteration 2

Run `bug-scrub-loop-20261012-sanctuary`; scope whole repository; source/main
`4bff86e6fefc33cab6ce586d043038d4c0e1ee09`. One compatible delivery PR.

## Goal and evidence

Resolve two confirmed P2 findings, with regression-first tests:
- `console-egress--inherited-prompt-limit`: egress `requestSchemas.ts` adds
  max12000 to a shared string already capped at1024. Actual source schema proof
  rejects1025/12000 for both planning and synthesis. Backend ConsoleRunTurn schema
  and ConsoleComposer explicitly allow12000; egress400 becomes a failed turn/503.
- `wallet-import--stale-new-signer-resolution`: both same-user concurrent imports
  can resolve a new signer before either owns the import lock. Distinct canonical
  account origins correctly pass duplicate-wallet checks, but stale willCreate
  causes the second device.create to violate global fingerprint uniqueness.
  Existing descriptor contract explicitly allows account0 and account1 wallets.
  This differs from iteration1's identical-wallet admission bug, which stays fixed.

Non-goals: P3 backlog, changed wallet identity policy, cross-user device sharing
policy, schema migrations, retrying generic P2002, version bumps or unrelated
refactors. No live DB test writes. Preserve all current authorization/capability
checks and JSON label/type provenance. Deployment remains final-only.

## Phase A — console prompt contract

- [x] Add failing behavior coverage to `tests/llm-egress-proxy/requestSchemas.test.ts`
  for both console schemas:1024,1025,12000 accepted;12001 rejected; empty/whitespace
  rejected and trim semantics retained. Extend console route tests to prove valid
  long prompts pass through to the provider and overlimit prompts fail before it.
- [x] Give the two console prompt fields an explicit trimmed min1/max12000 schema
  without inheriting max1024. Keep unrelated request field limits unchanged.
- [x] Run focused schema/console route tests, then full LLM egress tests/coverage
  and `npx tsc --noEmit -p llm-egress-proxy/tsconfig.json`.

## Phase B — refresh import decisions under the lock

- [x] Add a failing distinct-account concurrent import regression before production
  changes. Both same-user outer resolutions must observe no existing device.
  Use valid canonical descriptors for accounts0/1 from the same deterministic
  signer. Both imports must succeed with one Device, two DeviceAccounts and wallets.
- [x] Refresh device resolution through the owning transaction after acquiring
  the existing per-user import lock. Extend `deviceRepository.findByUserIdWithModel`
  and `resolveDevices` with optional transaction clients using the canonical default
  Prisma client. Consume refreshed resolutions for writes and capability checks;
  retain preflight behavior, explicit labels and original JSON metadata. Do not
  retry stale resolutions. Preserve locked duplicate-wallet rejection and current
  reuse access/account-key checks; do not broaden device visibility.
- [x] Factor the capability validation into a small named helper if needed and
  apply it to fresh resolutions before mutations. Edited functions CCN <=15;
  avoid growing production files beyond500 lines or unrelated refactors.
- [x] Unit tests must prove transaction client propagation, stale-create refresh,
  same-origin conflict, metadata/label retention, and revoked/unsupported reuse
  fail-closed behavior. Keep mock fixtures behaviorally consistent.
- [x] Extend `server/tests/integration/flows/walletImportConcurrency.integration.test.ts`
  with real PostgreSQL distinct-account race proof. Use deterministic barriers or
  existing transaction gate to force stale outer reads; assert the actual second
  import waits for the per-user lock before first commit. Finally release gates,
  settle promises, and remove owned trigger/function resources. Preserve rollback,
  identical-origin duplicate, and independent-user regression cases.
- [x] Run guarded DB suites only through
  `./scripts/run-integration-tests.sh tests/integration/flows/walletDescriptorAtomicity.integration.test.ts tests/integration/flows/walletImportConcurrency.integration.test.ts`
  and require signed terminal cleanup receipt. Any new suite path must be in the
  owning CI integration group and its completeness check.

## Verification and delivery

- [x] Review tests red before fixes and record exact commands/results in artifacts.
- [x] Source/test typechecks, relevant lint and architecture/cycle/lifecycle/CCN
  guards; full backend unit coverage `cd server && npx vitest run --coverage tests/unit`.
- [x] Full frontend `npm run test:run` and app/tests/all typechecks per project rules.
  This is no UI change; no new browser snapshots. Protected CI retains browser lanes.
- [x] Independent adversarial review, parent source/diff/edge-case/simplification
  review, `git diff --check`; do not commit overlapping worker writes.
- [ ] Re-fetch main and inspect open PRs; review again if evidence moved. Normal
  commit hooks, one owned PR for both compatible fixes, all required exact-head
  CI, protected merge without auto-deletion, verify real merge ancestry and exact
  target CI. Follow recorded failure/hypothesis/discriminator retry discipline.
- [ ] Archive reviewed plan and unique history, then exact approved owned cleanup
  and inventory equality. No resource survives iteration boundary. One-off deletion
  permission applies to the eventual exact commands, not this plan generally.

## Compatibility, rollback, completion

No database migration or cache format change. The existing import lock remains
per-user and ReadCommitted; refreshed queries see the previous holder's commit.
Fingerprint uniqueness and account access rules remain unchanged. Console input
acceptance becomes consistent with its existing12000 limit. Rollback is a protected
revert; no data repair is needed. All phases form one PR because deployment and
verification are compatible; internal phases do not require separate PRs.

This plan completes only after regressions, review, merged target CI and owned
cleanup pass. The outer goal still requires a fresh complete zero-P0/P1/P2 scrub
and final deployment to the already-running stack. Nested implement-merge reuses
outer state/goal with rebuild_policy defer and cleanup_policy iteration-baseline.
After the final clean scrub, the outer owner rechecks baseline/current running
stack, persists a pending deployment operation, runs `./start.sh --rebuild` from
the stable deployment checkout, verifies build commit plus health/readiness and
records terminal evidence. Never start a stopped stack.

## Review record

Pass 1: independent console/backend reviews confirmed source and test design.
Accepted clarification: outer final deployment must use ./start.sh --rebuild only
if the relevant stack was running at baseline and remains running; persist a
pending operation before rebuild and verify deployed commit, health/readiness
before recording success. This nested plan keeps deployment deferred.
Pass 2: independent full reread and coordinator source/diff review found no
remaining verified actionable comments. Plan converged.

## Implementation progress

Console schema/route regressions failed before the fix; focused tests and full
egress coverage/typechecks pass. The full frontend run includes 9,319 passing
tests. Backend unit coverage passes all 16,563 tests across 725 files with 100%
statements, branches, functions and lines. Repository/resolver transaction
propagation, locked refresh, fresh capability checks and unchanged existing-device
bindings are covered. Deleted devices are denied both before and after refresh.
The malformed missing-ID unit case now directly exercises its owning reuse helper.

Guarded PostgreSQL atomicity/concurrency passes 11/11, including deterministic
empty preflight snapshots, observed per-user lock contention and successful
separate-account imports with one signer. Terminal receipt
`/tmp/sanctuary-cleanup-local.TTvEWJ/artifacts` reports cleaned, subject0/cleanup0.
The pre-fix database regression failed after reaching the real race barriers;
its terminal cleanup also passed. No live database was used.

App/tests/all/backend/egress typechecks, lint, architecture/cycles, ownership,
integration-group completeness and complexity checks pass. Generated diagrams
are unchanged. Independent adversarial and parent final diff reviews are clean.
Main remains the audited4bff86e commit with no overlapping open PRs. Delivery,
target CI and owned cleanup remain pending. Deployment remains deferred.
