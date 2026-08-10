import { describe, expect, it } from 'vitest';
import { legacyHandler } from '../../../../src/services/scriptTypes/handlers/legacy';
import { nativeSegwitHandler } from '../../../../src/services/scriptTypes/handlers/nativeSegwit';
import { nestedSegwitHandler } from '../../../../src/services/scriptTypes/handlers/nestedSegwit';
import { taprootHandler } from '../../../../src/services/scriptTypes/handlers/taproot';
import { wrapWalletPolicyDescriptor } from '../../../../src/services/scriptTypes/handlers/descriptorHelpers';

describe('script type handlers', () => {
  const devices = [
    { fingerprint: 'aabbccdd', xpub: 'xpub-device-1' },
    { fingerprint: 'eeff0011', xpub: 'xpub-device-2', derivationPath: "m/48'/1'/7'/9'" },
  ];

  it('rejects an unsupported wallet policy at the shared wrapper boundary', () => {
    expect(() => wrapWalletPolicyDescriptor(
      'unknown' as never,
      'unknown' as never,
      'key',
    )).toThrow('Unsupported wallet policy');
  });

  describe('legacyHandler', () => {
    it('builds expected derivation paths', () => {
      expect(legacyHandler.getDerivationPath('mainnet')).toBe("m/44'/0'/0'");
      expect(legacyHandler.getDerivationPath('testnet', 2)).toBe("m/44'/1'/2'");
      expect(() => legacyHandler.getDerivationPath('unknown' as never)).toThrow(
        'Unknown Bitcoin network: unknown',
      );
      expect(() => legacyHandler.getMultisigDerivationPath('mainnet')).toThrow();
      expect(legacyHandler.supportsMultisig).toBe(false);
    });

    it('builds single-sig descriptors and exposes no multisig builder', () => {
      expect(
        legacyHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single' },
          { network: 'testnet', change: true }
        )
      ).toBe('pkh([aabbccdd/44h/1h/0h]xpub-single/1/*)');

      expect(
        legacyHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single' },
          { network: 'mainnet', change: false }
        )
      ).toContain('/0/*)');

      expect(legacyHandler.buildMultiSigDescriptor).toBeUndefined();
    });

    it('validates aliases case-insensitively', () => {
      expect(legacyHandler.validateDevice!(['P2PKH'])).toBe(true);
      expect(legacyHandler.validateDevice!(['unknown'])).toBe(false);
    });
  });

  describe('nativeSegwitHandler', () => {
    it('builds expected derivation paths', () => {
      expect(nativeSegwitHandler.getDerivationPath('mainnet')).toBe("m/84'/0'/0'");
      expect(nativeSegwitHandler.getDerivationPath('testnet', 5)).toBe("m/84'/1'/5'");
      expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet')).toBe("m/48'/0'/0'/2'");
      expect(nativeSegwitHandler.getMultisigDerivationPath('testnet', 4)).toBe("m/48'/1'/4'/2'");
    });

    it('builds single-sig and multi-sig descriptors', () => {
      expect(
        nativeSegwitHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single', derivationPath: "m/84'/1'/9'" },
          { network: 'testnet' }
        )
      ).toBe('wpkh([aabbccdd/84h/1h/9h]xpub-single/0/*)');

      expect(
        nativeSegwitHandler.buildMultiSigDescriptor!(devices, { network: 'mainnet', quorum: 2, change: true })
      ).toBe(
        'wsh(sortedmulti(2,[aabbccdd/48h/0h/0h/2h]xpub-device-1/1/*,[eeff0011/48h/1h/7h/9h]xpub-device-2/1/*))'
      );

      expect(
        nativeSegwitHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single' },
          { network: 'testnet', change: true }
        )
      ).toContain('/1/*)');

      expect(
        nativeSegwitHandler.buildMultiSigDescriptor!(devices, { network: 'mainnet', quorum: 2, change: false })
      ).toContain('/0/*');
    });

    it('validates aliases case-insensitively', () => {
      expect(nativeSegwitHandler.validateDevice!(['WPKH'])).toBe(true);
      expect(nativeSegwitHandler.validateDevice!(['legacy'])).toBe(false);
    });
  });

  describe('nestedSegwitHandler', () => {
    it('builds expected derivation paths', () => {
      expect(nestedSegwitHandler.getDerivationPath('mainnet')).toBe("m/49'/0'/0'");
      expect(nestedSegwitHandler.getDerivationPath('testnet', 6)).toBe("m/49'/1'/6'");
      expect(nestedSegwitHandler.getMultisigDerivationPath('mainnet')).toBe("m/48'/0'/0'/1'");
      expect(nestedSegwitHandler.getMultisigDerivationPath('testnet', 8)).toBe("m/48'/1'/8'/1'");
    });

    it('builds single-sig and multi-sig descriptors', () => {
      expect(
        nestedSegwitHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single' },
          { network: 'mainnet' }
        )
      ).toBe('sh(wpkh([aabbccdd/49h/0h/0h]xpub-single/0/*))');

      expect(
        nestedSegwitHandler.buildMultiSigDescriptor!(devices, { network: 'testnet', quorum: 2, change: true })
      ).toBe(
        'sh(wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/1h]xpub-device-1/1/*,[eeff0011/48h/1h/7h/9h]xpub-device-2/1/*)))'
      );

      expect(
        nestedSegwitHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-single' },
          { network: 'testnet', change: true }
        )
      ).toContain('/1/*))');

      expect(
        nestedSegwitHandler.buildMultiSigDescriptor!(devices, { network: 'testnet', quorum: 2, change: false })
      ).toContain('/0/*');
    });

    it('validates aliases case-insensitively', () => {
      expect(nestedSegwitHandler.validateDevice!(['P2SH-P2WPKH'])).toBe(true);
      expect(nestedSegwitHandler.validateDevice!(['taproot'])).toBe(false);
    });
  });

  describe('taprootHandler', () => {
    it('builds expected derivation paths and single-sig descriptor', () => {
      expect(taprootHandler.getDerivationPath('mainnet')).toBe("m/86'/0'/0'");
      expect(taprootHandler.getDerivationPath('testnet', 9)).toBe("m/86'/1'/9'");
      expect(() => taprootHandler.getMultisigDerivationPath('mainnet')).toThrow();

      expect(
        taprootHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-tap' },
          { network: 'testnet', change: true }
        )
      ).toBe('tr([aabbccdd/86h/1h/0h]xpub-tap/1/*)');

      expect(
        taprootHandler.buildSingleSigDescriptor(
          { fingerprint: 'aabbccdd', xpub: 'xpub-tap' },
          { network: 'mainnet', change: false }
        )
      ).toBe('tr([aabbccdd/86h/0h/0h]xpub-tap/0/*)');
    });

    it('validates aliases case-insensitively', () => {
      expect(taprootHandler.validateDevice!(['P2TR'])).toBe(true);
      expect(taprootHandler.validateDevice!(['segwit'])).toBe(false);
    });
  });
});
