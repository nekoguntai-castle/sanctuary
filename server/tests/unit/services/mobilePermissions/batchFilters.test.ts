/**
 * Mobile permission batch filters
 *
 * filterWalletIdsByMobileAction / filterUserIdsByMobileAction resolve view
 * actions for many wallets or members with one repository read.
 */

import { vi, type Mock } from 'vitest';

vi.mock('../../../../src/repositories', () => ({
  mobilePermissionRepository: {
    findByUserId: vi.fn(),
    findByWalletIdAndUserIds: vi.fn(),
  },
}));
vi.mock('../../../../src/services/accessControl', () => ({ getUserWalletRoleUncached: vi.fn() }));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { mobilePermissionRepository } from '../../../../src/repositories';
import { mobilePermissionService } from '../../../../src/services/mobilePermissions';

const row = (walletId: string, userId: string, overrides: Record<string, unknown> = {}) => ({
  walletId,
  userId,
  canViewBalance: true,
  canViewTransactions: true,
  canViewUtxos: true,
  ownerMaxPermissions: null,
  ...overrides,
});

describe('mobilePermissionService batch filters', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('filterWalletIdsByMobileAction', () => {
    it('returns nothing without reading when no wallets are given', async () => {
      await expect(mobilePermissionService.filterWalletIdsByMobileAction('u1', [], 'viewBalance'))
        .resolves.toEqual([]);
      expect(mobilePermissionRepository.findByUserId).not.toHaveBeenCalled();
    });

    it('drops wallets whose saved row, or owner cap, disables the action', async () => {
      (mobilePermissionRepository.findByUserId as Mock).mockResolvedValue([
        row('w1', 'u1', { canViewTransactions: false }),
        row('w2', 'u1', { ownerMaxPermissions: { viewTransactions: false } }),
        row('w3', 'u1'),
        row('unrelated', 'u1', { canViewTransactions: false }),
      ]);

      await expect(mobilePermissionService.filterWalletIdsByMobileAction(
        'u1',
        [{ walletId: 'w1' }, { walletId: 'w2' }, { walletId: 'w3' }, { walletId: 'w4', role: 'owner' }],
        'viewTransactions'
      )).resolves.toEqual(['w3', 'w4']);
    });

    it('passes a role-less or non-viewer role through the role capability check', async () => {
      (mobilePermissionRepository.findByUserId as Mock).mockResolvedValue([]);

      await expect(mobilePermissionService.filterWalletIdsByMobileAction(
        'u1', [{ walletId: 'w1', role: null }, { walletId: 'w2', role: 'approver' }], 'viewBalance'
      )).resolves.toEqual(['w1', 'w2']);
    });
  });

  describe('filterUserIdsByMobileAction', () => {
    it('returns nothing without reading when no users are given', async () => {
      await expect(mobilePermissionService.filterUserIdsByMobileAction('w1', [], 'viewTransactions'))
        .resolves.toEqual([]);
      expect(mobilePermissionRepository.findByWalletIdAndUserIds).not.toHaveBeenCalled();
    });

    it('keeps users without a row and drops capped ones, preserving order', async () => {
      (mobilePermissionRepository.findByWalletIdAndUserIds as Mock).mockResolvedValue(new Map([
        ['u2', row('w1', 'u2', { canViewTransactions: false })],
        ['u3', row('w1', 'u3')],
      ]));

      await expect(mobilePermissionService.filterUserIdsByMobileAction(
        'w1', ['u1', 'u2', 'u3'], 'viewTransactions'
      )).resolves.toEqual(['u1', 'u3']);
      expect(mobilePermissionRepository.findByWalletIdAndUserIds)
        .toHaveBeenCalledWith('w1', ['u1', 'u2', 'u3']);
    });

    it('propagates a lookup failure to the caller', async () => {
      (mobilePermissionRepository.findByWalletIdAndUserIds as Mock).mockRejectedValue(new Error('db down'));

      await expect(mobilePermissionService.filterUserIdsByMobileAction('w1', ['u1'], 'viewTransactions'))
        .rejects.toThrow('db down');
    });
  });
});
