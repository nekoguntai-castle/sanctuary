# Iteration 22 remediation plan — native daemon normalization and mutation retry policy

**Implementation gate:** Begin only after a complete clean recursive review, normal plan commit, and parent acceptance of that exact revision in the external ledger.
**Scrub baseline:** `main` / `d08a23e101a9bda088b91fd162e6e32c6ae494a1`.
**Reserved worktree:** `/home/nekoguntai/sanctuary-bug-scrub-loop-20260920t1514z-iteration22`.
**Reserved phase-one branch:** `codex/bug-scrub-loop/20260920t1514z-iteration22-native-context`, initially based at the scrub SHA.
**Durable findings:** `ownership-daemon-context--native-podman-fractional-telemetry`; `query-mutations--automatic-replay-after-ambiguous-write`.

This plan addresses exactly two confirmed P2 findings in separate, serial PR phases. Phase one makes native Podman authority normalization tolerate only demonstrated volatile telemetry while preserving authority-bearing fields. Phase two stops automatic replay of mutations after ambiguous transport failures, in line with the existing at-most-once API policy. P3 items and unrelated cleanup are excluded. No database migration is planned. Local regressions use mocks; required CI may use its guarded isolated engine fixtures. Do not mutate the running application stack or deploy during these phases.

## Evidence and source-backed behavior

### Phase 1: native Podman authority normalization

`canonicalAuthority` in `scripts/ownership/cleanup-execution-context.mjs:42-61` hashes parsed daemon info through `canonicalSha256`; `scripts/ownership/canonical-json.mjs:20-35,68-75` deliberately rejects non-safe-integer numeric values. A captured Podman 5.4.2-shaped info response has fractional CPU percentages (including `7.84`, `1.96`, and `90.2`), causing `$.host.cpuUtilization.userPercent must be a safe integer`. `scripts/ownership/docker-observation.mjs:638-695` catches that resolution error and returns incomplete inventory before issuing resource-list commands. The integer-shaped control completes inventory. `native-podman-telemetry-drift.log` demonstrates volatile changes in `host.memFree`, `host.swapFree`, `store.graphRootUsed`, container/image counters changing the current fingerprint; changing `store.graphRoot` is authority drift and must continue changing it.

The implementation should use a Podman-specific exact structural-path filter/projection before canonical hashing. Do not loosen canonical JSON, round/coerce numbers, or apply broad key-name exclusions. Omit only the demonstrated runtime telemetry paths:

- `host.cpuUtilization` as a whole object;
- `host.memFree`, `host.swapFree`, `host.uptime`;
- `store.graphRootUsed`;
- `store.containerStore.number`, `.paused`, `.running`, `.stopped`;
- `store.imageStore.number`.

Retain `store.graphRootAllocated`: its observed value (about 931 GB) resembles stable filesystem capacity like retained `host.memTotal`, and no evidence proves routine volatility. Retain `host.memTotal`, `host.swapTotal`, `store.graphRoot`, daemon/engine version evidence, selected Podman connection name and URI, engine identity, stable daemon configuration, and unknown fields. Unknown fractions at stable paths still fail closed. Ensure field digests and the main daemon fingerprint use the identical normalized info. Match path segments structurally so a literal dotted key or a nested lookalike is not accidentally treated as one of the omitted paths.

The current policy identifier is `sanctuary.docker-daemon-authority.v2` in `scripts/ownership/cleanup-execution-context.mjs:5`, embedded in the fingerprint around lines 183-187 and enforced by exact comparison in `scripts/ownership/docker-observation.mjs:641-643`. Bump the shared authority policy to v3. This intentionally invalidates v2 pinned Docker and Podman authority evidence and requires fresh inventory/plan/approval; do not accept v2 alongside v3. Historical signed receipts stay historical and must not authorize new work. Search fixtures/reports for hard-coded hashes or policy strings and update only those that represent current expected behavior. This is a fail-closed compatibility change, not a data migration.

