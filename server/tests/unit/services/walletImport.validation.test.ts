import { vi } from 'vitest';
import './walletImport.setup';  // side effects: vi.mock calls
import {
  mockParseImportInput,
  setupBeforeEach,
} from './walletImport.setup';
import { mockPrismaClient } from '../../mocks/prisma';
import * as walletImport from '../../../src/services/walletImport';
import type { Network } from '../../../src/services/bitcoin/descriptorParser';

describe('Wallet Import Service - Validation', () => {
  const userId = 'user-123';

  beforeEach(() => {
    setupBeforeEach();
  });

  describe('validateImport', () => {
    describe('Descriptor Import Validation', () => {
      it('should validate wpkh (native segwit) descriptor', async () => {
        const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz8PGZuAKKWdmNnKVVR3fFKPxPNaPXpNLhU6fKwC3Qh9U8jv7r5w2ZQRX1tYkGdBN35p1HsLPZxwUJp9L8yN4tVd4rPqvKtJ5mFYA9VqG6/0/*)#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6Dz8PGZuAKKWdmNnKVVR3fFKPxPNaPXpNLhU6fKwC3Qh9U8jv7r5w2ZQRX1tYkGdBN35p1HsLPZxwUJp9L8yN4tVd4rPqvKtJ5mFYA9VqG6',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('descriptor');
        expect(result.walletType).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.network).toBe('mainnet');
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('abcd1234');
        expect(result.devices[0].willCreate).toBe(true);
      });

      it('should validate wsh multisig descriptor', async () => {
        const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'multi_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'aaaa1111',
                xpub: 'xpub6E1...',
                derivationPath: "m/48'/0'/0'/2'",
              },
              {
                fingerprint: 'bbbb2222',
                xpub: 'xpub6E2...',
                derivationPath: "m/48'/0'/0'/2'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
            quorum: 2,
            totalSigners: 2,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.walletType).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
        expect(result.devices).toHaveLength(2);
      });

      it('should validate taproot (tr) descriptor', async () => {
        const descriptor = "tr([abcd1234/86'/0'/0']xpub6T...)#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'taproot',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6T...',
                derivationPath: "m/86'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.scriptType).toBe('taproot');
      });

      it('should validate nested segwit (sh(wpkh)) descriptor', async () => {
        const descriptor = "sh(wpkh([abcd1234/49'/0'/0']xpub6N...))#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'nested_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6N...',
                derivationPath: "m/49'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.scriptType).toBe('nested_segwit');
      });

      it('should detect existing devices by fingerprint', async () => {
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

        // Mock existing device with matching fingerprint
        mockPrismaClient.device.findMany.mockResolvedValue([
          {
            id: 'device-001',
            fingerprint: 'abcd1234',
            label: 'Existing Ledger',
            xpub: 'xpub6Dz...',
          },
        ]);

        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].willCreate).toBe(false);
        expect(result.devices[0].existingDeviceId).toBe('device-001');
        expect(result.devices[0].existingDeviceLabel).toBe('Existing Ledger');
      });

      it('should reject invalid descriptor', async () => {
        const descriptor = "invalid descriptor format";

        mockParseImportInput.mockImplementation(() => {
          throw new Error('Unable to detect script type from descriptor');
        });

        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Unable to detect script type from descriptor');
      });

      it('should return json format when json input parsing fails', async () => {
        mockParseImportInput.mockImplementation(() => {
          throw new Error('Invalid JSON import payload');
        });

        const result = await walletImport.validateImport(userId, {
          json: '{"type":"single_sig","devices":[]}',
        });

        expect(result.valid).toBe(false);
        expect(result.format).toBe('json');
        expect(result.error).toBe('Invalid JSON import payload');
      });

      it('should handle missing input', async () => {
        const result = await walletImport.validateImport(userId, {});

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Either descriptor or json must be provided');
      });
    });

    describe('BlueWallet Format Import Validation', () => {
      it('should validate BlueWallet multisig text format', async () => {
        const bluewalletText = `# BlueWallet Multisig setup file
Name: My 2-of-3 Vault
Policy: 2 of 3
Derivation: m/48'/0'/0'/2'
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
          suggestedName: 'My 2-of-3 Vault',
        });


        const result = await walletImport.validateImport(userId, { json: bluewalletText });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('bluewallet_text');
        expect(result.walletType).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(3);
        expect(result.suggestedName).toBe('My 2-of-3 Vault');
      });
    });

    describe('Coldcard JSON Import Validation', () => {
      it('should validate Coldcard JSON export', async () => {
        const coldcardJson = JSON.stringify({
          xfp: 'ABCD1234',
          chain: 'BTC',
          bip84: {
            xpub: 'xpub6D...',
            deriv: "m/84'/0'/0'",
            name: 'Native Segwit',
          },
          bip49: {
            xpub: 'xpub6N...',
            deriv: "m/49'/0'/0'",
            name: 'Nested Segwit',
          },
          bip44: {
            xpub: 'xpub6L...',
            deriv: "m/44'/0'/0'",
            name: 'Legacy',
          },
        });

        mockParseImportInput.mockReturnValue({
          format: 'coldcard',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6D...',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          availablePaths: [
            { scriptType: 'native_segwit', path: "m/84'/0'/0'" },
            { scriptType: 'nested_segwit', path: "m/49'/0'/0'" },
            { scriptType: 'legacy', path: "m/44'/0'/0'" },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: coldcardJson });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('coldcard');
        expect(result.scriptType).toBe('native_segwit');
      });
    });

    describe('Sanctuary Export Import Validation', () => {
      it('should validate Sanctuary wallet export format', async () => {
        const sanctuaryExport = JSON.stringify({
          label: 'My Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum",
          blockheight: 800000,
        });

        mockParseImportInput.mockReturnValue({
          format: 'wallet_export',
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
          suggestedName: 'My Wallet',
        });


        const result = await walletImport.validateImport(userId, { json: sanctuaryExport });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('wallet_export');
        expect(result.suggestedName).toBe('My Wallet');
      });
    });

    describe('JSON Configuration Import Validation', () => {
      it('should validate custom JSON configuration', async () => {
        const jsonConfig = JSON.stringify({
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'abcd1234',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6Dz...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
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
          originalDevices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'abcd1234',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6Dz...',
            },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('json');
        expect(result.devices[0].suggestedLabel).toBe('My Ledger');
        expect(result.devices[0].originalType).toBe('ledger');
      });

      it('should generate unique labels for duplicate device names', async () => {
        const jsonConfig = JSON.stringify({
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'aaaa1111',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E1...',
            },
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'bbbb2222',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E2...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
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
          originalDevices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'aaaa1111',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E1...',
            },
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'bbbb2222',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E2...',
            },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.devices).toHaveLength(2);
        expect(result.devices[0].suggestedLabel).toBe('Trezor');
        expect(result.devices[1].suggestedLabel).toBe('Trezor (2)');
      });

      it('should keep incrementing label suffix until an unused value is found', async () => {
        const jsonConfig = JSON.stringify({
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'cccc3333',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E3...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              { fingerprint: 'cccc3333', xpub: 'xpub6E3...', derivationPath: "m/84'/0'/0'" },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          originalDevices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'cccc3333',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E3...',
            },
          ],
        });

        mockPrismaClient.device.findMany.mockResolvedValue([
          {
            id: 'existing-1',
            fingerprint: 'aaaa1111',
            label: 'Trezor',
            xpub: 'xpub-existing-1',
          },
          {
            id: 'existing-2',
            fingerprint: 'bbbb2222',
            label: 'Trezor (2)',
            xpub: 'xpub-existing-2',
          },
        ]);

        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.devices[0].suggestedLabel).toBe('Trezor (3)');
      });

      it('should avoid conflicts with existing device labels', async () => {
        const jsonConfig = JSON.stringify({
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'aaaa1111',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E1...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/84'/0'/0'" },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          originalDevices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'aaaa1111',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E1...',
            },
          ],
        });

        // Mock existing device with same label but different fingerprint
        mockPrismaClient.device.findMany.mockResolvedValue([
          {
            id: 'device-001',
            fingerprint: 'bbbb2222',
            label: 'My Ledger',
            xpub: 'xpub6Different...',
          },
        ]);

        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.devices[0].suggestedLabel).toBe('My Ledger (2)');
      });
    });
  });
});
