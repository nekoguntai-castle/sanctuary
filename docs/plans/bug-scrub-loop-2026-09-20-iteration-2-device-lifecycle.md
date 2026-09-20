# Bug scrub loop iteration 2: serialize device deletion decisions

Source target: `d507146c82bf20d93676bfd6be8f09fb1f596bf6` (`origin/main`). Scope: whole repository. Findings: `device-accounts--concurrent-last-account-deletion` and `device-delete--wallet-link-cascade-race` (both P2).

## Goal and evidence

Keep at least one account on every surviving device and never delete a device after it becomes linked to a wallet. `DELETE /devices/:id/accounts/:accountId` checks account count and then deletes through separate autocommit repository calls (`server/src/api/devices/accounts.ts:115-122`). Two requests for different accounts can each see two and both delete. `DELETE /devices/:id` reads wallet links and later deletes separately (`server/src/api/devices/crud.ts:190-202`). A wallet creation transaction can insert a `WalletDevice` between those calls; the `WalletDevice.device` relation has `onDelete: Cascade` (`server/prisma/schema.prisma:355`), so the delete removes the newly attached signer. Existing route tests cover sequential cases only.

## Assumptions and limits

- PostgreSQL is the authoritative store. A transaction that locks the `devices` row with `FOR UPDATE`, then performs its checks and delete, serializes concurrent deletion requests. A concurrent child insert's foreign-key check takes a parent key-share lock, so device deletion must wait for an already in-flight wallet link and then observe it; a later insert must wait for the delete and fail its foreign key check.
- Preserve current owner middleware, hardware capability checks, response codes/messages, and success logging. Keep Prisma access inside `deviceRepository`; routes must not import Prisma.
- The account's `walletBindings` foreign key is `onDelete: Restrict`. Recheck bindings after acquiring the parent lock so a concurrent wallet attach returns the existing conflict outcome instead of surfacing a raw database error.
- No schema migration or production data repair is planned. Existing devices with zero accounts are outside this race fix; do not silently delete or fabricate account data.
- The remaining P2 auth-bootstrap finding is a separate plan. P3 backlog is outside this blocking fix set.

## Phase 1 — one mergeable application PR

- [ ] Add failing concurrency regressions before production edits. At minimum, prove with a disposable PostgreSQL database that two deletes of the final two accounts leave exactly one account and one request fails with the current last-account outcome. Exercise both wallet-link orderings with barriers: when the link transaction holds its parent foreign-key lock first, deletion waits and then rejects the linked device; when deletion holds the device-row lock first, the link insert waits and then fails its foreign key check. Use committed fixtures outside `withTestTransaction`, because its outer transaction rolls back and hides them from parallel connections. Add route/unit coverage for the unchanged 404, capability, bound-account, last-account, and linked-device responses; mock the lock row explicitly because the Prisma test harness defaults `$queryRaw` to `[]`.
- [ ] Add a small repository transaction helper for locking a device row. Use an interactive transaction and `SELECT ... FOR UPDATE` on the exact device ID before each deletion's relevant reads. Handle a missing row explicitly. Reuse the lock helper for both account and device deletion paths; do not expose Prisma clients to routes or services.
- [ ] Keep the account preflight lookup so a missing account and missing device still return `Account not found`, then recheck account existence, binding, count, and delete in one locked repository operation. Return a discriminated result with the deleted account's metadata so the route can preserve its current errors and log. Preserve the current device/model capability check and repeat it against the locked device snapshot through a callback passed into the repository operation; a concurrent model update must not bypass the hardware restriction.
- [ ] Move the device wallet-link check and delete into one locked repository operation. Return linked wallet names for the existing conflict response. Confirm a wallet link creation racing the lock cannot be cascaded away. Keep wallet creation and its link transaction unchanged.
- [ ] Re-read the diff for lock order, transaction timeout/retry behavior, null/missing account and device cases, error mapping, and unrelated changes. Update generated architecture docs only if their graph changes.

Acceptance: concurrent final-account deletes leave one account; concurrent wallet binding is either rejected because the device was deleted first or remains attached while device deletion reports conflict. Sequential API behavior and hardware restrictions are unchanged. No raw Prisma conflict escapes where a domain conflict is expected.

## Verification and delivery

1. Focused unit: `cd server && npx vitest run tests/unit/api/devices.test.ts`. Run the real PostgreSQL concurrency proof with `./scripts/run-integration-tests.sh tests/integration/repositories/deviceRepository.test.ts`; direct Vitest skips it without a database URL. The script uses a guarded disposable database. Never point tests at the live stack.
2. Required local gate before commit: `cd server && npx tsc --noEmit && npm run typecheck:tests && npx vitest run && npx vitest run --coverage tests/unit`; from repo root, `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run`.
3. Run adversarial implementation review and the repository pre-commit gate. Deliver one PR through `pr-delivery`; require exact head checks, verified squash-merge ancestry, and exact target-branch push CI. Defer the running-container rebuild to the outer loop's final clean closeout.
4. Refresh `origin/main`, confirm the two device races no longer recur, and rescrub all eight original domains. The loop remains open while the auth-bootstrap P2 persists.

Backout: revert the bounded PR if deletion errors or lock contention regressions appear. No migration rollback is needed. Preserve device and wallet-link data during backout and use `./start.sh --rebuild` only at final clean closeout.
