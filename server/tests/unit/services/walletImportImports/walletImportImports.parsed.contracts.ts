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

export const registerWalletImportParsedContracts = () => {
  const userId = 'user-123';

  describe('importFromParsedData', () => {
    const parsedSingleSig: ParsedDescriptor = {
      type: 'single_sig',
      scriptType: 'native_segwit',
      devices: [
        { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
      ],
      network: 'mainnet',
      isChange: false,
    };

    it('should skip wallets without descriptors and still detect duplicates', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-no-desc',
          name: 'No Descriptor',
          descriptor: null,
        },
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      await expect(
        walletImport.importFromParsedData(userId, {
          parsed: parsedSingleSig,
          name: 'Duplicate Parsed',
        })
      ).rejects.toThrow('A wallet with these devices already exists: "Existing Wallet"');
    });

    it('should ignore existing parsed wallets whose descriptors do not contain fingerprint paths', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-no-fingerprint',
          name: 'No Fingerprint Wallet',
          descriptor: 'wpkh(xpub6NoFingerprint...)',
        },
      ]);

      setupDeviceMocks([
        {
          id: 'device-parsed-no-fp',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-no-fp',
        name: 'Parsed No Fingerprint',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed No Fingerprint',
      });

      expect(result.wallet.id).toBe('wallet-parsed-no-fp');
      expect(result.devicesCreated).toBe(1);
    });

    it('should reuse existing devices and add missing account for parsed import', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-parsed',
          userId,
          type: 'ledger',
          label: 'Existing Parsed',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-legacy',
          deviceId: 'device-existing-parsed',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-reuse',
        name: 'Parsed Reuse',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Reuse',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-parsed']);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing-parsed',
            derivationPath: "m/84'/0'/0'",
          }),
        })
      );
    });

    it('should not create duplicate device account for parsed import when matching account exists', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-parsed',
          userId,
          type: 'ledger',
          label: 'Existing Parsed',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-match',
          deviceId: 'device-existing-parsed',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-match',
        name: 'Parsed Match',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockPrismaClient.deviceAccount.create.mockClear();

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Match',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should continue parsed import when address generation fails', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([
        {
          id: 'device-parsed-new',
          userId,
          type: 'unknown',
          label: 'Imported Device',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-fail',
        name: 'Parsed Fail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed for parsed import');
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Fail',
      });

      expect(result.wallet.id).toBe('wallet-parsed-fail');
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });
  });
};