**Failing-first regressions and implementation boundary:** add/update command-mocked tests in `tests/ownership/cleanup-execution-context.test.mjs`, `tests/ownership/docker-observation.test.mjs`, and where relevant `tests/ownership/cleanup-docker-adapter.test.mjs`. First show the observed fractional native Podman fixture fails resolution/inventory; then implement and assert it resolves and reaches resource-list commands with complete inventory. Assert the observed volatile values changing leaves the Podman fingerprint stable. At the actual inventory boundary, change telemetry across pinned resolution, pre-observation, and post-observation and require complete inventory; change stable configuration before observation and after resource listing and require identity_changed / inventory_drift respectively. Explicitly pass an otherwise-valid v2 pinned authority and assert refusal before resource queries. Assert changing each retained authority field changes the fingerprint and its field digest, including `store.graphRootAllocated`, `store.graphRoot`, `host.memTotal`/`swapTotal`, versions, and representative stable config. Test connection name/URI changes at the context fingerprint boundary (these are context evidence, not daemon info field digests). Preserve native top-level ID authority. Assert an unknown fractional field still fails closed; unknown fields, literal dotted keys, and nested lookalikes at other structural paths remain fingerprinted. Preserve Docker expectations except explicit policy-v3 hashes, canonical serializer rejection of fractions and `-0`, and existing set-array ordering/membership semantics. Keep all probes mocked and mutation-free.

Focused checks (all commands verified present in package/scripts at the scrub baseline):

```bash
scripts/ci/run-standalone-test-command.sh node --test \
  tests/ownership/cleanup-execution-context.test.mjs \
  tests/ownership/docker-observation.test.mjs \
  tests/ownership/cleanup-docker-adapter.test.mjs
npm run check:resource-ownership-contract
npm run test:ownership
```

`npm run test:ownership` includes the real-engine test file through its glob, but its opt-in tests must remain skipped locally: leave SANCTUARY_RUN_DOCKER_ACCEPTANCE unset. After focused success run `npm run quality`, `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run typecheck:all`. Quality runs full frontend coverage/type checks; also run the owning architecture checks: `npm run arch:lint`, `npm run check:architecture-boundaries`, `npm run check:wallet-sync-lifecycle-contract`, `npm run check:wallet-sync-mutation-boundaries`, `npm --workspace server run check:prisma-imports`, `npm run check:server-cycle-baseline`, `npm run arch:graphs`, and `npm run arch:calls`; verify no stale generated graph diff. Record reused broad checks only when their exact inputs remain unchanged. No backend business code changes are planned; required CI supplies its classified backend/engine lanes. Use Node 24.21.0 for all commands and the isolated worktree dependency setup already completed. Run normal commit hooks without bypass.

### Phase 2: prevent shared automatic mutation replay

`src/providers/QueryProvider.tsx:19-22` configures the shared TanStack Query client with `mutations.retry: 1`. `src/hooks/queries/useWallets.ts:94-103` creates wallet-create/import mutations without overriding it; reachable forms call `mutateAsync` in `src/components/CreateWallet/useCreateWalletController.ts:171-189` and `src/components/ImportWallet/useImportWalletActions.ts:78-101`. Requests are POSTs (`src/api/wallets.ts:141-143,198-199`). The HTTP transport has its own method-aware retry policy, explicitly at-most-once for mutations (`src/api/retryPolicy.ts:1-4,25-36`; `src/api/client.ts:715-717`), but TanStack retries the whole mutation function above that layer. The bounded proof at `iteration22-scrub/retry-proof.ts` imports the actual exported production `queryClient`: defaults invoke a simulated committed-effect/lost-response mutation twice; explicit `retry:false` invokes it once. It does not perform a DB write.

