import { vi } from 'vitest';
/**
 * Wallet Service Tests
 *
 * Tests for wallet service functions including:
 * - createWallet with device account selection
 * - Account selection based on wallet type and script type
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Hoist mock variables for use in vi.mock() factories
const {
  mockBuildDescriptorFromDevices,
  mockLogWarn,
  mockLogError,
  mockSyncUnsubscribeWalletAddresses,
  mockNotificationUnsubscribeWalletAddresses,
  mockHookExecuteAfter,
  mockCache,
} = vi.hoisted(() => ({
  mockBuildDescriptorFromDevices: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockSyncUnsubscribeWalletAddresses: vi.fn(),
  mockNotificationUnsubscribeWalletAddresses: vi.fn(),
  mockHookExecuteAfter: vi.fn(),
  mockCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deletePattern: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock descriptor builder
vi.mock('../../../src/services/bitcoin/descriptorBuilder', () => ({
  buildDescriptorFromDevices: (...args: any[]) => mockBuildDescriptorFromDevices(...args),
}));

// Mock address derivation
vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: vi.fn().mockReturnValue({
    address: 'bc1qmockaddress',
    derivationPath: "m/84'/0'/0'/0/0",
  }),
}));

// Mock Redis cache (access control uses cached getUserWalletRole)
vi.mock('../../../src/infrastructure/redis', () => ({
  getNamespacedCache: () => mockCache,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLogWarn,
    error: mockLogError,
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/services/hooks', () => ({
  hookRegistry: {
    executeAfter: (...args: any[]) => mockHookExecuteAfter(...args),
  },
  Operations: {
    WALLET_CREATE: 'wallet.create',
    WALLET_DELETE: 'wallet.delete',
    ADDRESS_GENERATE: 'address.generate',
  },
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => ({
    unsubscribeWalletAddresses: mockSyncUnsubscribeWalletAddresses,
  }),
}));

vi.mock('../../../src/websocket/notifications', () => ({
  notificationService: {
    unsubscribeWalletAddresses: mockNotificationUnsubscribeWalletAddresses,
  },
}));

// Import after mocks
import {
  createWallet,
  getUserWalletRole,
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletAccessWithRole,
  getUserWallets,
  getWalletById,
  updateWallet,
  deleteWallet,
  addDeviceToWallet,
  generateAddress,
  repairWalletDescriptor,
  getWalletStats,
} from '../../../src/services/wallet';

describe('Wallet Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
      fingerprint: 'abc12345',
    });
    mockHookExecuteAfter.mockResolvedValue(undefined);
    mockSyncUnsubscribeWalletAddresses.mockResolvedValue(undefined);
    mockNotificationUnsubscribeWalletAddresses.mockResolvedValue(undefined);
  });

  describe('createWallet - Account Selection', () => {
    const userId = 'test-user-id';

    // Helper to create mock device with accounts
    const createMockDevice = (
      id: string,
      fingerprint: string,
      accounts: Array<{
        purpose: string;
        scriptType: string;
        derivationPath: string;
        xpub: string;
      }>
    ) => ({
      id,
      userId,
      fingerprint,
      type: 'trezor',
      label: `Device ${id}`,
      xpub: accounts[0]?.xpub || 'legacy_xpub',
      derivationPath: accounts[0]?.derivationPath || "m/84'/0'/0'",
      accounts,
    });

    describe('Single-sig wallet creation', () => {
      it('should select single_sig account for single-sig wallet', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_sig',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Verify descriptor builder was called with single-sig xpub
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: 'abc12345',
              xpub: 'xpub_single_sig',
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should match scriptType when selecting account', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_native_segwit',
          },
          {
            purpose: 'single_sig',
            scriptType: 'taproot',
            derivationPath: "m/86'/0'/0'",
            xpub: 'xpub_taproot',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          deviceIds: ['device-1'],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'xpub_taproot',
              derivationPath: "m/86'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });
    });

    describe('Multi-sig wallet creation', () => {
      it('should select multisig account for multi-sig wallet', async () => {
        const device1 = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_1',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multi_1',
          },
        ]);

        const device2 = createMockDevice('device-2', 'def67890', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_2',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multi_2',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockBuildDescriptorFromDevices.mockReturnValue({
          descriptor: 'wsh(sortedmulti(2,[abc12345/48h/0h/0h/2h]xpub...,[def67890/48h/0h/0h/2h]xpub...))',
          fingerprint: 'abc12345',
        });
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 2,
          deviceIds: ['device-1', 'device-2'],
        });

        // Verify descriptor builder was called with multisig xpubs
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: 'abc12345',
              xpub: 'xpub_multi_1',
              derivationPath: "m/48'/0'/0'/2'",
            }),
            expect.objectContaining({
              fingerprint: 'def67890',
              xpub: 'xpub_multi_2',
              derivationPath: "m/48'/0'/0'/2'",
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should warn when using single-sig account for multisig wallet', async () => {
        // Device only has single-sig account
        const device1 = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_1',
          },
        ]);

        const device2 = createMockDevice('device-2', 'def67890', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_2',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 2,
          deviceIds: ['device-1', 'device-2'],
        });

        // Should log warning about using single-sig for multisig
        expect(mockLogWarn).toHaveBeenCalledWith(
          'Using single-sig account for multisig wallet - this may cause signing issues',
          expect.objectContaining({
            hint: expect.stringContaining('multisig account'),
          })
        );
      });
    });

    describe('Fallback behavior', () => {
      it('should fall back to first account when no matching purpose found', async () => {
        // Device only has multisig account but we're creating single-sig wallet
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig_only',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Should log warning and use the available account
        expect(mockLogWarn).toHaveBeenCalledWith(
          'No matching account found for wallet type, using first account',
          expect.objectContaining({
            walletType: 'single_sig',
          })
        );

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'xpub_multisig_only',
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should fall back to legacy device.xpub when no accounts exist', async () => {
        // Device has no accounts (legacy device)
        const legacyDevice = {
          id: 'device-1',
          userId,
          fingerprint: 'abc12345',
          type: 'trezor',
          label: 'Legacy Device',
          xpub: 'legacy_xpub',
          derivationPath: "m/84'/0'/0'",
          accounts: [], // No accounts
        };

        mockPrismaClient.device.findMany.mockResolvedValue([legacyDevice]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Should use legacy xpub from device
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'legacy_xpub',
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });

      it('normalizes empty account derivationPath to undefined for descriptor generation', async () => {
        const device = {
          id: 'device-1',
          userId,
          fingerprint: 'abc12345',
          type: 'trezor',
          label: 'No Path Device',
          xpub: 'xpub_fallback_no_path',
          derivationPath: '',
          accounts: [
            {
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: '',
              xpub: 'xpub_single_sig_no_path',
            },
          ],
        };

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'No Path Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'No Path Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'No Path Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'xpub_single_sig_no_path',
              derivationPath: undefined,
            }),
          ]),
          expect.any(Object)
        );
      });
    });

    describe('Validation', () => {
      it('requires quorum and totalSigners for multi-sig wallets', async () => {
        await expect(
          createWallet(userId, {
            name: 'Invalid MultiSig Wallet',
            type: 'multi_sig',
            scriptType: 'native_segwit',
          })
        ).rejects.toThrow('Quorum and totalSigners required for multi-sig wallets');
      });

      it('rejects multi-sig wallets where quorum exceeds total signers', async () => {
        await expect(
          createWallet(userId, {
            name: 'Invalid MultiSig Wallet',
            type: 'multi_sig',
            scriptType: 'native_segwit',
            quorum: 3,
            totalSigners: 2,
          })
        ).rejects.toThrow('Quorum cannot exceed total signers');
      });

      it('should reject single-sig wallet with multiple devices', async () => {
        const device1 = createMockDevice('device-1', 'abc12345', [
          { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub1' },
        ]);
        const device2 = createMockDevice('device-2', 'def67890', [
          { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub2' },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);

        await expect(
          createWallet(userId, {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            deviceIds: ['device-1', 'device-2'],
          })
        ).rejects.toThrow('Single-sig wallet requires exactly 1 device');
      });

      it('should reject multi-sig wallet with single device', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub1' },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);

        await expect(
          createWallet(userId, {
            name: 'MultiSig Wallet',
            type: 'multi_sig',
            scriptType: 'native_segwit',
            quorum: 2,
            totalSigners: 2,
            deviceIds: ['device-1'],
          })
        ).rejects.toThrow('Multi-sig wallet requires at least 2 devices');
      });

      it('should reject when device not found', async () => {
        mockPrismaClient.device.findMany.mockResolvedValue([]); // No devices found

        await expect(
          createWallet(userId, {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            deviceIds: ['non-existent-device'],
          })
        ).rejects.toThrow('Device not found');
      });

      it('throws if wallet transaction result is unexpectedly null', async () => {
        mockPrismaClient.$transaction.mockResolvedValueOnce(null);

        await expect(
          createWallet(userId, {
            name: 'Broken Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
          })
        ).rejects.toThrow('Failed to create wallet');
      });

      it('creates wallet without device links when deviceIds are omitted', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
          id: 'wallet-no-devices',
          name: 'No Devices',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        const created = await createWallet(userId, {
          name: 'No Devices',
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(created.id).toBe('wallet-no-devices');
        expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
      });

      it('logs and continues when initial address generation fails after create', async () => {
        mockPrismaClient.$transaction.mockResolvedValueOnce({
          id: 'wallet-1',
          name: 'Descriptor Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });
        mockPrismaClient.address.createMany.mockRejectedValueOnce(new Error('address generation failed'));
        mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
          id: 'wallet-1',
          name: 'Descriptor Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        const created = await createWallet(userId, {
          name: 'Descriptor Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub...)',
        });

        expect(created.id).toBe('wallet-1');
        expect(mockLogError).toHaveBeenCalledWith(
          'Failed to generate initial addresses',
          expect.objectContaining({ error: expect.any(String) })
        );
      });

      it('swallows hook failures after successful wallet creation', async () => {
        mockPrismaClient.$transaction.mockResolvedValueOnce({
          id: 'wallet-1',
          name: 'Hook Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
          id: 'wallet-1',
          name: 'Hook Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });
        mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook create failed')));

        const created = await createWallet(userId, {
          name: 'Hook Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(created.id).toBe('wallet-1');
        await Promise.resolve();
        expect(mockLogWarn).toHaveBeenCalledWith(
          'After hook failed',
          expect.objectContaining({ error: expect.any(String) })
        );
      });
    });
  });

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

  describe('wallet mutation and maintenance operations', () => {
    it('updates wallet metadata for owners and returns computed fields', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce({
        id: 'wallet-1',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd1234',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        devices: [{ id: 'd1' }],
        addresses: [{ id: 'a1' }, { id: 'a2' }],
        group: { name: 'Treasury' },
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(9876) } });

      const updated = await updateWallet('wallet-1', 'owner-1', { name: 'Renamed Wallet' });

      expect(updated.balance).toBe(9876);
      expect(updated.deviceCount).toBe(1);
      expect(updated.addressCount).toBe(2);
      expect(updated.isShared).toBe(true);
    });

    it('falls back to zero balance and private sharing metadata for owner updates', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce({
        id: 'wallet-private',
        name: 'Private Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f0',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }],
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });

      const updated = await updateWallet('wallet-private', 'owner-1', { name: 'Private Wallet' });

      expect(updated.balance).toBe(0);
      expect(updated.isShared).toBe(false);
      expect(updated.sharedWith).toBeUndefined();
    });

    it('uses null groupName for shared wallets without a group object', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce({
        id: 'wallet-shared-no-group',
        name: 'Shared No Group',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f9',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(5) } });

      const updated = await updateWallet('wallet-shared-no-group', 'owner-1', { name: 'Shared No Group' });

      expect(updated.isShared).toBe(true);
      expect(updated.sharedWith).toEqual({
        groupName: null,
        userCount: 2,
      });
    });

    it('rejects update for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(updateWallet('wallet-1', 'viewer-1', { name: 'Nope' })).rejects.toThrow('Only wallet owners can update wallet');
    });

    it('deletes wallet after unsubscribing realtime listeners', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });

      await deleteWallet('wallet-1', 'owner-1');

      expect(mockSyncUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockNotificationUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockPrismaClient.wallet.delete).toHaveBeenCalledWith({ where: { id: 'wallet-1' } });
    });

    it('swallows hook failures after delete', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook delete failed')));

      await deleteWallet('wallet-1', 'owner-1');

      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'After hook failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects delete for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(deleteWallet('wallet-1', 'viewer-1')).rejects.toThrow('Only wallet owners can delete wallet');
    });

    it('links a device and regenerates descriptor when requirements are met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await addDeviceToWallet('wallet-1', 'device-1', 'user-1', 0);

      expect(mockPrismaClient.walletDevice.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          deviceId: 'device-1',
          signerIndex: 0,
        },
      });
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
          fingerprint: 'abc12345',
        },
      });
    });

    it('still links device when descriptor generation fails', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet('wallet-1', 'device-1', 'user-1')).resolves.toBeUndefined();
      expect(mockPrismaClient.walletDevice.create).toHaveBeenCalled();
    });

    it('defers multisig descriptor generation until required signer threshold is met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-existing',
            device: {
              id: 'device-existing',
              userId: 'user-1',
              fingerprint: 'eeeeffff',
              xpub: 'xpub-existing',
              derivationPath: "m/48'/0'/0'/2'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-new',
        userId: 'user-1',
        fingerprint: 'aaaabbbb',
        xpub: 'xpub-new',
        derivationPath: "m/48'/0'/0'/2'",
      });

      await addDeviceToWallet('wallet-multi', 'device-new', 'user-1', 1);

      expect(mockPrismaClient.walletDevice.create).toHaveBeenCalled();
      expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
    });

    it('generates multisig descriptor when signer threshold is met and normalizes missing derivation paths', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi-ready',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-existing',
            device: {
              id: 'device-existing',
              userId: 'user-1',
              fingerprint: '11112222',
              xpub: 'xpub-existing',
              derivationPath: "m/48'/0'/0'/2'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-new',
        userId: 'user-1',
        fingerprint: '33334444',
        xpub: 'xpub-new',
        derivationPath: '',
      });

      await addDeviceToWallet('wallet-multi-ready', 'device-new', 'user-1', 1);

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            fingerprint: '33334444',
            derivationPath: undefined,
          }),
        ]),
        expect.any(Object)
      );
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
    });

    it('rejects addDeviceToWallet when wallet is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);

      await expect(addDeviceToWallet('wallet-missing', 'device-1', 'user-1')).rejects.toThrow('Wallet not found');
    });

    it('rejects addDeviceToWallet when device is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce(null);

      await expect(addDeviceToWallet('wallet-1', 'device-missing', 'user-1')).rejects.toThrow('Device not found');
    });

    it('rejects addDeviceToWallet when device is already linked', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-1',
            device: {
              id: 'device-1',
              userId: 'user-1',
              fingerprint: 'aabbccdd',
              xpub: 'xpub-device-1',
              derivationPath: "m/84'/0'/0'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet('wallet-1', 'device-1', 'user-1')).rejects.toThrow(
        'Device is already linked to this wallet'
      );
    });
  });

  describe('address generation and descriptor repair', () => {
    it('throws when generating address for inaccessible wallet', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(generateAddress('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });

    it('generates the next receive address from descriptor', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: 'wpkh(mock)',
        addresses: [{ index: 4 }],
      });

      const address = await generateAddress('wallet-1', 'user-1');

      expect(address).toBe('bc1qmockaddress');
      expect(mockPrismaClient.address.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          address: 'bc1qmockaddress',
          derivationPath: "m/84'/0'/0'/0/0",
          index: 5,
          used: false,
        },
      });
    });

    it('swallows hook failures after address generation', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: 'wpkh(mock)',
        addresses: [{ index: 0 }],
      });
      mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook address failed')));

      await expect(generateAddress('wallet-1', 'user-1')).resolves.toBe('bc1qmockaddress');

      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'After hook failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects address generation when descriptor is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: null,
        addresses: [],
      });

      await expect(generateAddress('wallet-1', 'user-1')).rejects.toThrow('Wallet does not have a descriptor');
    });

    it('returns already-repaired message when descriptor exists', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'already-there',
        devices: [],
      });

      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).resolves.toEqual({
        success: true,
        message: 'Wallet already has a descriptor',
      });
    });

    it('throws when repair is requested for inaccessible wallet', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(repairWalletDescriptor('wallet-missing', 'owner-1')).rejects.toThrow('Wallet not found');
    });

    it('returns validation failure for single-sig wallets with invalid device count', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [
          { device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } },
          { device: { fingerprint: 'b', xpub: 'xpub-b', derivationPath: "m/84'/0'/0'" } },
        ],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('exactly 1 device');
    });

    it('returns validation failure when multisig lacks required devices', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [{ device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/48'/0'/0'/2'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('needs 3 devices');
    });

    it('uses default required device count for multisig repair when totalSigners is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/48'/0'/0'/2'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('needs 2 devices');
    });

    it('repairs descriptor and bulk-creates initial addresses', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'aabbccdd', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Generated descriptor');
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          skipDuplicates: true,
        })
      );
    });

    it('wraps descriptor build failures during repair', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('repair descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'aabbccdd', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } }],
      });

      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).rejects.toThrow(
        'Failed to generate descriptor: repair descriptor failed'
      );
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to repair wallet descriptor',
        expect.objectContaining({
          walletId: 'wallet-1',
          error: 'repair descriptor failed',
        })
      );
    });

    it('normalizes missing derivationPath when repairing descriptor', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-2',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: '11223344', xpub: 'xpub-no-path', derivationPath: '' } }],
      });

      await repairWalletDescriptor('wallet-2', 'owner-1');

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            fingerprint: '11223344',
            derivationPath: undefined,
          }),
        ]),
        expect.any(Object)
      );
    });

    it('repairs multisig descriptor when default required signer count is satisfied', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi-default-ready',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: null,
        descriptor: null,
        devices: [
          { device: { fingerprint: 'a1', xpub: 'xpub-a1', derivationPath: "m/48'/0'/0'/2'" } },
          { device: { fingerprint: 'b2', xpub: 'xpub-b2', derivationPath: "m/48'/0'/0'/2'" } },
        ],
      });

      const result = await repairWalletDescriptor('wallet-multi-default-ready', 'owner-1');

      expect(result.success).toBe(true);
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
    });
  });

  describe('wallet stats aggregation', () => {
    it('returns aggregate wallet stats for authorized users', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-1' });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(12000) } });
      mockPrismaClient.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(45000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(17000) } });
      mockPrismaClient.transaction.count.mockResolvedValueOnce(12);
      mockPrismaClient.uTXO.count.mockResolvedValueOnce(4);
      mockPrismaClient.address.count.mockResolvedValueOnce(8);

      const stats = await getWalletStats('wallet-1', 'user-1');

      expect(stats).toEqual({
        balance: 12000,
        received: 45000,
        sent: 17000,
        transactionCount: 12,
        utxoCount: 4,
        addressCount: 8,
      });
    });

    it('falls back aggregate amount fields to zero when sums are null', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-2' });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });
      mockPrismaClient.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      mockPrismaClient.transaction.count.mockResolvedValueOnce(0);
      mockPrismaClient.uTXO.count.mockResolvedValueOnce(0);
      mockPrismaClient.address.count.mockResolvedValueOnce(0);

      const stats = await getWalletStats('wallet-2', 'user-1');

      expect(stats).toEqual({
        balance: 0,
        received: 0,
        sent: 0,
        transactionCount: 0,
        utxoCount: 0,
        addressCount: 0,
      });
    });

    it('throws when wallet is not accessible to user', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getWalletStats('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });
  });
});
