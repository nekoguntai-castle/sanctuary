import { describe, expect, it, vi } from 'vitest';
import {
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
  mockLogError,
  mockLogWarn,
  mockNotificationUnsubscribeWalletAddresses,
  mockPrismaClient,
  mockSyncUnsubscribeWalletAddresses,
} from './walletTestHarness';
import {
  addDeviceToWallet,
  checkWalletAccess,
  checkWalletAccessWithRole,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  createWallet,
  deleteWallet,
  generateAddress,
  getUserWalletRole,
  getUserWallets,
  getWalletById,
  getWalletStats,
  repairWalletDescriptor,
  updateWallet,
} from '../../../../src/services/wallet';

export function registerWalletAccessQueryTests(): void {
  describe('access helpers and wallet queries', () => {
    it('resolves direct, group, and missing wallet roles', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      await expect(getUserWalletRole('wallet-1', 'user-1')).resolves.toBe('owner');

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ groupRole: 'viewer' });
      await expect(getUserWalletRole('wallet-2', 'user-1')).resolves.toBe('viewer');

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getUserWalletRole('wallet-3', 'user-1')).resolves.toBeNull();
    });

    it('computes access booleans and role bundle', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'signer' });
      await expect(checkWalletAccess('wallet-1', 'user-1')).resolves.toBe(true);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'viewer' });
      await expect(checkWalletEditAccess('wallet-1', 'user-1')).resolves.toBe(false);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      await expect(checkWalletOwnerAccess('wallet-1', 'user-1')).resolves.toBe(true);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ groupRole: 'signer' });
      await expect(checkWalletAccessWithRole('wallet-1', 'user-1')).resolves.toEqual({
        hasAccess: true,
        canEdit: true,
        role: 'signer',
      });
    });

    it('returns empty list for user with no wallets', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([]);
      await expect(getUserWallets('user-empty')).resolves.toEqual([]);
    });

    it('maps wallet summaries with balances, sharing, and permissions', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet-owner',
          name: 'Owner Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: null,
          totalSigners: null,
          descriptor: 'desc-1',
          fingerprint: 'abcd1234',
          createdAt: now,
          devices: [{ id: 'd1' }],
          addresses: [{ id: 'a1' }, { id: 'a2' }],
          group: null,
          users: [{ userId: 'user-1', role: 'owner' }],
          groupRole: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          syncInProgress: false,
        },
        {
          id: 'wallet-group',
          name: 'Group Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          quorum: 2,
          totalSigners: 3,
          descriptor: 'desc-2',
          fingerprint: 'efgh5678',
          createdAt: now,
          devices: [{ id: 'd2' }, { id: 'd3' }],
          addresses: [{ id: 'a3' }],
          group: { name: 'Treasury' },
          users: [{ userId: 'owner-2', role: 'owner' }, { userId: 'owner-3', role: 'owner' }],
          groupRole: 'viewer',
          lastSyncedAt: now,
          lastSyncStatus: 'success',
          syncInProgress: false,
        },
      ]);
      mockPrismaClient.uTXO.groupBy.mockResolvedValueOnce([
        { walletId: 'wallet-owner', _sum: { amount: BigInt(1500) } },
        { walletId: 'wallet-group', _sum: { amount: BigInt(2500) } },
      ]);

      const results = await getUserWallets('user-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(expect.objectContaining({
        id: 'wallet-owner',
        balance: 1500,
        isShared: false,
        userRole: 'owner',
        canEdit: true,
      }));
      expect(results[1]).toEqual(expect.objectContaining({
        id: 'wallet-group',
        balance: 2500,
        isShared: true,
        userRole: 'viewer',
        canEdit: false,
        sharedWith: {
          groupName: 'Treasury',
          userCount: 2,
        },
      }));
    });

    it('falls back to zero balances and group-role defaults in wallet summaries', async () => {
      const now = new Date('2025-02-01T00:00:00.000Z');
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet-null-balance',
          name: 'Null Balance',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: null,
          totalSigners: null,
          descriptor: 'desc-null',
          fingerprint: 'f1',
          createdAt: now,
          devices: [],
          addresses: [],
          group: null,
          users: [{ userId: 'user-1', role: 'owner' }],
          groupRole: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          syncInProgress: false,
        },
        {
          id: 'wallet-group-fallback',
          name: 'Group Fallback',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 3,
          descriptor: 'desc-group',
          fingerprint: 'f2',
          createdAt: now,
          devices: [],
          addresses: [],
          group: {} as any,
          users: [{ userId: 'other-1', role: 'owner' }, { userId: 'other-2', role: 'owner' }],
          groupRole: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          syncInProgress: false,
        },
      ]);
      mockPrismaClient.uTXO.groupBy.mockResolvedValueOnce([
        { walletId: 'wallet-null-balance', _sum: { amount: null } },
      ]);

      const results = await getUserWallets('user-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(expect.objectContaining({
        id: 'wallet-null-balance',
        balance: 0,
      }));
      expect(results[1]).toEqual(expect.objectContaining({
        id: 'wallet-group-fallback',
        balance: 0,
        userRole: 'viewer',
        sharedWith: {
          groupName: null,
          userCount: 2,
        },
      }));
    });

    it('returns null role when summary wallet has neither direct nor group role data', async () => {
      const now = new Date('2025-02-02T00:00:00.000Z');
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet-no-role',
          name: 'No Role Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: null,
          totalSigners: null,
          descriptor: null,
          fingerprint: null,
          createdAt: now,
          devices: [],
          addresses: [],
          group: null,
          users: [{ userId: 'different-user', role: 'owner' }],
          groupRole: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          syncInProgress: false,
        },
      ]);
      mockPrismaClient.uTXO.groupBy.mockResolvedValueOnce([]);

      const results = await getUserWallets('user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(expect.objectContaining({
        id: 'wallet-no-role',
        userRole: null,
        canEdit: false,
      }));
    });

    it('returns null for inaccessible wallet and maps wallet detail when found', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getWalletById('wallet-missing', 'user-1')).resolves.toBeNull();

      const now = new Date('2025-01-01T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        name: 'Detail Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd',
        createdAt: now,
        devices: [{ id: 'wd1', device: { id: 'd1' } }],
        addresses: [{ id: 'a1', index: 0 }],
        users: [{ userId: 'user-1', role: 'signer', user: { id: 'user-1', username: 'alice' } }],
        group: { name: 'Ops', members: [{ role: 'viewer' }] },
        groupRole: 'viewer',
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(4321) } });

      const wallet = await getWalletById('wallet-1', 'user-1');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-1',
        balance: 4321,
        userRole: 'signer',
        canEdit: true,
        isShared: true,
      }));
    });

    it('uses group role when wallet access is only via group membership', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-group-only',
        name: 'Group Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: 'desc',
        fingerprint: 'abcd',
        createdAt: now,
        devices: [{ id: 'wd1', device: { id: 'd1' } }],
        addresses: [{ id: 'a1', index: 0 }],
        users: [{ userId: 'owner-1', role: 'owner', user: { id: 'owner-1', username: 'owner' } }],
        group: { name: 'Treasury', members: [{ role: 'viewer' }] },
        groupRole: 'viewer',
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(101) } });

      const wallet = await getWalletById('wallet-group-only', 'user-via-group');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-group-only',
        userRole: 'viewer',
        canEdit: false,
      }));
    });

    it('maps private wallet detail with null aggregate balance fallback', async () => {
      const now = new Date('2025-03-01T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-private',
        name: 'Private Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f0',
        createdAt: now,
        devices: [{ id: 'wd1', device: { id: 'd1' } }],
        addresses: [{ id: 'a1', index: 0 }],
        users: [{ userId: 'user-1', role: 'owner', user: { id: 'user-1', username: 'alice' } }],
        group: null,
        groupRole: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });

      const wallet = await getWalletById('wallet-private', 'user-1');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-private',
        balance: 0,
        isShared: false,
        sharedWith: undefined,
        userRole: 'owner',
      }));
    });

    it('falls back shared groupName to null for group-only access without group name', async () => {
      const now = new Date('2025-03-02T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-group-null-name',
        name: 'Group Null Name',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'desc',
        fingerprint: 'f3',
        createdAt: now,
        devices: [{ id: 'wd1', device: { id: 'd1' } }],
        addresses: [{ id: 'a1', index: 0 }],
        users: [{ userId: 'other-user', role: 'owner', user: { id: 'other-user', username: 'owner' } }],
        group: {} as any,
        groupRole: 'viewer',
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(10) } });

      const wallet = await getWalletById('wallet-group-null-name', 'group-user');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-group-null-name',
        userRole: 'viewer',
        sharedWith: {
          groupName: null,
          userCount: 1,
        },
      }));
    });

    it('returns null userRole for wallet detail without direct or group role data', async () => {
      const now = new Date('2025-03-03T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-detail-no-role',
        name: 'No Role Detail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'ff00',
        createdAt: now,
        devices: [],
        addresses: [],
        users: [{ userId: 'other-user', role: 'owner', user: { id: 'other-user', username: 'owner' } }],
        group: null,
        groupRole: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(1) } });

      const wallet = await getWalletById('wallet-detail-no-role', 'user-1');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-detail-no-role',
        userRole: null,
        canEdit: false,
      }));
    });
  });
}