The server create path inserts wallet rows (`server/src/services/wallet/walletCreate.ts:236-297`; route `server/src/api/wallets/crud.ts:139-177`) without request idempotency or a per-user wallet identity/name uniqueness constraint (`server/prisma/schema.prisma:113-160`). Custom Sanctuary JSON import dispatches to `server/src/services/walletImport/jsonImport.ts:21-57`, which inserts via `createWalletTransaction` without duplicate detection. Descriptor and parsed BlueWallet/Coldcard import paths do call `checkDuplicateWallet` (`server/src/services/walletImport/descriptorImport.ts:43-45,77-79`); the claim of duplicate rows must remain limited to regular creation and custom Sanctuary JSON. The duplicate guard may turn a retry after commit into an error rather than a duplicate, but does not make replay safe for the other paths.

Set the shared QueryClient mutation default in `src/providers/QueryProvider.tsx` to `retry: false`, preserving query retry behavior and the API client's safe-read retry policy. Do not opt individual mutations back in absent a documented idempotency guarantee. `src/hooks/queries/factory.ts:174-205` permits explicit per-mutation options, but the current production callers reviewed do not supply retry overrides.

The production caller sweep found reachable mutations inheriting the default: wallet create/import; wallet-label create/update/delete (`src/hooks/queries/useWalletLabels.ts:15-34`, used by LabelManager and label creation also by LabelSelector). Label create replay can return conflict after the first write; delete replay can return not-found. They are part of the shared-default safety boundary, not separate findings. `useUpdateWallet`, `useCreateDevice`, and `useDeleteDevice` currently have no production callsite; do not expand scope to them absent new reachability evidence.

**Failing-first behavioral regression:** add a test in `tests/providers/QueryProvider.test.tsx` or a focused production-hook regression test that mounts the actual `QueryProvider` and `useCreateWallet` hook (or equivalent actual reachable production hook) with the real configured client and mocked API. Simulate a server-side effect followed by a lost-response `TypeError`. Before the fix the regression must observe two mutation invocations; after the fix it must observe exactly one and preserve the mutation error state. Include a positive control using reachable production `useWallets` under the same actual provider: transient mocked GET failure followed by success must invoke twice and resolve, proving its configured safe query retry still runs. Do not test only that a configuration property equals false. Existing hook tests create clients with `mutations.retry:false` and therefore mask the production default; retain their value but do not treat them as sufficient verification. Keep `tests/api/client/client.retry.contracts.ts` coverage that safe reads may retry and POST mutations do not retry at the transport layer.

Focused checks after the regression and change:

```bash
npx vitest run tests/providers/QueryProvider.test.tsx \
  tests/hooks/queries/useWallets.test.tsx \
  tests/api/client.test.ts
npm run typecheck:app
npm run typecheck:tests
npm run build
```

Confirm each exact Vitest path exists before running; if a colocated/new regression path is chosen, substitute that exact path. Then run `npm run test:run` and `npm run test:coverage` as the frontend broad gates, `npm run typecheck:all`, `npm run check:architecture-boundaries`, and `npm run quality` where the repo's normal PR CI requires them. Resolve failures caused by this change; classify unrelated baseline failures with evidence rather than widening product scope.

The project requires a browser check in addition to Vitest. Build the production bundle and run the render-regression suite against a static server for `dist`, using a throwaway Playwright config with no `webServer` and an ignored `.tmp` config/artifact path. Do not launch `npm run dev`, `npm run preview`, `npm start`, or `npx vite`. Example after confirming the installed Playwright runner and config shape:

```bash
npx playwright test --config .tmp/iteration22-static-render.config.ts \
  --project=chromium tests/e2e/render-regression.spec.ts
```

Use only a server process started for this check and stop that owned process after the test. Do not update visual baselines because this changes request behavior, not rendered design. Verify the normal PR workflow covers all browser groups; if its classifier does not schedule full browser E2E, dispatch `test.yml` with its branch ref at the exact PR head (no `full_scan` input exists; workflow_dispatch selects full-scan classification) and require all four `scripts/ci/browser-e2e-groups.sh` groups / all 18 specs to pass. No browser result from another SHA substitutes for the exact PR head.

