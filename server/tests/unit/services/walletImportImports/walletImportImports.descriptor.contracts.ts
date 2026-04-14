import { describe, expect, it } from 'vitest';
import {
  mockParseImportInput,
  mockParseJsonImport,
  mockDeriveAddressFromDescriptor,
  mockBuildDescriptorFromDevices,
  setupDeviceMocks,
} from '../walletImport.setup';
import { mockPrismaClient } from '../../../mocks/prisma';
import * as walletImport from '../../../../src/services/walletImport';
import type { ParsedDescriptor, Network, ScriptType } from '../../../../src/services/bitcoin/descriptorParser';

export const registerWalletImportDescriptorContracts = () => {
  const userId = 'user-123';

  describe('importFromDescriptor', () => {
    it('should import single-sig wallet from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'abcd1234',
              xpub: 'xpub6Dz...',
              derivationPath: "m/84'/0'/0'",
            },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const createdDevice = {
        id: 'device-new-001',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      // Setup mocks
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([createdDevice]);

      // Mock wallet creation
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

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      expect(result.wallet.id).toBe('wallet-001');
      expect(result.wallet.name).toBe('Test Wallet');
      expect(result.wallet.type).toBe('single_sig');
      expect(result.devicesCreated).toBe(1);
      expect(result.devicesReused).toBe(0);
      expect(result.createdDeviceIds).toEqual(['device-new-001']);

      // Verify wallet was created
      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'mainnet',
          }),
        })
      );

      // Verify addresses were generated (20 receive + 20 change)
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ address: expect.stringContaining('receive') }),
            expect.objectContaining({ address: expect.stringContaining('change') }),
          ]),
        })
      );
    });

    it('should import multisig wallet from descriptor', async () => {
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
          label: 'Imported Device 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks(devices);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-001',
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Vault',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.wallet.totalSigners).toBe(2);
      expect(result.devicesCreated).toBe(2);
      expect(result.devicesReused).toBe(0);
    });

    it('should reuse existing device when fingerprint matches', async () => {
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

      // Mock existing device with matching fingerprint
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-001',
          userId,
          fingerprint: 'abcd1234',
          label: 'Existing Ledger',
          xpub: 'xpub6Dz...',
          derivationPath: "m/84'/0'/0'",
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-002',
        name: 'Test Wallet',
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
        name: 'Test Wallet',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-001']);
      expect(mockPrismaClient.device.create).not.toHaveBeenCalled();
    });

    it('should use custom device labels when provided', async () => {
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
        id: 'device-003',
        userId,
        type: 'unknown',
        label: 'My Custom Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-003',
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
        deviceLabels: {
          abcd1234: 'My Custom Ledger',
        },
      });

      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'My Custom Ledger',
          }),
        })
      );
    });

    it('should ignore wallets without fingerprint matches during duplicate checks', async () => {
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

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-null',
          name: 'Null Descriptor Wallet',
          descriptor: null,
        },
        {
          id: 'wallet-no-fp',
          name: 'Descriptor Without Fingerprints',
          descriptor: 'wpkh(xpub6NoFingerprint...)',
        },
      ]);
      setupDeviceMocks([
        {
          id: 'device-non-dup',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-non-dup',
        name: 'Non Duplicate',
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
        name: 'Non Duplicate',
      });

      expect(result.wallet.id).toBe('wallet-non-dup');
      expect(result.devicesCreated).toBe(1);
    });

    it('should detect duplicate wallet by device fingerprints', async () => {
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


      // Mock existing wallet with same device fingerprint
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      await expect(
        walletImport.importFromDescriptor(userId, {
          descriptor,
          name: 'Duplicate Wallet',
        })
      ).rejects.toThrow('A wallet with these devices already exists: "Existing Wallet"');
    });

    it('should allow same device in different wallet configurations', async () => {
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


      // Mock existing wallet with only one of the devices (different configuration)
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-single',
          name: 'Single Sig Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'efef5678',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[abcd1234/48h/0h/0h/2h]xpub6E1..., [efef5678/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      expect(result.wallet.id).toBe('wallet-multisig');
      expect(result.devicesCreated).toBe(2);
    });

    it('should override network if specified', async () => {
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
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
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
        descriptor: 'wpkh([abcd1234/84h/1h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
        network: 'testnet',
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
};
