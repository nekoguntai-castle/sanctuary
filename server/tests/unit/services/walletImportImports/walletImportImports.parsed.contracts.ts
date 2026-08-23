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
          type: 'coldcard',
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
          type: 'coldcard',
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
      expect(mockPrismaClient.walletDevice.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          walletId: 'wallet-parsed-match',
          deviceId: 'device-existing-parsed',
          deviceAccountId: 'acct-match',
          signerIndex: 0,
          signerBindingVersion: 1,
          signerFingerprint: 'abcd1234',
          signerXpub: 'xpub6Dz...',
          signerDerivationPath: "m/84'/0'/0'",
          signerPurpose: 'single_sig',
          signerScriptType: 'native_segwit',
        })],
      });
    });

    it('rejects a reused account path whose identity differs from the import', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([{
        id: 'device-existing-parsed',
        userId,
        type: 'coldcard',
        label: 'Existing Parsed',
        fingerprint: 'abcd1234',
      }]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([{
        id: 'acct-conflict',
        deviceId: 'device-existing-parsed',
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub-different',
      }]);

      await expect(walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Conflict',
      })).rejects.toThrow('does not exactly match the imported signer');

      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
    });

    it.each([
      [
        'one exact and one conflicting normalized alias',
        [
          { id: 'acct-exact', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub6Dz...' },
          { id: 'acct-conflict', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: 'm/84h/0h/0h', xpub: 'xpub-other' },
        ],
      ],
      [
        'two exact normalized aliases',
        [
          { id: 'acct-prime', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub6Dz...' },
          { id: 'acct-h', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: 'm/84h/0h/0h', xpub: 'xpub6Dz...' },
        ],
      ],
    ])('rejects %s instead of selecting by query order', async (_case, accounts) => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([{
        id: 'device-existing-parsed',
        userId,
        type: 'coldcard',
        label: 'Existing Parsed',
        fingerprint: 'abcd1234',
      }]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue(accounts.map((account) => ({
        ...account,
        deviceId: 'device-existing-parsed',
      })));

      await expect(walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Ambiguous Parsed Account',
      })).rejects.toThrow("account path m/84'/0'/0' is ambiguous");
      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['BIP48 suffix inconsistent with native multisig', {
        type: 'multi_sig' as const,
        scriptType: 'native_segwit' as const,
        derivationPath: "m/48'/0'/0'/1'",
      }],
      ['script metadata inconsistent with the derivation purpose', {
        type: 'single_sig' as const,
        scriptType: 'taproot' as const,
        derivationPath: "m/84'/0'/0'",
      }],
    ])('rejects imported %s', async (_case, policy) => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([{
        id: 'device-invalid-policy',
        userId,
        type: 'unknown',
        label: 'Invalid Policy Device',
        fingerprint: 'abcd1234',
        derivationPath: policy.derivationPath,
        xpub: 'xpub6Dz...',
      }]);

      await expect(walletImport.importFromParsedData(userId, {
        parsed: {
          type: policy.type,
          scriptType: policy.scriptType,
          devices: [{
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: policy.derivationPath,
          }],
          network: 'mainnet',
          isChange: false,
          quorum: policy.type === 'multi_sig' ? 1 : undefined,
          totalSigners: policy.type === 'multi_sig' ? 1 : undefined,
        },
        name: 'Invalid Policy Import',
      })).rejects.toThrow();
      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['wrong single-sig purpose', "m/49'/0'/0'"],
      ['wrong mainnet coin type', "m/84'/1'/0'"],
      ['account index above the BIP32 maximum', "m/84'/0'/2147483648'"],
      ['non-account-level path', "m/84'/0'/0'/0"],
      ['multisig path in single-sig policy', "m/48'/0'/0'/2'"],
    ])('rejects immutable signer snapshots with %s', async (_case, derivationPath) => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([{
        id: 'device-invalid-path',
        userId,
        type: 'unknown',
        label: 'Invalid Path Device',
        fingerprint: 'abcd1234',
        derivationPath,
        xpub: 'xpub6Dz...',
      }]);

      await expect(walletImport.importFromParsedData(userId, {
        parsed: {
          ...parsedSingleSig,
          devices: [{ ...parsedSingleSig.devices[0], derivationPath }],
        },
        name: 'Invalid Path Import',
      })).rejects.toThrow();
      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
    });

    it('rejects parsed import before persistence when address generation fails', async () => {
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

      await expect(walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Fail',
      })).rejects.toThrow('Address derivation failed for parsed import');

      expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.address.createManyAndReturn).not.toHaveBeenCalled();
    });
  });
};
