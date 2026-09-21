# Bug scrub loop iteration 6: require group membership before associating resources

Source target: `5e585e5658dfb16c8f6f78b3182c12f4206f99c1` (`origin/main`). Scope: whole repository. The complete iteration 6 eight-domain pass confirmed the two P2 findings below. The prior phase's code and delivery record are the only changes since iteration 5.

## Goal and evidence

1. `wallet-create--nonmember-group-association` (P2): `CreateWalletBodySchema` accepts any `groupId`; `createWallet` connects it without membership validation. The existing integration test in `groups-telegram.contracts.ts` creates a group without members and proves an unrelated authenticated user receives 201 and the group link persists. Group members gain access through `buildWalletAccessWhere`. The later wallet share/group endpoint requires membership.
2. `device-share--nonmember-group-association` (P2): `shareDeviceWithGroup` checks device ownership and group existence, then updates `Device.groupId` without caller membership. Group members receive device metadata and accounts through `findAccessibleByUser`, including xpubs. Unit/API tests cover owner and group existence but omit nonmember denial.

## Assumptions and limits

- Follow the existing wallet share/group policy: the associating resource owner must currently belong to the target group. Clearing a group link remains allowed regardless of present membership.
- Preserve owner role, default viewer group role, direct-first access precedence, and authorized group member sharing.
- Check membership at the service boundary so non-HTTP callers cannot bypass it. Record the normal check-to-write revocation race if the existing repository structure does not support a shared lock; do not claim serializable membership revocation without proof.
- No migration or data repair is authorized. Previously attached resources remain as stored; this fixes future associations.
- Do not change group administration, existing wallet/device ownership, direct-role precedence, unrelated sharing routes, descriptor creation, or sync scheduling.
- P3 backlog is outside the blocking fix set.

## Phase 1 — group association access PR

- [x] Turn the existing real PostgreSQL wallet-create integration case into a red nonmember regression: expect 403, no wallet/group association persisted, and no sync wakeup. Retain a separate member success case and absent group/invalid group behavior. Add service-level membership tests for direct callers.
- [x] Add a red device-sharing service/API regression: owner outside target group denied without update, member allowed, non-owner denied, nonexistent group rejected, and null removal remains allowed. Add a real PostgreSQL repository test that calls `deviceRepository.findAccessibleByUser` after an authorized group association: the member sees the device and account xpub, while a nonmember does not. Use committed fixtures with explicit local cleanup because this repository method uses its own Prisma client and cannot see uncommitted `withTestTransaction` fixtures.
- [x] Require group membership before `createWallet` connects `groupId` and before `shareDeviceWithGroup` updates a non-null `groupId`. Reuse a repository-backed membership helper, preserve explicit ForbiddenError/HTTP 403 semantics, and avoid replacing unrelated role or device fields.
- [ ] Re-read create/share callers, group role precedence, and transaction boundaries. Run focused service/API/integration tests with signed database cleanup, server/root typechecks and coverage, lint/architecture/large-file/complexity gates, independent adversarial review, and pre-commit checks.

Production boundaries: `server/src/api/wallets/crud.ts` passes the caller ID and group ID into `server/src/services/wallet/walletCreate.ts`, which calls `walletRepository.createWithDeviceLinks`. `server/src/api/devices/sharing.ts` passes the authenticated owner and group ID into `server/src/services/deviceAccess.ts`, which calls `deviceRepository.update`. Read group membership through the existing repository contract at those service boundaries. Keep the existing group member access queries and API payload shapes.

Focused verification: `cd server && npx vitest run tests/unit/services/deviceAccess.test.ts tests/unit/api/device-sharing-routes.test.ts tests/unit/services/wallet.test.ts`, then `./scripts/run-integration-tests.sh tests/integration/flows/wallet.integration.test.ts tests/integration/repositories/deviceSharingRepository.test.ts` from the repository root. The guarded database run must report signed cleanup as `cleaned`. Broad gates: `cd server && npm run typecheck:tests && npx tsc --noEmit && npx vitest run --coverage tests/unit`; from root run `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:all`, `npm run test:coverage`, `npm run lint:server`, `npm run check:architecture-boundaries`, `node scripts/quality/check-large-files.mjs`, and `bash scripts/quality/lizard-only.sh`. Run the foreground commit hook under Node 24.21.0/npm 12.0.2.

Acceptance: a nonmember with a valid known group ID cannot attach a new wallet or owned device to that group; a member can; removal is unaffected; no partial wallet/device write occurs on denial. Deliver through PR with exact-head checks, verified squash-merge ancestry, and exact-merge target CI. Defer running-stack rebuild until the loop's final clean closeout.

Backout: revert the phase PR. No schema change or repair is planned.

## Implementation verification

The wallet service regression failed before the fix and passed afterward. The device service regression also failed before the fix. Owner nonmembers receive 403 before either resource is updated; group members retain access, and null removal remains available. The device PostgreSQL case uses committed fixtures and exact cleanup. The new checks follow the existing group-sharing policy; membership revocation between the read and write remains a normal race.

Local gates passed under Node 24.21.0/npm 12.0.2: focused wallet unit 120/120, device unit 55/55, wallet PostgreSQL 64/64 and device PostgreSQL 13/13 with both signed cleanup receipts `cleaned`; server full suite 16,397 passed, 753 skipped, one todo; server unit coverage 16,298/16,298 and 100% across statements, branches, functions, and lines; root coverage 8,751/8,751 and 100% across those dimensions; server/root typechecks, root build, lint, architecture boundaries, large-file and complexity gates passed. Independent adversarial review found no actionable issues.
