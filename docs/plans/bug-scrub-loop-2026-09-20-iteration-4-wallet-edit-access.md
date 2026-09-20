# Bug scrub loop iteration 4: align wallet edit queries with direct-role precedence

Source target: `f593721d1fa2fae0cfd9e8e35ae8a6c676feb282` (`origin/main`). Scope: whole repository. Findings: `wallet-edit-query--direct-viewer-group-signer-resync` (P2) and `wallet-edit-query--group-signer-advanced-transactions` (P2).

## Goal and evidence

All wallet edit lookups must apply the same role contract as `getUserWalletRoleUncached`: a direct `WalletUser` grant takes precedence over the wallet's group grant. The contract is explicit in `server/src/services/accessControl.ts:56-76` and `docs/plans/rationalization-plan.md` (Third Review Corner Cases).

`buildWalletEditAccessWhere` currently ORs direct edit and group edit without excluding users who have any direct grant from the group branch (`server/src/repositories/accessControl.ts:43-51`). A direct viewer who also belongs to a signer group therefore passes `findNetworkWalletIdsWithEditAccess` and reaches `requestFullResyncBatch` through authenticated `POST /sync/network/:network/resync` (`server/src/repositories/walletRepository.ts:414-419`, `server/src/services/sync/syncCoordinator.ts:494-537`, `server/src/api/sync.ts:149-165`). The single-wallet route denies the same user through the canonical edit check. Network full resync clears and re-derives wallet data, so this is a P2 authorization bypass.

`findByIdWithEditAccess` implements a separate direct-only query (`server/src/repositories/walletRepository.ts:397-411`). The RBF, CPFP, and batch transaction routes use it as their wallet edit gate (`server/src/api/bitcoin/transactions.ts:173,230,287`). A group signer with no direct grant can edit through the canonical service but gets 403 from these routes. Their comments require wallet edit access and contain no direct-only rule, so this is a P2 functional authorization defect.

## Assumptions and limits

- Preserve direct-first role precedence, including direct viewer and approver overriding group signer. Do not change the role hierarchy or adopt highest-privilege selection.
- Keep the shared Prisma edit filter as the repository query contract. Add `users.none({ userId })` to the group edit branch, then reuse that filter in the single-wallet edit lookup. Keep network and wallet-ID constraints in their existing repositories.
- Preserve the authenticated route, confirmation header, per-wallet exclusion reason, transaction validation, hardware capability checks, and signing intent flow. No schema or migration change.
- Use a real PostgreSQL transaction to verify combined direct/group grants; mocked query-shape assertions alone cannot establish Prisma's `some`/`none` semantics.

## Phase 1 — one mergeable server PR

- [x] Add a focused real PostgreSQL regression that creates a signer-group wallet and a member distinct from its direct owner. Within `withTestTransaction`, evaluate both query shapes using `buildWalletEditAccessWhere`: `tx.wallet.findMany({ where: { network, ...filter } })` and `tx.wallet.findFirst({ where: { id, ...filter } })`. Assert a direct viewer is excluded and show the test fails on current source. Cover direct viewer, approver, signer, and owner; group-only viewer, signer, and owner; and an outsider as boundary cases. The repository functions use a separate Prisma client, so they cannot read the transaction's uncommitted fixtures.
- [x] Change `buildWalletEditAccessWhere` so its group branch applies only when the user has no direct wallet grant. Make `findByIdWithEditAccess` reuse this filter; remove the unused role constant import from `walletRepository.ts`. Update repository query contract tests to prove both functions use the canonical filter.
- [x] Register the new database spec in `scripts/ci/backend-integration-groups.sh` so CI runs it. Confirm network resync's filtered wallet set excludes the mixed-role wallet and that group-only signers pass the advanced transaction edit gate through the real database filter. In existing RBF, CPFP, and batch success route tests, assert the API uses the group-aware edit query; pair those assertions with the existing 403 route cases and real database semantics. Mocked route success alone does not prove role admission.
- [x] Explain direct-first precedence at the shared edit predicate and update the single-wallet repository JSDoc to mention group grants.
- [x] Re-read the diff for authorization, role parsing, callers, and scope. Run focused tests, guarded PostgreSQL integration tests, server typechecks, full required local gates, adversarial implementation review, and pre-commit checks.

Acceptance: direct viewer/approver plus signer group cannot trigger full network resync; a group-only signer can use the three advanced transaction creation routes; direct owner/signer and group-only owner remain admitted; other roles remain excluded. Existing single-wallet role checks and API behavior remain coherent.

## Verification and delivery

1. Use project Node 24.21.0/npm 12.0.2. Demonstrate the combined-role database regression red before production edits and green afterward. Run `server` focused suites and its unit suite/typechecks; run the guarded integration suite only against a disposable PostgreSQL target with cleanup evidence.
2. Run the repository-required root and server test, typecheck, coverage, architecture, lint, and inventory gates appropriate to this server-only change. Preserve 100% coverage.
3. Deliver the reviewed plan through `pr-delivery`; require all exact head workflows, squash-merge ancestry, and five exact merge-SHA target workflows. Defer the running-stack rebuild to final clean closeout.
4. Refresh `origin/main` and rescrub all eight original domains. The loop closes only after a complete current-SHA pass finds zero P0–P2 findings.

Backout: revert the bounded PR; no data migration or repair is needed. Rebuild the already-running stack only after the final clean pass.

## Implementation evidence before PR

- The isolated PostgreSQL regression failed on the original filter because the direct viewer matched the group signer branch; it passed after the fix. Both runs produced signed cleanup receipts with `cleanupState: cleaned`.
- The real database test covers both network and single-wallet query shapes across direct and group roles. Repository contract tests verify both callers use the shared predicate; existing RBF, CPFP, and batch route success/403 tests now also assert the edit lookup path.
- Focused server tests passed (229). Full server coverage passed 16,363 tests in 715 files with 100% reported coverage. Root coverage passed 8,714 tests in 649 files with 100% reported coverage. Typechecks, lint, architecture boundaries, signer inventory, large-file classification, integration-group manifest, adversarial review, and pre-commit checks passed.
