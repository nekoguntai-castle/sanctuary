/**
 * Derivation Path Tests
 *
 * These tests ensure that the correct BIP derivation paths are used for each
 * script type and wallet type (single-sig vs multisig).
 *
 * This prevents bugs where:
 * - Single-sig paths are used for multisig wallets (e.g., m/84' instead of m/48')
 * - Wrong BIP-48 script type numbers are used (e.g., /1' instead of /2')
 * - Testnet paths use mainnet coin type (0 instead of 1)
 *
 * Reference:
 * - BIP-44: m/44'/coin'/account'/change/index (Legacy P2PKH)
 * - BIP-49: m/49'/coin'/account'/change/index (Nested SegWit P2SH-P2WPKH)
 * - BIP-84: m/84'/coin'/account'/change/index (Native SegWit P2WPKH)
 * - BIP-86: m/86'/coin'/account'/change/index (Taproot P2TR)
 * - BIP-48: m/48'/coin'/account'/script'/change/index (Multisig)
 *   - Script type 1: P2SH-P2WSH (nested segwit multisig)
 *   - Script type 2: P2WSH (native segwit multisig)
 * Unsupported policies (legacy and Taproot multisig) must fail closed.
 */

import { describe, it, expect } from 'vitest';
import { legacyHandler } from '@/services/scriptTypes/handlers/legacy';
import { nestedSegwitHandler } from '@/services/scriptTypes/handlers/nestedSegwit';
import { nativeSegwitHandler } from '@/services/scriptTypes/handlers/nativeSegwit';
import { taprootHandler } from '@/services/scriptTypes/handlers/taproot';

