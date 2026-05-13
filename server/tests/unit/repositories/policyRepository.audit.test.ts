/**
 * PHASE D — failing non-regression test for audit 2026-05-12
 *
 * Finding: server/src/repositories/policyRepository.ts:411 (CRITICAL,
 *   double-flagged Claude+Codex)
 *   `findOrCreateUsageWindow` normalizes a missing `userId` to `null` and
 *   relies on a unique constraint over (policyId, walletId, userId,
 *   windowType, windowStart). Plain Postgres unique indexes treat NULL as
 *   distinct (no `NULLS NOT DISTINCT`, no partial index), so two concurrent
 *   wallet-scoped calls (userId IS NULL) both miss the fast-path find AND
 *   both succeed at `create` — duplicate windows result.
 *
 * The true regression test for this requires a real Postgres test database
 * with concurrent transactions — the unit-test Prisma mock cannot model
 * NULL-distinct uniqueness semantics. The repository's mock-friendly retry
 * path only triggers on a P2002 throw, which the database never produces
 * for this case.
 *
 * Per the audit workflow we record this as a detailed `it.todo` describing
 * the required fixture so the next engineer wires it correctly, and as a
 * `test.fails` smoke test that documents the unique-key claim made by
 * the repository's inline comment.
 */
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

const auditMocks = vi.hoisted(() => ({
  prisma: {
    vaultPolicy: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    approvalRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    approvalVote: { create: vi.fn(), findUnique: vi.fn() },
    policyEvent: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    policyAddress: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    policyUsageWindow: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: auditMocks.prisma,
}));

import { policyRepository } from '../../../src/repositories/policyRepository';

const { prisma } = auditMocks;

describe('policyRepository — audit 2026-05-12', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * REQUIRED INFRASTRUCTURE
   * -----------------------
   * To convert this `it.todo` into a real test, we need:
   *
   *   1. A `withConcurrentDb(fn)` integration helper that:
   *        - Boots (or attaches to) the project's Postgres test database
   *          gated by `describeIfDatabase` (already exists at
   *          server/tests/integration/repositories/setup/).
   *        - Returns a Prisma client connected to that DB (no mocks).
   *        - Resets the `PolicyUsageWindow` table between cases.
   *   2. A `Promise.all([...])` pair of `policyRepository.findOrCreateUsageWindow`
   *      calls for the same (policyId, walletId, userId=null, windowType,
   *      windowStart). To force the race, both promises must start
   *      before either resolves — use `await new Promise(r => setImmediate(r))`
   *      between scheduling them, or fire them inside two independent
   *      transactions started via `prisma.$transaction([...], { isolationLevel: 'ReadCommitted' })`.
   *   3. Post-call assertion:
   *        const rows = await prisma.policyUsageWindow.findMany({
   *          where: { policyId, walletId, userId: null, windowType, windowStart },
   *        });
   *        expect(rows).toHaveLength(1);    // currently 2 on main
   *
   * On main with the current migration this assertion fails because PG
   * treats `NULL` as distinct in the composite unique index, so both
   * `create()` calls commit.
   *
   * The fix shape (per the audit) is one of:
   *   - migrate the unique index to `NULLS NOT DISTINCT` (PG15+), or
   *   - add a partial unique index `(policyId, walletId, windowType,
   *     windowStart) WHERE userId IS NULL`,
   * after which exactly one row exists and the second call resolves via
   * the P2002 retry-find branch.
   */
  test.todo(
    'findOrCreateUsageWindow creates exactly one row under concurrent userId=null calls (needs Postgres integration fixture; see file header)',
  );

  // NOTE: An earlier draft included a `.fails()` asserting that
  // `policyRepository.findOrCreateUsageWindow` calls `prisma.policyUsageWindow.upsert`.
  // That test was a FALSE GATE: the fix shape for this bug is
  // primarily a DATABASE MIGRATION (add `NULLS NOT DISTINCT` or a partial
  // unique index where `userId IS NULL`). A correct fix may NOT change the
  // code path at all — the migration alone can be sufficient. Asserting an
  // implementation choice (`upsert`) would either fail-positive on a
  // correct-but-migration-only fix, or pass-by-accident if some unrelated
  // refactor introduces `upsert`. It was removed during Phase D self-review.
  //
  // The honest gate for this finding is the `it.todo` above: a real Postgres
  // integration test that asserts AT MOST ONE row exists after concurrent
  // calls. That is invariant-shaped (no impl-choice coupling). Writing it
  // requires the `withConcurrentDb` helper described in the file header.
});
