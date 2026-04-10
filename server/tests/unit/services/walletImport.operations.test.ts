import { vi } from 'vitest';
import './walletImport.setup'; // side effects: vi.mock calls
import {
  mockParseImportInput,
  mockBuildDescriptorFromDevices,
  mockDeriveAddressFromDescriptor,
  setupDeviceMocks,
  setupBeforeEach,
} from './walletImport.setup';
import { mockPrismaClient } from '../../mocks/prisma';
import * as walletImport from '../../../src/services/walletImport';
import type { Network } from '../../../src/services/bitcoin/descriptorParser';

describe('Wallet Import Service - Operations', () => {
  const userId = 'user-123';

  beforeEach(() => {
    setupBeforeEach();
  });

  describe('Database Operations', () => {
    it('should create wallet-device associations with correct signer indexes', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const devices = [
        { id: 'dev1', userId, type: 'unknown', label: 'Device 1', fingerprint: 'aaaa1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E1...' },
        { id: 'dev2', userId, type: 'unknown', label: 'Device 2', fingerprint: 'bbbb2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E2...' },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-assoc',
        name: 'Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig',
      });

      expect(mockPrismaClient.walletDevice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              walletId: 'wallet-assoc',
              deviceId: 'dev1',
              signerIndex: 0,
            }),
            expect.objectContaining({
              walletId: 'wallet-assoc',
              deviceId: 'dev2',
              signerIndex: 1,
            }),
          ],
        })
      );
    });

    it('should generate initial addresses for receive and change chains', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-addr',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-addr',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Verify address generation was called
      const addressCreateCall = mockPrismaClient.address.createMany.mock.calls[0][0];
      expect(addressCreateCall.data).toHaveLength(40); // 20 receive + 20 change

      // Verify receive addresses
      const receiveAddresses = addressCreateCall.data.filter((a: any) =>
        a.address.includes('receive')
      );
      expect(receiveAddresses).toHaveLength(20);

      // Verify change addresses
      const changeAddresses = addressCreateCall.data.filter((a: any) =>
        a.address.includes('change')
      );
      expect(changeAddresses).toHaveLength(20);
    });

    it('should handle address generation failure gracefully', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-fail',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-fail',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      // Mock address derivation to throw error
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed');
      });

      // Should not throw, just log error
      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      expect(result.wallet.id).toBe('wallet-fail');
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should execute import in transaction', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-tx',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-tx',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Verify transaction was used
      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle case-insensitive fingerprint matching', async () => {
      const descriptor = "wpkh([ABCD1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      // Existing device with uppercase fingerprint
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-upper',
          fingerprint: 'ABCD1234',
          label: 'Existing',
          xpub: 'xpub6Dz...',
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-case',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Should reuse existing device (case-insensitive match)
      expect(result.devicesReused).toBe(1);
      expect(result.devicesCreated).toBe(0);
    });

    it('should handle testnet network', async () => {
      const descriptor = "wpkh([abcd1234/84'/1'/0']tpub6D...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'tpub6D...', derivationPath: "m/84'/1'/0'" },
          ],
          network: 'testnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/1'/0'",
        xpub: 'tpub6D...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: null,
        totalSigners: null,
        descriptor: "wpkh([abcd1234/84h/1h/0h]tpub6D...)",
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            network: 'testnet',
          }),
        })
      );
    });
  });

  describe('DeviceAccount Creation During Import', () => {
    it('should create DeviceAccount when creating new device for single-sig wallet', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const device = {
        id: 'device-new-001',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-001',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      // Verify DeviceAccount was created with correct purpose
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-new-001',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          }),
        })
      );
    });

    it('should create DeviceAccount with multisig purpose for multi_sig wallet', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Device 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Device 2',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks(devices);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      // Verify DeviceAccount was created with multisig purpose
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            purpose: 'multisig',
            scriptType: 'native_segwit',
          }),
        })
      );
    });

    it('should add DeviceAccount to existing device when importing multisig to device with only single-sig', async () => {
      const descriptor = "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpub6E1..., [efef5678/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'efef5678', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      // Existing device with single-sig account only
      const existingDevice = {
        id: 'device-existing',
        userId,
        fingerprint: 'abcd1234',
        label: 'Existing Ledger',
        xpub: 'xpub6Dz...',
        derivationPath: "m/84'/0'/0'", // Single-sig path
      };

      // Mock existing device lookup
      mockPrismaClient.device.findMany.mockResolvedValue([existingDevice]);

      // Mock existing accounts for the device (only has single_sig)
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'account-1',
          deviceId: 'device-existing',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      // Second device is new
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-new',
        userId,
        type: 'unknown',
        label: 'Imported Device 2',
        fingerprint: 'efef5678',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: 'xpub6E2...',
      });

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      // Verify new multisig account was added to existing device
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing',
            purpose: 'multisig',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E1...',
          }),
        })
      );
    });

    it('should not create duplicate DeviceAccount when matching account exists', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      // Existing device
      const existingDevice = {
        id: 'device-existing',
        userId,
        fingerprint: 'abcd1234',
        label: 'Existing Ledger',
        xpub: 'xpub6Dz...',
        derivationPath: "m/84'/0'/0'",
      };

      mockPrismaClient.device.findMany.mockResolvedValue([existingDevice]);

      // Mock existing account that matches import
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'account-1',
          deviceId: 'device-existing',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'", // Same path as import
          xpub: 'xpub6Dz...',
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-001',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      // Clear mock call count before import
      mockPrismaClient.deviceAccount.create.mockClear();

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      // DeviceAccount.create should NOT be called since matching account exists
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing',
          }),
        })
      );
    });

    it('should use imported derivation paths for descriptor building, not stored device paths', async () => {
      const descriptor = "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpub6Multisig1..., [efef5678/48'/0'/0'/2']xpub6Multisig2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Multisig1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'efef5678', xpub: 'xpub6Multisig2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      // Existing devices with DIFFERENT (single-sig) derivation paths
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-1',
          userId,
          fingerprint: 'abcd1234',
          label: 'Device 1',
          xpub: 'xpub6SingleSig1...', // Different xpub (single-sig)
          derivationPath: "m/84'/0'/0'", // Single-sig path
        },
        {
          id: 'device-2',
          userId,
          fingerprint: 'efef5678',
          label: 'Device 2',
          xpub: 'xpub6SingleSig2...',
          derivationPath: "m/84'/0'/0'",
        },
      ]);

      // Mock no matching accounts
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      // Verify buildDescriptorFromDevices was called with IMPORTED paths/xpubs
      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            fingerprint: 'abcd1234',
            xpub: 'xpub6Multisig1...', // Imported xpub, not stored device xpub
            derivationPath: "m/48'/0'/0'/2'", // Imported path, not stored device path
          }),
          expect.objectContaining({
            fingerprint: 'efef5678',
            xpub: 'xpub6Multisig2...',
            derivationPath: "m/48'/0'/0'/2'",
          }),
        ]),
        expect.any(Object)
      );
    });
  });
});