describe('Script Type Derivation Paths', () => {
  describe('BIP Standards Compliance', () => {
    describe('Legacy (P2PKH) - BIP-44', () => {
      it('should use BIP-44 (m/44\') for single-sig mainnet', () => {
        const path = legacyHandler.getDerivationPath('mainnet', 0);
        expect(path).toBe("m/44'/0'/0'");
        expect(path).toMatch(/^m\/44'/); // Must start with BIP-44
      });

      it('should use BIP-44 (m/44\') for single-sig testnet', () => {
        const path = legacyHandler.getDerivationPath('testnet', 0);
        expect(path).toBe("m/44'/1'/0'");
        expect(path).toMatch(/^m\/44'/); // Must start with BIP-44
      });

      it('should use correct coin type for mainnet (0) and testnet (1)', () => {
        const mainnet = legacyHandler.getDerivationPath('mainnet', 0);
        const testnet = legacyHandler.getDerivationPath('testnet', 0);
        expect(mainnet).toContain("/0'/"); // Mainnet coin type
        expect(testnet).toContain("/1'/"); // Testnet coin type
      });

      it('should support different account indices', () => {
        expect(legacyHandler.getDerivationPath('mainnet', 0)).toBe("m/44'/0'/0'");
        expect(legacyHandler.getDerivationPath('mainnet', 1)).toBe("m/44'/0'/1'");
        expect(legacyHandler.getDerivationPath('mainnet', 5)).toBe("m/44'/0'/5'");
      });
    });

    describe('Nested SegWit (P2SH-P2WPKH) - BIP-49', () => {
      it('should use BIP-49 (m/49\') for single-sig mainnet', () => {
        const path = nestedSegwitHandler.getDerivationPath('mainnet', 0);
        expect(path).toBe("m/49'/0'/0'");
        expect(path).toMatch(/^m\/49'/); // Must start with BIP-49
      });

      it('should use BIP-49 (m/49\') for single-sig testnet', () => {
        const path = nestedSegwitHandler.getDerivationPath('testnet', 0);
        expect(path).toBe("m/49'/1'/0'");
        expect(path).toMatch(/^m\/49'/);
      });

      it('should use BIP-48 script type 1 for multisig mainnet', () => {
        const path = nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0);
        expect(path).toBe("m/48'/0'/0'/1'");
        expect(path).toMatch(/^m\/48'/); // Must use BIP-48 for multisig
        expect(path).toMatch(/\/1'$/); // Script type 1 for nested segwit
      });

      it('should use BIP-48 script type 1 for multisig testnet', () => {
        const path = nestedSegwitHandler.getMultisigDerivationPath('testnet', 0);
        expect(path).toBe("m/48'/1'/0'/1'");
        expect(path).toMatch(/^m\/48'/);
        expect(path).toMatch(/\/1'$/); // Script type 1
      });

      it('should NOT use single-sig path for multisig', () => {
        const singleSig = nestedSegwitHandler.getDerivationPath('mainnet', 0);
        const multisig = nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0);

        // Single-sig should use BIP-49
        expect(singleSig).toMatch(/^m\/49'/);
        // Multisig should use BIP-48, NOT BIP-49
        expect(multisig).toMatch(/^m\/48'/);
        expect(multisig).not.toMatch(/^m\/49'/);
      });
    });

    describe('Native SegWit (P2WPKH) - BIP-84', () => {
      it('should use BIP-84 (m/84\') for single-sig mainnet', () => {
        const path = nativeSegwitHandler.getDerivationPath('mainnet', 0);
        expect(path).toBe("m/84'/0'/0'");
        expect(path).toMatch(/^m\/84'/);
      });

      it('should use BIP-84 (m/84\') for single-sig testnet', () => {
        const path = nativeSegwitHandler.getDerivationPath('testnet', 0);
        expect(path).toBe("m/84'/1'/0'");
        expect(path).toMatch(/^m\/84'/);
      });

      it('should use BIP-48 script type 2 for multisig mainnet', () => {
        const path = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
        expect(path).toBe("m/48'/0'/0'/2'");
        expect(path).toMatch(/^m\/48'/); // Must use BIP-48 for multisig
        expect(path).toMatch(/\/2'$/); // Script type 2 for native segwit
      });

      it('should use BIP-48 script type 2 for multisig testnet', () => {
        const path = nativeSegwitHandler.getMultisigDerivationPath('testnet', 0);
        expect(path).toBe("m/48'/1'/0'/2'");
        expect(path).toMatch(/^m\/48'/);
        expect(path).toMatch(/\/2'$/); // Script type 2
      });

      it('should NOT use single-sig path for multisig', () => {
        const singleSig = nativeSegwitHandler.getDerivationPath('mainnet', 0);
        const multisig = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);

        // Single-sig should use BIP-84
        expect(singleSig).toMatch(/^m\/84'/);
        // Multisig should use BIP-48, NOT BIP-84
        expect(multisig).toMatch(/^m\/48'/);
        expect(multisig).not.toMatch(/^m\/84'/);
      });
    });

    describe('Taproot (P2TR) - BIP-86', () => {
      it('should use BIP-86 (m/86\') for single-sig mainnet', () => {
        const path = taprootHandler.getDerivationPath('mainnet', 0);
        expect(path).toBe("m/86'/0'/0'");
        expect(path).toMatch(/^m\/86'/);
      });

      it('should use BIP-86 (m/86\') for single-sig testnet', () => {
        const path = taprootHandler.getDerivationPath('testnet', 0);
        expect(path).toBe("m/86'/1'/0'");
        expect(path).toMatch(/^m\/86'/);
      });

      it('should reject proposed BIP-48 script type 3 on mainnet', () => {
        expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0))
          .toThrow('Taproot multisig is not supported');
      });

      it('should reject proposed BIP-48 script type 3 on testnet', () => {
        expect(() => taprootHandler.getMultisigDerivationPath('testnet', 0))
          .toThrow('Taproot multisig is not supported');
      });
    });
  });

  describe('Common Path Mistakes Prevention', () => {
    it('should never use BIP-84 path for native segwit multisig', () => {
      // This is a common mistake: using m/84' for multisig when it should be m/48'
      const multisigPath = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
      expect(multisigPath).not.toMatch(/^m\/84'/);
      expect(multisigPath).toMatch(/^m\/48'/);
    });

    it('should never use BIP-49 path for nested segwit multisig', () => {
      const multisigPath = nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0);
      expect(multisigPath).not.toMatch(/^m\/49'/);
      expect(multisigPath).toMatch(/^m\/48'/);
    });

    it('should never derive a path for unsupported taproot multisig', () => {
      expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0))
        .toThrow('Taproot multisig is not supported');
    });

    it('should use correct BIP-48 script type numbers', () => {
      // Script type 1 = P2SH-P2WSH (nested segwit multisig)
      expect(nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toMatch(/\/1'$/);

      // Script type 2 = P2WSH (native segwit multisig)
      expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toMatch(/\/2'$/);

      expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0)).toThrow();
    });

    it('should always use testnet coin type (1) for testnet', () => {
      // Helper to extract coin type from path (second component after m/)
      const getCoinType = (path: string): string => {
        const parts = path.split('/');
        return parts[2]; // m/purpose'/coin'/...
      };

      // BIP-48 handlers (nested segwit, native segwit, taproot) use coin type
      const bip48Handlers = [nestedSegwitHandler, nativeSegwitHandler];

      for (const handler of bip48Handlers) {
        const singleSig = handler.getDerivationPath('testnet', 0);
        const multisig = handler.getMultisigDerivationPath('testnet', 0);

        // Testnet paths should have coin type 1 in the second position
        expect(getCoinType(singleSig)).toBe("1'");
        expect(getCoinType(multisig)).toBe("1'");
      }

      // Legacy single-sig uses BIP-44 with coin type
      const legacySingleSig = legacyHandler.getDerivationPath('testnet', 0);
      expect(getCoinType(legacySingleSig)).toBe("1'");

      // Legacy multisig uses BIP-45 which doesn't have coin type (m/45'/account')
      // This is by design - BIP-45 predates BIP-48 and uses a simpler path structure
      expect(() => legacyHandler.getMultisigDerivationPath('testnet', 0))
        .toThrow('Legacy multisig is not supported');
    });

    it('should always use mainnet coin type (0) for mainnet', () => {
      // Helper to extract coin type from path (second component after m/)
      const getCoinType = (path: string): string => {
        const parts = path.split('/');
        return parts[2]; // m/purpose'/coin'/...
      };

      // BIP-48 handlers (nested segwit, native segwit, taproot) use coin type
      const bip48Handlers = [nestedSegwitHandler, nativeSegwitHandler];

      for (const handler of bip48Handlers) {
        const singleSig = handler.getDerivationPath('mainnet', 0);
        const multisig = handler.getMultisigDerivationPath('mainnet', 0);

        // Mainnet paths should have coin type 0 in the second position
        expect(getCoinType(singleSig)).toBe("0'");
        expect(getCoinType(multisig)).toBe("0'");
      }

      // Legacy single-sig uses BIP-44 with coin type
      const legacySingleSig = legacyHandler.getDerivationPath('mainnet', 0);
      expect(getCoinType(legacySingleSig)).toBe("0'");

      // Legacy multisig uses BIP-45 which doesn't have coin type (m/45'/account')
      expect(() => legacyHandler.getMultisigDerivationPath('mainnet', 0))
        .toThrow('Legacy multisig is not supported');
    });
  });

  describe('Hardware Wallet Compatibility', () => {
    describe('Standard BIP-48 Multisig Paths', () => {
      // These paths are what hardware wallets expect for multisig
      // Using the wrong path will generate addresses that don't match the hardware wallet

      it('should use exact standard paths for native segwit multisig (most common)', () => {
        // This is the most common multisig type - must be exactly right
        expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toBe("m/48'/0'/0'/2'");
        expect(nativeSegwitHandler.getMultisigDerivationPath('testnet', 0)).toBe("m/48'/1'/0'/2'");
        expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet', 1)).toBe("m/48'/0'/1'/2'");
        expect(nativeSegwitHandler.getMultisigDerivationPath('testnet', 1)).toBe("m/48'/1'/1'/2'");
      });

      it('should use exact standard paths for nested segwit multisig', () => {
        expect(nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toBe("m/48'/0'/0'/1'");
        expect(nestedSegwitHandler.getMultisigDerivationPath('testnet', 0)).toBe("m/48'/1'/0'/1'");
      });

      it('should reject nonstandard taproot multisig paths', () => {
        expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0)).toThrow();
        expect(() => taprootHandler.getMultisigDerivationPath('testnet', 0)).toThrow();
      });
    });

    describe('Standard Single-Sig Paths', () => {
      // These must match what hardware wallets derive for single-sig

      it('should use exact standard paths for native segwit single-sig (BIP-84)', () => {
        expect(nativeSegwitHandler.getDerivationPath('mainnet', 0)).toBe("m/84'/0'/0'");
        expect(nativeSegwitHandler.getDerivationPath('testnet', 0)).toBe("m/84'/1'/0'");
        expect(nativeSegwitHandler.getDerivationPath('mainnet', 1)).toBe("m/84'/0'/1'");
      });

      it('should use exact standard paths for nested segwit single-sig (BIP-49)', () => {
        expect(nestedSegwitHandler.getDerivationPath('mainnet', 0)).toBe("m/49'/0'/0'");
        expect(nestedSegwitHandler.getDerivationPath('testnet', 0)).toBe("m/49'/1'/0'");
      });

      it('should use exact standard paths for taproot single-sig (BIP-86)', () => {
        expect(taprootHandler.getDerivationPath('mainnet', 0)).toBe("m/86'/0'/0'");
        expect(taprootHandler.getDerivationPath('testnet', 0)).toBe("m/86'/1'/0'");
      });

      it('should use exact standard paths for legacy single-sig (BIP-44)', () => {
        expect(legacyHandler.getDerivationPath('mainnet', 0)).toBe("m/44'/0'/0'");
        expect(legacyHandler.getDerivationPath('testnet', 0)).toBe("m/44'/1'/0'");
      });
    });

    describe('Path Structure Validation', () => {
      // Verify the path structure matches BIP specifications exactly

      it('should have exactly 3 levels for single-sig (purpose/coin/account)', () => {
        const handlers = [legacyHandler, nestedSegwitHandler, nativeSegwitHandler, taprootHandler];

        for (const handler of handlers) {
          const path = handler.getDerivationPath('mainnet', 0);
          // Should be m/purpose'/coin'/account' (3 hardened levels after m/)
          const levels = path.split('/').slice(1); // Remove 'm'
          expect(levels).toHaveLength(3);
          // All should be hardened
          expect(levels.every((l) => l.endsWith("'"))).toBe(true);
        }
      });

      it('should have exactly 4 levels for BIP-48 multisig (purpose/coin/account/script)', () => {
        const handlers = [nestedSegwitHandler, nativeSegwitHandler];

        for (const handler of handlers) {
          const path = handler.getMultisigDerivationPath('mainnet', 0);
          // Should be m/48'/coin'/account'/script' (4 hardened levels after m/)
          const levels = path.split('/').slice(1); // Remove 'm'
          expect(levels).toHaveLength(4);
          // All should be hardened
          expect(levels.every((l) => l.endsWith("'"))).toBe(true);
          // First level must be 48 (BIP-48)
          expect(levels[0]).toBe("48'");
        }
      });

      it('should reject BIP-45 legacy multisig', () => {
        expect(() => legacyHandler.getMultisigDerivationPath('mainnet', 0)).toThrow();
      });
    });

    describe('Cross-Path Contamination Prevention', () => {
      // These tests specifically prevent the bug where single-sig paths
      // are accidentally used for multisig, which would generate addresses
      // that hardware wallets won't recognize

      it('should never derive multisig from single-sig path structure', () => {
        // The critical bug to prevent: using m/84'/0'/0' for multisig
        // This would generate addresses that don't exist on hardware wallets

        const nativeMultisig = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
        const nestedMultisig = nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0);

        // None should start with single-sig BIP numbers
        const singleSigBips = ['44', '49', '84', '86'];
        for (const bip of singleSigBips) {
          expect(nativeMultisig).not.toMatch(new RegExp(`^m/${bip}'`));
          expect(nestedMultisig).not.toMatch(new RegExp(`^m/${bip}'`));
        }
        expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0)).toThrow();
      });

      it('should never derive single-sig from multisig path structure', () => {
        // The reverse bug: using m/48'/0'/0'/2' for single-sig
        const nativeSingle = nativeSegwitHandler.getDerivationPath('mainnet', 0);
        const nestedSingle = nestedSegwitHandler.getDerivationPath('mainnet', 0);
        const taprootSingle = taprootHandler.getDerivationPath('mainnet', 0);
        const legacySingle = legacyHandler.getDerivationPath('mainnet', 0);

        // None should start with multisig BIP numbers
        expect(nativeSingle).not.toMatch(/^m\/48'/);
        expect(nestedSingle).not.toMatch(/^m\/48'/);
        expect(taprootSingle).not.toMatch(/^m\/48'/);
        expect(legacySingle).not.toMatch(/^m\/48'/);
        expect(legacySingle).not.toMatch(/^m\/45'/);
      });

      it('should use matching script types between path and address type', () => {
        // Prevent: using BIP-48 script type 2 (native segwit) for nested segwit addresses
        // The script type in the path must match the script type being generated

        // Native segwit multisig must use script type 2
        expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toMatch(/\/2'$/);

        // Nested segwit multisig must use script type 1
        expect(nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toMatch(/\/1'$/);

        expect(() => taprootHandler.getMultisigDerivationPath('mainnet', 0)).toThrow();
      });
    });

    describe('Account Index Isolation', () => {
      // Different accounts must derive different paths

      it('should derive different paths for different account indices', () => {
        const account0 = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
        const account1 = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 1);
        const account2 = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 2);

        expect(account0).not.toBe(account1);
        expect(account1).not.toBe(account2);
        expect(account0).not.toBe(account2);

        // Account index should be in the correct position (3rd level for BIP-48)
        expect(account0).toContain("/0'/2'");
        expect(account1).toContain("/1'/2'");
        expect(account2).toContain("/2'/2'");
      });
    });

    describe('Network Isolation', () => {
      // Mainnet and testnet must never share paths

      it('should never allow mainnet path for testnet derivation', () => {
        const mainnet = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
        const testnet = nativeSegwitHandler.getMultisigDerivationPath('testnet', 0);

        expect(mainnet).not.toBe(testnet);
        expect(mainnet).toContain("/0'/"); // Mainnet coin type
        expect(testnet).toContain("/1'/"); // Testnet coin type
      });

      it('should produce different xpubs for same seed on different networks', () => {
        // This is a documentation test - the paths differ, so xpubs will differ
        const mainnetPath = nativeSegwitHandler.getDerivationPath('mainnet', 0);
        const testnetPath = nativeSegwitHandler.getDerivationPath('testnet', 0);

        expect(mainnetPath).toBe("m/84'/0'/0'");
        expect(testnetPath).toBe("m/84'/1'/0'");
      });
    });
  });

  describe('Handler Metadata Consistency', () => {
    it('should have correct BIP numbers in handler metadata', () => {
      expect(legacyHandler.bip).toBe(44);
      expect(nestedSegwitHandler.bip).toBe(49);
      expect(nativeSegwitHandler.bip).toBe(84);
      expect(taprootHandler.bip).toBe(86);
    });

    it('should have correct multisig BIP (48) in handler metadata', () => {
      expect(nestedSegwitHandler.multisigBip).toBe(48);
      expect(nativeSegwitHandler.multisigBip).toBe(48);
      expect(taprootHandler.multisigBip).toBe(48);
    });

    it('should have correct BIP-48 script type numbers in handler metadata', () => {
      expect(nestedSegwitHandler.multisigScriptTypeNumber).toBe(1);
      expect(nativeSegwitHandler.multisigScriptTypeNumber).toBe(2);
      expect(taprootHandler.multisigScriptTypeNumber).toBe(3);
    });

    it('should match metadata with actual derivation paths', () => {
      // Native SegWit
      const nativeMultisig = nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0);
      expect(nativeMultisig).toBe(`m/${nativeSegwitHandler.multisigBip}'/0'/0'/${nativeSegwitHandler.multisigScriptTypeNumber}'`);

      // Nested SegWit
      const nestedMultisig = nestedSegwitHandler.getMultisigDerivationPath('mainnet', 0);
      expect(nestedMultisig).toBe(`m/${nestedSegwitHandler.multisigBip}'/0'/0'/${nestedSegwitHandler.multisigScriptTypeNumber}'`);
    });
  });
});
