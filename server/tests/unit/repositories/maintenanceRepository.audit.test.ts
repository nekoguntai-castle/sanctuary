/**
 * PHASE D — non-regression test for audit 2026-05-12
 *
 * Finding: server/src/repositories/maintenanceRepository.ts:43 (CRITICAL)
 *   `deleteExpiredDrafts` calls `prisma.draftTransaction.deleteMany` with
 *   `where: { expiresAt: { lt: new Date() } }` — no `status` guard. A
 *   broadcasted (terminal) draft with a past `expiresAt` is destroyed by
 *   the maintenance cron, losing transaction history and audit context.
 *
 * We test by inspecting the `where` filter handed to Prisma. The filter must
 * scope to non-terminal statuses so a broadcasted draft never matches the
 * maintenance delete query.
 */
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    priceData: { deleteMany: vi.fn() },
    feeEstimate: { deleteMany: vi.fn() },
    draftTransaction: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: { deleteMany: vi.fn(), groupBy: vi.fn() },
    wallet: { count: vi.fn() },
    revokedToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: { count: vi.fn() },
    pushDevice: { groupBy: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { maintenanceRepository } from '../../../src/repositories/maintenanceRepository';

describe('maintenanceRepository — audit 2026-05-12', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test(
    'deleteExpiredDrafts skips broadcasted (terminal) drafts via a status guard',
    async () => {
      (prisma.draftTransaction.deleteMany as Mock).mockResolvedValue({ count: 0 });

      await maintenanceRepository.deleteExpiredDrafts();

      // The fix shape from the audit: reuse the actionable-status predicate
      // from draftRepository.deleteExpired. The terminal `broadcasted` state
      // (and any other terminal state) MUST NOT match the delete filter.
      expect(prisma.draftTransaction.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({
              // Whatever the exact predicate, it must constrain status —
              // not match every row regardless of state.
              in: expect.any(Array),
            }),
          }),
        }),
      );

      // And the call MUST NOT match a broadcasted draft. We assert by
      // reading back the argument and confirming that, if `status.in` is
      // present, it excludes 'broadcasted'.
      const call = (prisma.draftTransaction.deleteMany as Mock).mock.calls[0][0];
      const statusFilter = call?.where?.status;
      expect(statusFilter).toBeDefined();
      if (statusFilter && Array.isArray(statusFilter.in)) {
        expect(statusFilter.in).not.toContain('broadcasted');
      }
    },
  );
});
