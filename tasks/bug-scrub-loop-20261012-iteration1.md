# Gateway forwarding and atomic wallet import remediation

Run `bug-scrub-loop-20261012-sanctuary`, iteration 1. Whole-repository scrub at
`c9355c93a8e401ace4d2be08d52ac1624a307420`; main refreshed and open PR list empty
immediately before planning. All eight coverage domains inspected.

## Goal and scope

Restore mobile API forwarding and serialize concurrent identical wallet imports.
Preserve existing authentication, mobile permissions, duplicate identity semantics,
and HTTP body/query values. No schema migration, identity-policy change, broad
refactor, version bump, production data repair, or dependency update. P3 backlog
is outside the blocking fix set. No P3 finding was accepted in this pass.

## Confirmed findings

1. **P1 `gateway-proxy--stripped-api-prefix`.** The ordinary authenticated
   middleware at `gateway/src/routes/proxy/index.ts:86-94` mounts on `/api/v1`.
   Express removes that prefix from `req.url`; the proxy has no rewrite. Actual
   router/HPM reproduction forwards wallet reads to `/wallets` and logout to
   `/auth/logout`; both return 404 because `server/src/routes.ts` mounts versioned
   paths. Explicit proxy routes retain the prefix. Logout cookie filtering also
   misses because it expects the full path.
2. **P1 `gateway-proxy--headers-after-body`.**
   `gateway/src/routes/proxy/proxyConfig.ts:54-69` calls `fixRequestBody` before
   cookie removal and identity headers. HPM writes JSON immediately; subsequent
   header edits raise uncaught `ERR_HTTP_HEADERS_SENT`. Actual refresh/logout
   reproduction also forwards stale browser cookies. Existing 88 mocked proxy
   tests pass and do not exercise transport ordering.
3. **P2 `wallet-import--concurrent-duplicate`.** Descriptor/parsed/JSON import
   checks duplicates outside `createWalletTransaction`. Two same-user requests
   can both read no duplicate, reuse an existing device/account through reads,
   and create distinct wallets in default-isolation transactions. The wallet,
   signer-link and address constraints do not conflict across those new wallet
   IDs. The current policy is script type plus key-origin set; retain it.

The reproduction and coverage evidence are archived outside the disposable
worktree under the run's durable `*-artifacts` directory. Findings are persisted
with stable fingerprints in schema-2 state.

## Delivery and ownership

One protected Forgejo PR for the compatible pass, with separate gateway/import
commits and regression evidence. No risk or rollout boundary requires a split.
Parent owns integration, state, commits/push/merge, and cleanup. Workers must not
push or modify the ledger. Branch `codex/bug-scrub-loop/20261012-i1` and worktree
`/tmp/sanctuary-bug-scrub-20261012-i1` are reserved in parent state. Unrelated
primary edits and baseline branches/worktrees are preserved.

Nested implementation inherits the active outer goal and exact plan path,
`cleanup_policy: iteration-baseline`, and `rebuild_policy: defer`. The outer loop
alone rebuilds the already-running relevant stack after a fresh zero-P0–P2 pass.
Archive plan history and evidence before removing owned resources. Verify exact
merge ancestry, target CI, and original inventory equality before rescrubbing.

## Phase A — gateway transport correctness

- [x] Add failing tests using the real Express router and HPM transport with an
      ephemeral loopback backend; mock only external dependencies when needed.
      Cover ordinary GET with query, logout body plus stale browser cookies,
      explicit refresh without double-prefixing, no-cookie refresh, and an
      authenticated JSON write. Assert upstream URL, body, gateway headers and
      cookie filtering; any uncaught error must fail the test.
- [x] Restore the stripped mount prefix at the proxy boundary using HPM
      `pathRewrite` and Express `baseUrl` plus the normalized incoming path.
      Do not use raw `originalUrl` to undo trailing-slash normalization. Keep
      whitelist/auth/permission validation before forwarding and query intact.
- [x] Set/remove every proxy header before calling `fixRequestBody`; body write
      is the last operation that can commit headers. Cookie checks observe the
      reconstructed full route. Keep unrelated cookies and body credentials.
