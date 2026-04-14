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

export const registerWalletImportAutoDetectContracts = () => {
  const userId = 'user-123';

  describe('importWallet (auto-detect)', () => {
    it('should auto-detect and import from descriptor', async () => {
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
        id: 'device-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-auto',
        name: 'Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: descriptor,
        name: 'Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-auto');
    });

    it('should auto-detect and import from BlueWallet text', async () => {
      const bluewalletText = `# BlueWallet Multisig setup file
Name: My Vault
Policy: 2 of 3
Format: P2WSH

aaaa1111: xpub6E1...
bbbb2222: xpub6E2...
cccc3333: xpub6E3...`;

      mockParseImportInput.mockReturnValue({
        format: 'bluewallet_text',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'cccc3333', xpub: 'xpub6E3...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 3,
        },
        suggestedName: 'My Vault',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const devices = [
        { id: 'dev1', userId, type: 'unknown', label: 'Imported Device 1', fingerprint: 'aaaa1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E1...' },
        { id: 'dev2', userId, type: 'unknown', label: 'Imported Device 2', fingerprint: 'bbbb2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E2...' },
        { id: 'dev3', userId, type: 'unknown', label: 'Imported Device 3', fingerprint: 'cccc3333', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E3...' },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-bluewallet',
        name: 'BlueWallet Import',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2..., [cccc3333/48h/0h/0h/2h]xpub6E3...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: bluewalletText,
        name: 'BlueWallet Import',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(3);
    });

    it('should auto-detect and import from Coldcard JSON', async () => {
      const coldcardJson = JSON.stringify({
        xfp: 'ABCD1234',
        chain: 'BTC',
        bip84: {
          xpub: 'xpub6D...',
          deriv: "m/84'/0'/0'",
        },
      });

      mockParseImportInput.mockReturnValue({
        format: 'coldcard',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6D...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-coldcard',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6D...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-coldcard',
        name: 'Coldcard Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6D...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: coldcardJson,
        name: 'Coldcard Import',
      });

      expect(result.wallet.id).toBe('wallet-coldcard');
    });

    it('should auto-detect and import from wallet export format', async () => {
      const walletExport = JSON.stringify({
        label: 'Exported Wallet',
        descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        blockheight: 800000,
      });

      mockParseImportInput.mockReturnValue({
        format: 'wallet_export',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
        suggestedName: 'Exported Wallet',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-export',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-export',
        name: 'Export Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: walletExport,
        name: 'Export Import',
      });

      expect(result.wallet.id).toBe('wallet-export');
    });

    it('should auto-detect and import from custom JSON config', async () => {
      const jsonConfig = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      const parsedResult = {
        type: 'single_sig' as const,
        scriptType: 'native_segwit' as ScriptType,
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      };

      mockParseImportInput.mockReturnValue({
        format: 'json',
        parsed: parsedResult,
        originalDevices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      // Also mock parseJsonImport which is called by importFromJson
      mockParseJsonImport.mockReturnValue(parsedResult);

      const device = {
        id: 'device-json-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-auto',
        name: 'JSON Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: jsonConfig,
        name: 'JSON Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-json-auto');
    });
  });
};
