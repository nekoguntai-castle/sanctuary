import { describe, expect, it } from 'vitest';
import { bluewalletHandler } from '../../../../src/services/export/handlers/bluewallet';
import { descriptorHandler } from '../../../../src/services/export/handlers/descriptor';
import { sparrowHandler } from '../../../../src/services/export/handlers/sparrow';
import type { WalletExportData } from '../../../../src/services/export/types';

describe('export format handlers', () => {
  const baseSingleSig: WalletExportData = {
    id: 'wallet-1',
    name: 'My Wallet',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'testnet',
    descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub.../0/*)',
    devices: [
      {
        label: 'Device A',
        type: 'ledger_nano_x',
        fingerprint: 'abcd1234',
        xpub: 'tpub-device-a',
        derivationPath: "m/84'/1'/0'",
      },
    ],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  const baseMultiSig: WalletExportData = {
    id: 'wallet-2',
    name: 'Team Vault',
    type: 'multi_sig',
    scriptType: 'nested_segwit',
    network: 'mainnet',
    descriptor: 'sh(wsh(sortedmulti(2,[abcd1234/48h/0h/0h/1h]xpub1/0/*,[efef5678/48h/0h/0h/1h]xpub2/0/*)))',
    changeDescriptor: 'sh(wsh(sortedmulti(2,[abcd1234/48h/0h/0h/1h]xpub1/1/*,[efef5678/48h/0h/0h/1h]xpub2/1/*)))',
    quorum: 2,
    totalSigners: 2,
    devices: [
      {
        label: 'Ledger X',
        type: 'Ledger Nano X',
        fingerprint: 'abcd1234',
        xpub: 'xpub-ledger',
        derivationPath: "m/48'/0'/0'/1'",
      },
      {
        label: 'Unknown Box',
        type: 'mystery-device',
        fingerprint: 'efef5678',
        xpub: 'xpub-unknown',
        derivationPath: "m/48'/0'/0'/1'",
      },
    ],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  describe('bluewalletHandler', () => {
    it('always supports export', () => {
      expect(bluewalletHandler.canExport!(baseSingleSig)).toBe(true);
      expect(bluewalletHandler.canExport!(baseMultiSig)).toBe(true);
    });

    it('exports single-sig wallet content and default filename', () => {
      const result = bluewalletHandler.export(baseSingleSig);

      expect(result.mimeType).toBe('text/plain');
      expect(result.filename).toBe('My_Wallet_bluewallet.txt');
      expect(result.content).toContain('Name: My Wallet');
      expect(result.content).toContain('Policy: 1 of 1');
      expect(result.content).toContain('Format: P2WPKH');
      expect(result.content).toContain("Derivation: m/84'/1'/0'");
      expect(result.content).toContain('abcd1234: tpub-device-a');
    });

    it('rejects an unknown multisig script instead of defaulting to P2WSH', () => {
      const unknownScript = { ...baseMultiSig, scriptType: 'unknown_script' as any };
      expect(() => bluewalletHandler.export(unknownScript, { filename: 'team-export' })).toThrow(
        'Unsupported BlueWallet multisig export policy',
      );
    });

    it('rejects an unknown single-sig script instead of defaulting to P2WPKH', () => {
      const wallet = { ...baseSingleSig, scriptType: 'unknown_script' as any };
      expect(() => bluewalletHandler.export(wallet)).toThrow(
        'Unsupported BlueWallet single-sig export policy',
      );
    });

    it('exports the complete multisig policy with a custom filename', () => {
      const result = bluewalletHandler.export(baseMultiSig, { filename: 'team-backup' });

      expect(result.filename).toBe('team-backup.txt');
      expect(result.content).toContain('Policy: 2 of 2');
      expect(result.content).toContain('Sorted: true');
      expect(result.content).toContain('Format: P2SH-P2WSH');
    });

    it.each([
      ['unknown wallet type', { type: 'unknown' as any }, 'Unsupported BlueWallet wallet type'],
      ['single-sig signer count', { devices: [] }, 'signer count'],
      ['multisig signer count', { totalSigners: 3 }, 'signer count'],
      ['fractional quorum', { quorum: 1.5 }, 'quorum'],
      ['zero quorum', { quorum: 0 }, 'quorum'],
      ['excess quorum', { quorum: 3 }, 'quorum'],
      ['duplicate fingerprints', {
        devices: baseMultiSig.devices.map((device) => ({ ...device, fingerprint: 'abcd1234' })),
      }, 'unique signer rows'],
      ['duplicate xpubs', {
        devices: baseMultiSig.devices.map((device) => ({ ...device, xpub: 'xpub-duplicate' })),
      }, 'unique signer rows'],
      ['mainnet signer path', {
        devices: baseMultiSig.devices.map((device) => ({
          ...device,
          derivationPath: "m/48'/1'/0'/1'",
        })),
      }, 'signer path'],
    ])('rejects %s policy drift', (_case, overrides, message) => {
      const base = _case === 'single-sig signer count' ? baseSingleSig : baseMultiSig;
      expect(() => bluewalletHandler.export({ ...base, ...overrides })).toThrow(message);
    });
  });

  describe('descriptorHandler', () => {
    it('exports descriptor with optional change and device metadata', () => {
      const result = descriptorHandler.export(baseMultiSig, {
        includeChangeDescriptor: true,
        includeDevices: true,
        filename: 'descriptor-export',
      });

      expect(result.mimeType).toBe('text/plain');
      expect(result.filename).toBe('descriptor-export.txt');
      expect(result.content).toContain('# Wallet: Team Vault');
      expect(result.content).toContain('# Type: 2-of-2 Multisig');
      expect(result.content).toContain('# Change Descriptor (internal chain)');
      expect(result.content).toContain(baseMultiSig.changeDescriptor!);
      expect(result.content).toContain('# Device Information');
      expect(result.content).toContain('# - Ledger X (abcd1234)');
      expect(result.content).toContain("#   Derivation: m/48'/0'/0'/1'");
      expect(result.content).toContain('#   XPub: xpub-ledger');
      expect(result.content).toMatch(/# Exported: \d{4}-\d{2}-\d{2}T/);
    });

    it('exports minimal descriptor content and sanitized default filename', () => {
      const wallet = { ...baseSingleSig, name: 'Wallet:One' };
      const result = descriptorHandler.export(wallet);

      expect(result.filename).toBe('Wallet_One_descriptor.txt');
      expect(result.content).toContain('# Receive Descriptor (external chain)');
      expect(result.content).not.toContain('# Change Descriptor (internal chain)');
      expect(result.content).not.toContain('# Device Information');
    });

    it('omits empty device derivation metadata instead of inventing a path', () => {
      const wallet = {
        ...baseSingleSig,
        devices: [{ ...baseSingleSig.devices[0], derivationPath: '' }],
      };

      expect(descriptorHandler.export(wallet, { includeDevices: true }).content)
        .not.toContain('#   Derivation:');
    });
  });

  describe('sparrowHandler', () => {
    it('exports multisig JSON with mapped script/device types and optional metadata', () => {
      const result = sparrowHandler.export(baseMultiSig, {
        includeChangeDescriptor: true,
        filename: 'sparrow-export',
        metadata: { note: 'team backup' },
      });

      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toBe('sparrow-export.json');

      const parsed = JSON.parse(result.content);
      expect(parsed.label).toBe('Team Vault');
      expect(parsed.policy).toEqual({ type: 'MULTI', numSigners: 2, threshold: 2 });
      expect(parsed.scriptType).toBe('P2SH_P2WSH');
      expect(parsed.changeDescriptor).toBe(baseMultiSig.changeDescriptor);
      expect(parsed.note).toBe('team backup');
      expect(parsed.keystores).toHaveLength(2);
      expect(parsed.keystores[0]).toMatchObject({
        walletModel: 'LEDGER_NANO_X',
        derivation: "m/48'/0'/0'/1'",
      });
      expect(parsed.keystores[1]).toMatchObject({
        walletModel: 'COLDCARD',
        derivation: "m/48'/0'/0'/1'",
      });
    });

    it('uses the catalog model slug before broad device type for Ledger Gen 5 exports', () => {
      const wallet: WalletExportData = {
        ...baseSingleSig,
        devices: [
          {
            ...baseSingleSig.devices[0],
            type: 'Ledger',
            modelSlug: 'ledger-gen-5',
            modelName: 'Ledger Gen 5',
          },
        ],
      };

      const result = sparrowHandler.export(wallet);
      const parsed = JSON.parse(result.content);

      expect(parsed.keystores[0]).toMatchObject({
        walletModel: 'LEDGER_NANO_GEN5',
      });
    });

    it('uses multisig fallback script type for unknown multisig script types', () => {
      const wallet = { ...baseMultiSig, scriptType: 'unknown_script' as any };
      const result = sparrowHandler.export(wallet);
      const parsed = JSON.parse(result.content);

      expect(parsed.scriptType).toBe('P2WSH');
    });

    it('exports single-sig JSON with fallback script type and default filename', () => {
      const wallet = {
        ...baseSingleSig,
        name: 'Wallet One',
        scriptType: 'unknown_script' as any,
      };

      const result = sparrowHandler.export(wallet);
      const parsed = JSON.parse(result.content);

      expect(result.filename).toBe('Wallet_One_sparrow.json');
      expect(parsed.policy).toEqual({ type: 'SINGLE' });
      expect(parsed.scriptType).toBe('P2WPKH');
      expect(parsed.descriptor).toBe(wallet.descriptor);
    });

    it('serializes a missing device path as an empty Sparrow derivation', () => {
      const wallet = {
        ...baseSingleSig,
        devices: [{ ...baseSingleSig.devices[0], derivationPath: undefined }],
      } as unknown as WalletExportData;

      const parsed = JSON.parse(sparrowHandler.export(wallet).content);
      expect(parsed.keystores[0].masterFingerprint).toBe('abcd1234');
      expect(parsed.keystores[0].derivation).toBe('');
    });
  });
});
