import { describe, expect, it } from 'vitest';
import {
  mockParseImportInput,
  mockParseJsonImport,
  mockDeriveAddressFromDescriptor,
  mockBuildDescriptorFromDevices,
  setupDeviceMocks,
  mockCurrentDeviceRole,
} from '../walletImport.setup';
import { ConflictError } from '../../../../src/errors/ApiError';
import { mockPrismaClient } from '../../../mocks/prisma';
import * as walletImport from '../../../../src/services/walletImport';
import type { ParsedDescriptor, Network, ScriptType } from '../../../../src/services/bitcoin/descriptorParser';

export const registerWalletImportJsonContracts = () => {
  const userId = 'user-123';

  describe('importFromJson', () => {
    // Non-regression: JSON imports skipped the duplicate check that descriptor and
    // parsed imports run, so the same wallet could be imported twice this way.
    it('rejects a JSON import that duplicates an existing wallet', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          { type: 'coldcard', label: 'Coldcard', fingerprint: 'abcd1234', derivationPath: "m/84'/0'/0'", xpub: 'xpub6Dz...' },
        ],
      };
      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          scriptType: 'native_segwit',
          descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz.../<0;1>/*)',
        },
      ]);

      await expect(
        walletImport.importFromJson(userId, { json: JSON.stringify(jsonConfig), name: 'Duplicate JSON' }),
      ).rejects.toSatisfy((error: unknown) =>
        error instanceof ConflictError
        && error.statusCode === 409
        && error.message === 'A wallet with these devices already exists: "Existing Wallet"');
      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.device.create).not.toHaveBeenCalled();
    });

    it('should import wallet from JSON configuration', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'coldcard',
            label: 'My Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });


      const device = {
        id: 'device-json-001',
        userId,
        type: 'coldcard',
        label: 'My Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-001',
        name: 'JSON Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Wallet',
      });

      expect(result.wallet.id).toBe('wallet-json-001');
      expect(result.devicesCreated).toBe(1);

      // Verify device was created with proper type and label
      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'coldcard',
            label: 'My Ledger',
          }),
        })
      );
    });

    it('should handle multisig JSON configuration', async () => {
      const jsonConfig = {
        type: 'multi_sig',
        scriptType: 'native_segwit',
        quorum: 2,
        network: 'mainnet',
        devices: [
          {
            type: 'coldcard',
            label: 'Trezor 1',
            fingerprint: 'aaaa1111',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E1...',
          },
          {
            type: 'coldcard',
            label: 'Ledger 1',
            fingerprint: 'bbbb2222',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E2...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
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
      });


      const devices = [
        {
          id: 'device-trezor',
          userId,
          type: 'coldcard',
          label: 'Trezor 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-ledger',
          userId,
          type: 'coldcard',
          label: 'Ledger 1',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-json',
        name: 'JSON Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Multisig',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(2);
    });

    it('should throw on invalid JSON', async () => {
      await expect(
        walletImport.importFromJson(userId, {
          json: 'not valid json {{{',
          name: 'Invalid',
        })
      ).rejects.toThrow();
    });

    it('should throw validation error for schema-invalid JSON payloads', async () => {
      await expect(
        walletImport.importFromJson(userId, {
          json: JSON.stringify({}),
          name: 'Invalid Schema',
        })
      ).rejects.toThrow();
      expect(mockParseJsonImport).not.toHaveBeenCalled();
    });

    it('should reuse existing json-imported device and add missing account path', async () => {
      mockCurrentDeviceRole('owner');
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'coldcard',
            label: 'Existing Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-json',
          userId,
          type: 'coldcard',
          label: 'Existing Ledger',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-existing',
          deviceId: 'device-existing-json',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-reuse',
        name: 'JSON Reuse',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Reuse',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-json']);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing-json',
            derivationPath: "m/84'/0'/0'",
          }),
        })
      );
    });

    it('should not create duplicate account for reused json-imported devices', async () => {
      mockCurrentDeviceRole('owner');
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'coldcard',
            label: 'Existing Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-json',
          userId,
          type: 'coldcard',
          label: 'Existing Ledger',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-existing',
          deviceId: 'device-existing-json',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-reuse-match',
        name: 'JSON Reuse Match',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockPrismaClient.deviceAccount.create.mockClear();

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Reuse Match',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('rejects importFromJson before persistence when initial address generation fails', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'coldcard',
            label: 'My Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      const device = {
        id: 'device-json-fail',
        userId,
        type: 'coldcard',
        label: 'My Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-fail',
        name: 'JSON Wallet Fail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed for json import');
      });

      await expect(walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Wallet Fail',
      })).rejects.toThrow('Address derivation failed for json import');

      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.address.createManyAndReturn).not.toHaveBeenCalled();
    });
  });
};
