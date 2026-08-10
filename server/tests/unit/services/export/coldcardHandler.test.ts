/**
 * Coldcard Export Handler Tests
 *
 * Tests for the Coldcard multisig export format handler.
 * Verifies proper formatting for Coldcard device compatibility.
 */

import { coldcardHandler } from '../../../../src/services/export/handlers/coldcard';
import { parseBlueWalletTextImport } from '../../../../src/services/bitcoin/descriptorParser';
import type { WalletExportData } from '../../../../src/services/export/types';

const TESTNET_BIP48_XPUBS = [
  'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ',
  'tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys',
] as const;

// Create mock wallet data for testing
function createMockMultisigWallet(overrides: Partial<WalletExportData> = {}): WalletExportData {
  const wallet: WalletExportData = {
    id: 'wallet-multisig-123',
    name: 'Test Multisig',
    type: 'multi_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    descriptor: 'wsh(sortedmulti(2,[abcd1234/48h/0h/0h/2h]xpub.../0/*,[efgh5678/48h/0h/0h/2h]xpub2.../0/*))',
    quorum: 2,
    totalSigners: 3,
    devices: [
      {
        label: 'Device 1',
        type: 'coldcard',
        fingerprint: 'abcd1234',
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
        derivationPath: "m/48h/0h/0h/2h",
      },
      {
        label: 'Device 2',
        type: 'coldcard',
        fingerprint: 'efgh5678',
        xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj',
        derivationPath: "m/48h/0h/0h/2h",
      },
      {
        label: 'Device 3',
        type: 'coldcard',
        fingerprint: 'ijkl9012',
        xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
        derivationPath: "m/48h/0h/0h/2h",
      },
    ],
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
  if (overrides.devices && overrides.totalSigners === undefined) {
    wallet.totalSigners = overrides.devices.length;
  }
  if (overrides.devices && overrides.quorum === undefined) {
    wallet.quorum = Math.min(2, overrides.devices.length);
  }
  return wallet;
}

function createMockSingleSigWallet(overrides: Partial<WalletExportData> = {}): WalletExportData {
  return {
    id: 'wallet-single-123',
    name: 'Test Single Sig',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub.../0/*)',
    devices: [
      {
        label: 'Device 1',
        type: 'coldcard',
        fingerprint: 'abcd1234',
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
        derivationPath: "m/84'/0'/0'",
      },
    ],
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('Coldcard Export Handler', () => {
  describe('handler metadata', () => {
    it('should have correct id and name', () => {
      expect(coldcardHandler.id).toBe('coldcard');
      expect(coldcardHandler.name).toBe('Coldcard Multisig');
    });

    it('should have .txt extension and text/plain mime type', () => {
      expect(coldcardHandler.fileExtension).toBe('.txt');
      expect(coldcardHandler.mimeType).toBe('text/plain');
    });
  });

  describe('canExport', () => {
    it('should return true for multisig wallets', () => {
      const wallet = createMockMultisigWallet();
      expect(coldcardHandler.canExport?.(wallet)).toBe(true);
      expect(coldcardHandler.canExport?.(createMockMultisigWallet({
        scriptType: 'nested_segwit',
      }))).toBe(true);
    });

    it('should return false for single-sig wallets', () => {
      const wallet = createMockSingleSigWallet();
      expect(coldcardHandler.canExport?.(wallet)).toBe(false);
    });
  });

  describe('export format', () => {
    it('should include wallet name', () => {
      const wallet = createMockMultisigWallet({ name: 'My Coldcard Vault' });
      const result = coldcardHandler.export(wallet);

      expect(result.content).toContain('Name: My Coldcard Vault');
    });

    it('should include correct policy (M of N)', () => {
      const wallet = createMockMultisigWallet({ quorum: 2, totalSigners: 3 });
      const result = coldcardHandler.export(wallet);

      expect(result.content).toContain('Policy: 2 of 3');
    });

    it('should include format based on script type', () => {
      const nativeSegwit = createMockMultisigWallet({ scriptType: 'native_segwit' });
      const nestedSegwit = createMockMultisigWallet({
        scriptType: 'nested_segwit',
        devices: createMockMultisigWallet().devices.map(device => ({
          ...device,
          derivationPath: "m/48'/0'/0'/1'",
        })),
      });
      const legacy = createMockMultisigWallet({ scriptType: 'legacy' });

      expect(coldcardHandler.export(nativeSegwit).content).toContain('Format: P2WSH');
      expect(coldcardHandler.export(nestedSegwit).content).toContain('Format: P2SH-P2WSH');
      expect(() => coldcardHandler.export(legacy)).toThrow(
        'Unsupported Coldcard multisig export policy',
      );
    });

    it('should reject unknown script types instead of defaulting to P2WSH', () => {
      const unknownScript = createMockMultisigWallet({ scriptType: 'unknown_script' as any });
      expect(() => coldcardHandler.export(unknownScript)).toThrow(
        'Unsupported Coldcard multisig export policy',
      );
    });

    it('rejects direct export of a single-sig wallet', () => {
      expect(() => coldcardHandler.export(createMockSingleSigWallet())).toThrow(
        'Coldcard export requires a multisig wallet',
      );
    });

    it.each([
      ['signer count', { totalSigners: 4 }, 'signer count or network is incomplete'],
      ['fractional quorum', { quorum: 1.5 }, 'quorum does not match'],
      ['zero quorum', { quorum: 0 }, 'quorum does not match'],
      ['excess quorum', { quorum: 4 }, 'quorum does not match'],
      ['duplicate fingerprints', {
        devices: createMockMultisigWallet().devices.map(device => ({
          ...device,
          fingerprint: 'abcd1234',
        })),
      }, 'unique signer rows'],
      ['duplicate xpubs', {
        devices: createMockMultisigWallet().devices.map(device => ({
          ...device,
          xpub: createMockMultisigWallet().devices[0].xpub,
        })),
      }, 'unique signer rows'],
    ])('rejects %s policy drift', (_case, overrides, message) => {
      expect(() => coldcardHandler.export(createMockMultisigWallet(overrides))).toThrow(message);
    });

    it('rejects mixed signer account paths after validating each path', () => {
      const devices = createMockMultisigWallet().devices.map((device, index) => ({
        ...device,
        derivationPath: index === 0 ? "m/48'/0'/0'/2'" : "m/48'/0'/1'/2'",
      }));

      expect(() => coldcardHandler.export(createMockMultisigWallet({ devices }))).toThrow(
        'signers must use the same account path',
      );
    });
  });

  describe('derivation path normalization', () => {
    it('should convert h notation to apostrophe notation', () => {
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            derivationPath: "m/48h/0h/0h/2h",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      // Should use apostrophe notation, not h notation
      expect(result.content).toContain("Derivation: m/48'/0'/0'/2'");
      expect(result.content).not.toContain("48h");
    });

    it('should preserve apostrophe notation if already present', () => {
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            derivationPath: "m/48'/0'/0'/2'",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      expect(result.content).toContain("Derivation: m/48'/0'/0'/2'");
    });

    it('should reject a missing derivation path instead of defaulting to BIP48', () => {
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            // No derivationPath provided
          },
        ],
      });

      expect(() => coldcardHandler.export(wallet)).toThrow(
        'Coldcard export signer path does not match wallet policy',
      );
    });
  });

  describe('fingerprint formatting', () => {
    it('should uppercase all fingerprints', () => {
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device 1',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            derivationPath: "m/48'/0'/0'/2'",
          },
          {
            label: 'Device 2',
            type: 'coldcard',
            fingerprint: 'efgh5678',
            xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj',
            derivationPath: "m/48'/0'/0'/2'",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      expect(result.content).toContain('ABCD1234:');
      expect(result.content).toContain('EFGH5678:');
      expect(result.content).not.toContain('abcd1234:');
      expect(result.content).not.toContain('efgh5678:');
    });
  });

  describe('xpub normalization', () => {
    it('should convert Zpub to standard xpub format', () => {
      // Known Zpub that converts to an xpub
      const zpub = 'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: zpub,
            derivationPath: "m/48'/0'/0'/2'",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      // Should start with xpub, not Zpub
      expect(result.content).toMatch(/ABCD1234: xpub/);
      expect(result.content).not.toContain('Zpub');
    });

    it('should keep standard xpub unchanged', () => {
      const xpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
      const wallet = createMockMultisigWallet({
        devices: [
          {
            label: 'Device',
            type: 'coldcard',
            fingerprint: 'abcd1234',
            xpub: xpub,
            derivationPath: "m/48'/0'/0'/2'",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      expect(result.content).toContain(`ABCD1234: ${xpub}`);
    });

    it('round-trips testnet exports without rewriting tpubs to mainnet', () => {
      const wallet = createMockMultisigWallet({
        network: 'testnet',
        devices: TESTNET_BIP48_XPUBS.map((xpub, index) => ({
          label: `Device ${index + 1}`,
          type: 'coldcard',
          fingerprint: index === 0 ? '11111111' : '22222222',
          xpub,
          derivationPath: "m/48'/1'/0'/2'",
        })),
      });

      const result = coldcardHandler.export(wallet);
      const parsed = parseBlueWalletTextImport(result.content);

      expect(result.content).not.toContain('xpub');
      expect(parsed.network).toBe('testnet');
      expect(parsed.devices.map(device => device.xpub)).toEqual(TESTNET_BIP48_XPUBS);
    });
  });

  describe('filename generation', () => {
    it('should use custom filename if provided', () => {
      const wallet = createMockMultisigWallet({ name: 'Test Wallet' });
      const result = coldcardHandler.export(wallet, { filename: 'my_custom_export' });

      expect(result.filename).toBe('my_custom_export.txt');
    });

    it('should generate filename from wallet name if no custom filename', () => {
      const wallet = createMockMultisigWallet({ name: 'My Test Wallet!' });
      const result = coldcardHandler.export(wallet);

      // Special characters should be replaced with underscores
      expect(result.filename).toBe('My_Test_Wallet__coldcard.txt');
    });
  });

  describe('export result metadata', () => {
    it('should return correct mime type and encoding', () => {
      const wallet = createMockMultisigWallet();
      const result = coldcardHandler.export(wallet);

      expect(result.mimeType).toBe('text/plain');
      expect(result.encoding).toBe('utf-8');
    });
  });

  describe('complete export format', () => {
    it('should produce correctly formatted output', () => {
      const wallet = createMockMultisigWallet({
        name: 'TestVault',
        quorum: 2,
        totalSigners: 2,
        scriptType: 'native_segwit',
        devices: [
          {
            label: 'Device 1',
            type: 'coldcard',
            fingerprint: 'aaaaaaaa',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            derivationPath: "m/48h/0h/0h/2h",
          },
          {
            label: 'Device 2',
            type: 'coldcard',
            fingerprint: 'bbbbbbbb',
            xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj',
            derivationPath: "m/48h/0h/0h/2h",
          },
        ],
      });

      const result = coldcardHandler.export(wallet);

      // Verify the overall structure
      const lines = result.content.split('\n');
      expect(lines[0]).toBe('Name: TestVault');
      expect(lines[1]).toBe('Policy: 2 of 2');
      expect(lines[2]).toBe('Sorted: true');
      expect(lines[3]).toBe("Derivation: m/48'/0'/0'/2'");
      expect(lines[4]).toBe('Format: P2WSH');
      expect(lines[5]).toBe(''); // Empty line before cosigners
      expect(lines[6]).toMatch(/^AAAAAAAA: xpub/);
      expect(lines[7]).toMatch(/^BBBBBBBB: xpub/);
    });
  });
});
