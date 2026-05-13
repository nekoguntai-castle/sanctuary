/**
 * PHASE D — non-regression test specification for audit 2026-05-12
 *
 * Finding: server/src/repositories/walletRepository.ts:316 (CRITICAL)
 *   `findByIdWithEditAccess` includes 'signer' in the role-in-list for an
 *   "edit access" check. Owner-only call sites (wallet mutation, deletion)
 *   use this helper, so signers are accepted by owner-only paths.
 *
 * ─── SELF-REVIEW HISTORY ───────────────────────────────────────────────
 * This file previously held TWO `test.fails(...)` cases; both were removed
 * during Phase D self-review (triggered by Codex stop-time review) because
 * each had a false-gate path under at least one valid fix:
 *
 *   1. "REJECTS signer-only access" — mocked `findFirst` to always return
 *      the wallet, then asserted null. The dumb mock returned the wallet
 *      regardless of the where-clause sent by the repository, so the
 *      assertion failed BOTH on main AND after any valid fix. The test
 *      would never flip red.
 *
 *   2. "issues an owner-only role filter" — used `toHaveBeenCalledWith`
 *      with a deep-equal expectation of `role: 'owner'` (literal). It
 *      would have correctly flipped red ONLY for a literal-string fix.
 *      Two other valid fixes leave it as a permanent false gate:
 *        (a) `role: { in: ['owner'] }` — deep-equal mismatch keeps
 *            `.fails()` passing even though the bug is fixed.
 *        (b) The audit's canonical fix-shape — split helpers into
 *            explicit owner-only and signer-capable predicates and
 *            switch owner-only call sites to the new helper. The
 *            original `findByIdWithEditAccess` legitimately remains
 *            signer-capable; asserting it "rejects signers" would be
 *            semantically wrong post-fix and the `.fails()` keeps
 *            passing because the function's call shape doesn't change.
 *
 * ─── PROPER GATE (`.todo` below) ───────────────────────────────────────
 * The robust, fix-shape-agnostic gate is an INTEGRATION TEST at a
 * specific owner-only call site (e.g., wallet update, wallet delete,
 * wallet sharing-revoke) that exercises the route end-to-end:
 *
 *   1. Create a wallet with user X as owner.
 *   2. Add user Y to that wallet with role 'signer' (and only signer).
 *   3. Authenticate as user Y.
 *   4. POST/PATCH/DELETE the owner-only endpoint (e.g.,
 *      `PATCH /api/v1/wallets/:walletId` with a rename, or
 *      `DELETE /api/v1/wallets/:walletId`).
 *   5. Assert response is 403 or 404 — NOT 2xx.
 *   6. Assert the wallet state in Prisma is unchanged.
 *
 * This invariant is unchanged by any valid fix shape:
 *   - Helper signature changes (literal/in-array) → call-site rejects user Y → 403/404
 *   - Helper split + call-site swap → call-site uses new owner-only helper → rejects user Y → 403/404
 *   - Pure middleware fix at the route → same outcome
 *
 * Like the walletApprovalsAudit tests, this requires a Postgres test DB
 * (`canRunIntegrationTests()` true) and would need wiring into a CI lane.
 * See `walletApprovalsAudit.test.ts` header for the existing CI gating gap.
 */
import { describe, test } from 'vitest';

describe('walletRepository — audit 2026-05-12 (call-site gate spec)', () => {
  test.todo(
    'Owner-only wallet mutation route (e.g., PATCH /api/v1/wallets/:walletId) rejects signer-only users — see file header for full spec; needs integration-test wiring identical to walletApprovalsAudit.test.ts',
  );
});