- [x] Close all test-owned servers/sockets in `finally`/test teardown using the
      repo's established lifecycle pattern; no catch-and-ignore of fatal errors.
- [x] Run focused regression and full gateway coverage/typecheck. Keep new test
      contracts discoverable by the canonical gateway runner and lifecycle gate.

Expected files: `gateway/src/routes/proxy/proxyConfig.ts`, existing proxy config
unit tests, and a focused real-transport regression test under gateway tests.
Acceptance: both reproduced failures become passing requests, upstream receives
exact versioned URLs/body/headers, stale auth cookies are removed, and existing
whitelist denial and explicit-route permissions remain intact.

## Phase B — atomic duplicate import admission

- [x] Add a deterministic regression for simultaneous imports through an
      already-existing device/account. Force both preliminary checks to finish
      before either creates the wallet; baseline must admit both and fail the
      desired one-success/one-conflict assertion.
- [x] Add a small repository helper for a namespaced per-user transaction
      advisory lock, following `sessionFamilyLock.ts`/wallet-sync lock patterns
      and parameterized `$executeRaw`. Avoid enlarging walletRepository for the
      locking implementation; make its accessible-wallet query accept an
      optional transaction client, defaulting to the current client. The small
      helper owns a `withWalletImportTransaction(userId, callback)` wrapper:
      explicitly select Prisma ReadCommitted, acquire the namespaced lock, then
      invoke the callback. Follow existing parameterized `$executeRaw` lock usage
      to avoid deserializing PostgreSQL void through `$queryRaw`.
- [x] Let `checkDuplicateWallet` read through that transaction client. Inside
      `createWalletTransaction`, acquire the lock and repeat the duplicate check
      before any device/account/wallet mutation. Replace the generic transaction
      call with the import-specific locked wrapper. Retain fast preliminary checks.
      The lock releases on commit/rollback; default Read Committed makes the
      waiting caller observe the prior committed wallet. Do not add process-local
      locks or broad retry loops. Different users use distinct lock keys.
- [x] Add guarded PostgreSQL proof using the existing descriptor-atomicity test
      helpers: concurrent identical imports yield one wallet, one conflict, and
      no duplicate signer/address rows. Cover rollback/retry and different-user
      lock independence through focused repository/integration cases as needed.
      Test naming must not trigger the fixture's deliberate address failure.
      Existing signer fixtures need an explicit `deviceUser` owner grant. Use
      `server/tests/integration/flows/walletImportConcurrency.integration.test.ts`
      for the separate discovered concurrency suite, retaining existing atomicity
      cases unchanged. Both exact paths are included in the required DB gate.
      Deterministically hold the first transaction before commit and prove the
      contender is waiting on the actual advisory lock (bounded database lock
      observation/barrier), then release it. The test must fail if the lock is
      removed, not merely pass because scheduling serialized the rechecks.
      Establish all wait barriers with bounded deadlines and release them in
      finally; verify rollback releases the lock and another user is independent.
- [x] Verify descriptor, parsed and JSON callers all use the shared guarded
      transaction; preserve access checks and existing sequential identity cases.

Expected files: `server/src/repositories/walletImportLock.ts` (new),
`walletRepository.ts`, `server/src/services/walletImport/deviceResolution.ts`,
`walletImportService.ts`, owning unit tests/wrapper
`server/tests/unit/services/walletImport.imports.test.ts`, and
`server/tests/integration/flows/walletImportConcurrency.integration.test.ts`
(new; existing descriptor-atomicity suite remains an acceptance gate).
Acceptance: concurrent same-user imports cannot both commit; rejection is the
existing ConflictError/409 contract; failed first import does not permanently
block later imports. No database migration or cleanup of existing wallets.

## Verification and final integration

Use Node 24.21.0/npm 12.0.2, isolated worktree dependencies, built shared/dist and
generated Prisma client. Those prerequisites are complete. Do not overlap Prisma
generation/DB suites with source readers or broad coverage tests. All live data
is excluded; Docker tests use the repository's guarded entry points.