## Serial delivery, authority, and completion gates

1. [ ] Parent registers/reviews this exact draft and the independent recursive plan review reaches no actionable comments. Commit the converged plan through normal hooks and record the exact reviewed commit SHA and plan-file hash in the external run-state ledger after that commit and before implementation. Persist review counts and additive plan revisions; re-review material amendments. Parent must explicitly accept the converged plan in the external ledger before phase one starts.
2. [ ] Phase 1 uses only the parent-reserved phase-one branch/worktree, with failing regressions first. Keep changes confined to the native normalization/policy and tests. Run the focused commands above and applicable normal PR checks. Open the PR; wait for review and exact-head required CI to pass; merge only through the protected Forgejo flow. Use `delete_branch_after_merge:false` in the merge request/payload. Do not bypass branch protection or directly push to main.
3. [ ] Verify the platform-reported `merge_commit_sha` is a Git object, refresh `origin/main`, and verify that exact merge commit is an ancestor of refreshed target. Wait for all exact target-branch CI to pass before deleting only the loop-owned remote phase-one branch. Preserve the worktree if it is dirty or ownership is uncertain.
4. [ ] Reset context from verified target `main` before phase 2. Reuse the worktree only with explicit provenance recorded: old phase-one branch/head/merge SHA and new target SHA; ensure clean, detach/refresh to target, then create `codex/bug-scrub-loop/20260920t1514z-iteration22-mutation-retry` from the verified phase-one target. Reserve the new branch in durable state before creation; mark the retained worktree converted with the exact next-phase provenance, delete the verified old local branch after switching, and retain an external copy of the reviewed plan/receipts. The reviewed plan must remain available at its recorded path and revision. Do not start phase 2 before phase-one target checks complete. Phase 2 is a separate PR containing only the retry-policy behavior/regression and relevant tests.
5. [ ] Apply the same exact-PR checks, protected merge, merge-object ancestry verification, exact target CI gate, and owned-branch cleanup to phase 2. Run the full browser groups on the exact phase-two PR head as described above. Record each command, exit status, SHA, CI run/head, merge SHA, and cleanup result in durable loop state.
6. [ ] Do not rebuild/restart the running application stack or manually mutate a live database/engine in these phases. Local production-bundle builds, owned static dist serving, and required guarded CI fixtures remain authorized. Deployment remains deferred under the already-authorized final-only policy until a fresh complete whole-repository scrub finds zero P0/P1/P2. The outer loop owns deployment to the originally running stack and verifies identity, health, and readiness; no additional permission is required. No schema/data migration is expected. If phase-one normalization needs rollback, use a protected fix-forward PR and keep v2 rejected; never dual-accept old authority. If phase-two behavior needs rollback, restore the at-most-once default or fix forward; do not re-enable global mutation retries. Per-mutation retry is allowed only after a separately reviewed idempotency contract and regression.

## Explicit exclusions and evidence gaps

- Do not reopen the already-resolved currency quote reset/animation findings or nullable `WalletStats` caller path; their current source/tests were traced in the frontend shard.
- Do not generalize the import duplicate claim to descriptor/BlueWallet/Coldcard imports, or call the bounded mutation proof a real server/database commit.
- Do not remove `store.graphRootAllocated` based on one observed value; no routine-drift evidence supports that omission.
- No claim is made that the entire frontend was line-by-line reviewed or that every UI/browser workflow was executed during the scrub. The bounded scrub inventory and proof artifacts are in the durable iteration22-scrub artifacts directory.

- [ ] After phase 2, mark the exact reviewed plan delivered, settle agents/processes, archive evidence, remove all owned branches/worktree after verified target CI, and prove the remote has only main. Start a fresh whole-repository scrub at the new target SHA; these two fixes alone do not satisfy the clean-loop gate.