- [x] Gateway focused tests: `npm --prefix gateway run test:run -- tests/unit/routes`
      and new regression path; full `npm --prefix gateway run test:coverage`;
      `npx tsc --noEmit -p gateway/tsconfig.json`.
- [x] Backend focused wrapper: from server, `npx vitest run tests/unit/services/walletImport.imports.test.ts`
      plus new repository unit test. Passing `.contracts.ts` directly is not a
      discovered test. Do not combine the broad `test:unit` filter with a claimed
      narrow file-only run.
- [x] Real DB: `./scripts/run-integration-tests.sh tests/integration/flows/walletDescriptorAtomicity.integration.test.ts tests/integration/flows/walletImportConcurrency.integration.test.ts`;
      require actual executed tests and terminal cleanup receipt.
- [x] Full backend unit coverage: from server, `npx vitest run --coverage tests/unit`;
      backend `npx tsc --noEmit`. Full frontend `npm run test:run`,
      `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:all`
      as required by repository instructions. Serialize broad suites.
- [x] Run configured gateway/backend lint, owning architecture/complexity and
      resource-lifecycle guards selected by the final diff; inspect scripts
      before invoking. No frontend visual change, so browser snapshots are not
      edited. Protected CI supplies its normal browser/install lanes.
- [x] Independent adversarial code review, coordinator actual-diff review for
      reuse/simplification/edge cases, `git diff --check`, final combined checks.
- [x] Refresh main and open PRs before delivery; re-review if evidence changed.
      Pin reviewed plan commit in state/PR record, preserve commit history.
- [ ] Commit with normal hooks; push one PR; monitor required checks, repair
      failures with exact-SHA evidence, merge without branch auto-deletion, verify
      real merge ancestry and exact target-branch CI before owned cleanup.

## Compatibility, rollback and completion

Gateway changes preserve external routes and body credentials. Import locking
only serializes one user's creation transactions; waits remain subject to existing
transaction timeouts. No cache or persisted schema changes. Rollback is a protected
revert of the fix commits; it reintroduces the defects but requires no data repair.
Production data changes or removal of existing duplicate wallets are out of scope.

This plan is complete when all three fixes have regression evidence, independent
review, merged PR ancestry, green exact-main CI and verified owned-resource cleanup.
The outer goal remains active until a subsequent complete fresh whole-repository
scrub has no P0–P2 findings and final deployment/cleanup succeed.

## Review record

Pass 1: gateway reviewer found no actionable comments. Independent backend/
lifecycle reviewer required explicit ReadCommitted and a deterministic real-lock
contention proof, accepted and applied. Coordinator added explicit fixture owner
grants and permission to keep concurrency tests in a separate discovered suite.
Pass 2: reviewer identified an inconsistent DB gate when using the new separate
concurrency suite; accepted, exact file now named in scope and required command.
Pass 3: independent full reread found no verified actionable comments.
Coordinator rechecked source paths, guarded multi-file DB invocation, scope and
acceptance criteria; plan converged.

## Implementation evidence

Both regression-first slices implemented. Gateway baseline reproduced stripped paths and
uncaught headers-sent errors; 598 gateway tests now pass with 100% coverage.
Import baseline admitted both callers; focused regression now admits one and returns
ConflictError for the other. Guarded PostgreSQL atomicity/concurrency suites pass
10/10, including observed real import lock contention, rollback and user independence;
coordinator cleanup receipt reports cleaned with both exit statuses zero.
Independent gateway, backend and database-test reviews found no actionable comments.
Frontend 9,316 tests and all three typechecks pass; backend source/test types, lint,
architecture/cycle/lifecycle and complexity gates pass. Full backend unit coverage passes at literal 100% statements, branches, functions
and lines. No full-suite retry or bypass was needed.

Commit-hook review caught the new integration suite missing from the explicit CI
flow-group registry. Registered it in `scripts/ci/backend-integration-groups.sh`;
group completeness and regression checks pass. This implements the existing
canonical-runner acceptance requirement; no runtime scope or plan semantics changed.
Added explanatory comments for mount restoration, Read Committed and locked recheck.
