/**
 * Device Parser Registry Tests
 *
 * Comprehensive tests for all device import format parsers.
 * Tests cover format detection, parsing accuracy, and priority handling.
 *
 * Test xpub values are from the BIP-39 test mnemonic:
 * "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 *
 * Single-sig test vectors (official BIP test vectors):
 * - BIP-84 (zpub): zpub6rFR7y4Q2AijB...AGutZYs - first address: bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu
 * - BIP-49 (ypub): ypub6Ww3ibxVfGzLr...663zsP - first address: 37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf
 * - BIP-44 (xpub): xpub6BosfCnifzxcF...T9nMdj - first address: 1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA
 *
 * Multisig test values (Zpub/Ypub) are test-only placeholder values for format parsing tests.
 */

import { parseDeviceJson, parseDeviceData, deviceParserRegistry } from '../../../services/deviceParsers';
import { coldcardNestedParser } from '../../../services/deviceParsers/parsers/coldcardNested';
import { coldcardFlatParser } from '../../../services/deviceParsers/parsers/coldcardFlat';
import { keystoneStandardParser, keystoneMultisigParser } from '../../../services/deviceParsers/parsers/keystone';
import { descriptorJsonParser, descriptorStringParser } from '../../../services/deviceParsers/parsers/descriptor';
import { ledgerParser } from '../../../services/deviceParsers/parsers/ledger';
import { bitboxParser } from '../../../services/deviceParsers/parsers/bitbox';
import { genericJsonParser, plainXpubParser, simpleColdcardParser } from '../../../services/deviceParsers/parsers/generic';

describe('Device Parser Registry', () => {
  describe('Coldcard Nested Format Parser', () => {
    const coldcardNestedJson = {
      xfp: 'FA79B6AA',
      xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
      bip84: {
        xpub: 'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XYuvXUGvJsQAq1GCqUFQeMLeJfFpWv3GnY2GnBGn4BwxJDy6EqgCdmR2',
        _pub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
        deriv: "m/84'/0'/0'",
        first: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        name: 'p2wpkh',
      },
      bip49: {
        xpub: 'xpub6CtxCreU4rB3WcvTKh3bk2FVkJPQq4JqPJ3WXPEZqZ1JYfvL7ZaJqLRHqDwVLLHqfoJMVLGVbMC4Zwgs6BnNQmzGxMMjEaH3WJWTyZqK8yu',
        _pub: 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP',
        deriv: "m/49'/0'/0'",
        first: '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
        name: 'p2sh-p2wpkh',
      },
    };

    it('detects Coldcard nested format', () => {
      const result = coldcardNestedParser.canParse(coldcardNestedJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('parses Coldcard nested format with BIP84', () => {
      const result = coldcardNestedParser.parse(coldcardNestedJson);
      expect(result.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
      expect(result.fingerprint).toBe('FA79B6AA');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
    });

    it('prefers BIP84 over BIP49', () => {
      const result = coldcardNestedParser.parse(coldcardNestedJson);
      expect(result.derivationPath).toContain('84');
    });

    it('falls back to BIP49 when BIP84 not present', () => {
      const bip49Only = {
        xfp: 'FA79B6AA',
        bip49: coldcardNestedJson.bip49,
      };
      const result = coldcardNestedParser.parse(bip49Only);
      expect(result.xpub).toBe('ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP');
      expect(result.derivationPath).toBe("m/49'/0'/0'");
    });

    it('does not detect non-Coldcard format', () => {
      const result = coldcardNestedParser.canParse({ xpub: 'xpub123' });
      expect(result.detected).toBe(false);
    });

    describe('Multi-account support', () => {
      it('returns all available accounts in accounts array', () => {
        const result = coldcardNestedParser.parse(coldcardNestedJson);
        expect(result.accounts).toBeDefined();
        expect(result.accounts).toHaveLength(2); // bip84 + bip49
      });

      it('includes correct purpose and scriptType for each account', () => {
        const result = coldcardNestedParser.parse(coldcardNestedJson);

        const bip84Account = result.accounts?.find(a => a.derivationPath === "m/84'/0'/0'");
        expect(bip84Account).toBeDefined();
        expect(bip84Account?.purpose).toBe('single_sig');
        expect(bip84Account?.scriptType).toBe('native_segwit');
        expect(bip84Account?.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');

        const bip49Account = result.accounts?.find(a => a.derivationPath === "m/49'/0'/0'");
        expect(bip49Account).toBeDefined();
        expect(bip49Account?.purpose).toBe('single_sig');
        expect(bip49Account?.scriptType).toBe('nested_segwit');
      });

      it('includes multisig accounts from bip48 sections', () => {
        const withMultisig = {
          ...coldcardNestedJson,
          bip48_2: { xpub: 'Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1', deriv: "m/48'/0'/0'/2'" },
          bip48_1: { xpub: 'Ypub6kmozyJz2ut3cLFdmC9fVy6bNz6m7d7FZ3S8JJiNFhbPbKPFYnH7Pt2qYntVaLPMzrdADsWJjHQwFjJZ5XAWJpEwAq1FxXpvzNS2xCSxJQH', deriv: "m/48'/0'/0'/1'" },
        };
        const result = coldcardNestedParser.parse(withMultisig);

        expect(result.accounts?.length).toBe(4); // bip84 + bip49 + bip48_2 + bip48_1

        const multisigNativeSegwit = result.accounts?.find(a => a.purpose === 'multisig' && a.scriptType === 'native_segwit');
        expect(multisigNativeSegwit).toBeDefined();
        expect(multisigNativeSegwit?.derivationPath).toBe("m/48'/0'/0'/2'");

        const multisigNestedSegwit = result.accounts?.find(a => a.purpose === 'multisig' && a.scriptType === 'nested_segwit');
        expect(multisigNestedSegwit).toBeDefined();
        expect(multisigNestedSegwit?.derivationPath).toBe("m/48'/0'/0'/1'");
      });

      it('includes taproot and legacy accounts when present', () => {
        const fullExport = {
          ...coldcardNestedJson,
          bip86: { _pub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKiKbERLgVvnEB', deriv: "m/86'/0'/0'" },
          bip44: { _pub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNs', deriv: "m/44'/0'/0'" },
        };
        const result = coldcardNestedParser.parse(fullExport);

        const taprootAccount = result.accounts?.find(a => a.scriptType === 'taproot');
        expect(taprootAccount).toBeDefined();
        expect(taprootAccount?.derivationPath).toBe("m/86'/0'/0'");
        expect(taprootAccount?.purpose).toBe('single_sig');

        const legacyAccount = result.accounts?.find(a => a.scriptType === 'legacy');
        expect(legacyAccount).toBeDefined();
        expect(legacyAccount?.derivationPath).toBe("m/44'/0'/0'");
        expect(legacyAccount?.purpose).toBe('single_sig');
      });
    });
  });

  describe('Coldcard Flat Format Parser', () => {
    const coldcardFlatJson = {
      xfp: 'FA79B6AA',
      p2wsh: 'Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1',
      p2wsh_deriv: "m/48'/0'/0'/2'",
      p2sh_p2wsh: 'Ypub6kmozyJz2ut3cLFdmC9fVy6bNz6m7d7FZ3S8JJiNFhbPbKPFYnH7Pt2qYntVaLPMzrdADsWJjHQwFjJZ5XAWJpEwAq1FxXpvzNS2xCSxJQH',
      p2sh_p2wsh_deriv: "m/48'/0'/0'/1'",
      p2sh: 'xpub6D3ntSTLwk4uGScCJWiQ2W5p8pLd4C4QRFMxLF7MFc8SCBqKGBWpvTgxLqehgktDr4MzguLj7ChMNg9FAMaLq77cBKQomWActtd2pKoXSvN',
      p2sh_deriv: "m/45'",
    };

    it('detects Coldcard flat format', () => {
      const result = coldcardFlatParser.canParse(coldcardFlatJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(85);
    });

    it('parses Coldcard flat format, preferring p2wsh', () => {
      const result = coldcardFlatParser.parse(coldcardFlatJson);
      expect(result.xpub).toBe('Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1');
      expect(result.fingerprint).toBe('FA79B6AA');
      expect(result.derivationPath).toBe("m/48'/0'/0'/2'");
    });

    it('falls back to p2sh_p2wsh when p2wsh not present', () => {
      const { p2wsh, p2wsh_deriv, ...p2shOnly } = coldcardFlatJson;
      const result = coldcardFlatParser.parse(p2shOnly);
      expect(result.xpub).toBe('Ypub6kmozyJz2ut3cLFdmC9fVy6bNz6m7d7FZ3S8JJiNFhbPbKPFYnH7Pt2qYntVaLPMzrdADsWJjHQwFjJZ5XAWJpEwAq1FxXpvzNS2xCSxJQH');
      expect(result.derivationPath).toBe("m/48'/0'/0'/1'");
    });

    it('does not detect nested Coldcard format', () => {
      const nestedFormat = { xfp: 'FA79B6AA', bip84: { xpub: 'xpub123' } };
      const result = coldcardFlatParser.canParse(nestedFormat);
      expect(result.detected).toBe(false);
    });
  });

  describe('Keystone Standard Format Parser', () => {
    const keystoneJson = {
      coins: [
        {
          coinCode: 'BTC',
          accounts: [
            { hdPath: "M/84'/0'/0'", xPub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj' },
            { hdPath: "M/49'/0'/0'", xPub: 'xpub6BdhnKBYjvXiHLbz6GVvhVGBzxYZDhWJb9nFCd5jqHxNLfLmhN5a3o8sCs4zLFwGEfPRkBw5FAq7ZrbJfW5HrF9qNvFgJKRDQmzpdHLv9Qf' },
          ],
        },
      ],
    };

    it('detects Keystone standard format', () => {
      const result = keystoneStandardParser.canParse(keystoneJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('parses Keystone standard format, preferring BIP84', () => {
      const result = keystoneStandardParser.parse(keystoneJson);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
    });

    it('handles nested Keystone format', () => {
      const nestedFormat = {
        data: {
          sync: {
            coins: keystoneJson.coins,
          },
        },
      };
      const result = keystoneStandardParser.parse(nestedFormat);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
    });

    describe('Multi-account support', () => {
      it('returns all accounts in accounts array', () => {
        const result = keystoneStandardParser.parse(keystoneJson);
        expect(result.accounts).toBeDefined();
        expect(result.accounts).toHaveLength(2); // BIP84 + BIP49
      });

      it('sets correct purpose and scriptType for each account', () => {
        const result = keystoneStandardParser.parse(keystoneJson);

        const bip84Account = result.accounts?.find(a => a.derivationPath === "m/84'/0'/0'");
        expect(bip84Account).toBeDefined();
        expect(bip84Account?.purpose).toBe('single_sig');
        expect(bip84Account?.scriptType).toBe('native_segwit');

        const bip49Account = result.accounts?.find(a => a.derivationPath === "m/49'/0'/0'");
        expect(bip49Account).toBeDefined();
        expect(bip49Account?.purpose).toBe('single_sig');
        expect(bip49Account?.scriptType).toBe('nested_segwit');
      });

      it('correctly identifies multisig accounts from BIP-48 paths', () => {
        const withMultisig = {
          coins: [
            {
              coinCode: 'BTC',
              accounts: [
                { hdPath: "M/84'/0'/0'", xPub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj' },
                { hdPath: "M/48'/0'/0'/2'", xPub: 'Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1' },
              ],
            },
          ],
        };
        const result = keystoneStandardParser.parse(withMultisig);

        const multisigAccount = result.accounts?.find(a => a.purpose === 'multisig');
        expect(multisigAccount).toBeDefined();
        expect(multisigAccount?.derivationPath).toBe("m/48'/0'/0'/2'");
        expect(multisigAccount?.scriptType).toBe('native_segwit');
      });

      it('correctly identifies taproot accounts from BIP-86 paths', () => {
        const withTaproot = {
          coins: [
            {
              coinCode: 'BTC',
              accounts: [
                { hdPath: "M/86'/0'/0'", xPub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKiKbERLgVvnEB' },
              ],
            },
          ],
        };
        const result = keystoneStandardParser.parse(withTaproot);

        expect(result.accounts).toHaveLength(1);
        expect(result.accounts?.[0].scriptType).toBe('taproot');
        expect(result.accounts?.[0].purpose).toBe('single_sig');
      });
    });
  });

  describe('Keystone Multisig Format Parser', () => {
    const keystoneMultisigJson = {
      ExtendedPublicKey: 'Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1',
      Path: "M/48'/0'/0'/2'",
      xfp: '37b5eed4',
    };

    it('detects Keystone multisig format', () => {
      const result = keystoneMultisigParser.canParse(keystoneMultisigJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(85);
    });

    it('parses Keystone multisig format', () => {
      const result = keystoneMultisigParser.parse(keystoneMultisigJson);
      expect(result.xpub).toBe('Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1');
      expect(result.fingerprint).toBe('37b5eed4');
      expect(result.derivationPath).toBe("m/48'/0'/0'/2'");
    });

    describe('Multi-account support', () => {
      it('returns accounts array with single multisig account', () => {
        const result = keystoneMultisigParser.parse(keystoneMultisigJson);
        expect(result.accounts).toBeDefined();
        expect(result.accounts).toHaveLength(1);
      });

      it('sets purpose to multisig for native segwit multisig path', () => {
        const result = keystoneMultisigParser.parse(keystoneMultisigJson);
        expect(result.accounts?.[0].purpose).toBe('multisig');
        expect(result.accounts?.[0].scriptType).toBe('native_segwit');
        expect(result.accounts?.[0].derivationPath).toBe("m/48'/0'/0'/2'");
      });

      it('correctly identifies nested segwit multisig from BIP-48 /1/ path', () => {
        const nestedSegwitMultisig = {
          ExtendedPublicKey: 'Ypub6kmozyJz2ut3cLFdmC9fVy6bNz6m7d7FZ3S8JJiNFhbPbKPFYnH7Pt2qYntVaLPMzrdADsWJjHQwFjJZ5XAWJpEwAq1FxXpvzNS2xCSxJQH',
          Path: "M/48'/0'/0'/1'",
          xfp: '37b5eed4',
        };
        const result = keystoneMultisigParser.parse(nestedSegwitMultisig);

        expect(result.accounts?.[0].scriptType).toBe('nested_segwit');
        expect(result.accounts?.[0].purpose).toBe('multisig');
      });
    });
  });

  describe('Descriptor JSON Format Parser', () => {
    const descriptorJson = {
      descriptor: "wpkh([fa79b6aa/84h/0h/0h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)#abcd1234",
      label: 'My Wallet',
    };

    it('detects descriptor JSON format', () => {
      const result = descriptorJsonParser.canParse(descriptorJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(90);
    });

    it('parses descriptor JSON format', () => {
      const result = descriptorJsonParser.parse(descriptorJson);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result.fingerprint).toBe('fa79b6aa');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
      expect(result.label).toBe('My Wallet');
    });

    it('handles h notation in derivation path', () => {
      const result = descriptorJsonParser.parse(descriptorJson);
      // 'h' should be converted to apostrophe
      expect(result.derivationPath).toBe("m/84'/0'/0'");
    });

    it('returns undetected for non-object and missing descriptor JSON shapes', () => {
      expect(descriptorJsonParser.canParse(null).detected).toBe(false);
      expect(descriptorJsonParser.canParse('not-json').detected).toBe(false);
      expect(descriptorJsonParser.canParse({}).detected).toBe(false);
      expect(descriptorJsonParser.canParse({ descriptor: '' }).detected).toBe(false);
    });

    it('returns undetected for descriptor JSON with non-matching descriptor content', () => {
      const result = descriptorJsonParser.canParse({ descriptor: 'wpkh([zzzzzzzz]not-an-xpub)' });
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('parses descriptor JSON label fallback from name and empty default', () => {
      const withName = descriptorJsonParser.parse({
        descriptor: "wpkh([fa79b6aa/84h/0h/0h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)#abcd1234",
        name: 'Fallback Name',
      });
      expect(withName.label).toBe('Fallback Name');

      const empty = descriptorJsonParser.parse({ descriptor: 'invalid' });
      expect(empty).toEqual({ label: '' });

      const missingDescriptor = descriptorJsonParser.parse({} as any);
      expect(missingDescriptor).toEqual({ label: '' });
    });

    it('parses descriptor JSON with no path segment as empty derivation path', () => {
      const result = descriptorJsonParser.parse({
        descriptor: 'wpkh([fa79b6aa]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)#abcd1234',
      });

      expect(result.fingerprint).toBe('fa79b6aa');
      expect(result.derivationPath).toBe('');
    });
  });

  describe('Descriptor String Format Parser', () => {
    const descriptorString = "wpkh([fa79b6aa/84h/0h/0h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)#abcd1234";

    it('detects descriptor string format', () => {
      const result = descriptorStringParser.canParse(descriptorString);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(60);
    });

    it('parses descriptor string format', () => {
      const result = descriptorStringParser.parse(descriptorString);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result.fingerprint).toBe('fa79b6aa');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
    });

    it('returns undetected for non-string or invalid descriptor string input', () => {
      expect(descriptorStringParser.canParse({ descriptor: 'x' }).detected).toBe(false);

      const invalid = descriptorStringParser.canParse('wpkh([fa79b6aa/84h/0h/0h]not-an-xpub)');
      expect(invalid.detected).toBe(false);
      expect(invalid.confidence).toBe(0);
    });

    it('returns empty parse result for non-string or invalid descriptor strings', () => {
      expect(descriptorStringParser.parse(123 as unknown as string)).toEqual({});
      expect(descriptorStringParser.parse('wpkh([fa79b6aa/84h/0h/0h]not-an-xpub)')).toEqual({});
    });
  });

  describe('Ledger Format Parser', () => {
    const ledgerJson = {
      xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
      freshAddressPath: "84'/0'/0'/0/0",
      name: 'My Ledger Wallet',
    };

    it('detects Ledger format', () => {
      const result = ledgerParser.canParse(ledgerJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('parses Ledger format and extracts account path', () => {
      const result = ledgerParser.parse(ledgerJson);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
      expect(result.label).toBe('My Ledger Wallet');
    });

    it('rejects invalid shapes in format detection', () => {
      expect(ledgerParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
      expect(ledgerParser.canParse({ xpub: '', freshAddressPath: "84'/0'/0'/0/0" })).toEqual({ detected: false, confidence: 0 });
      expect(ledgerParser.canParse({ xpub: 'xpub123' })).toEqual({ detected: false, confidence: 0 });
    });

    it('returns parse fallbacks when path/xpub/name are missing or malformed', () => {
      const result = ledgerParser.parse({
        freshAddressPath: 'not/a/bip/path',
      });

      expect(result.derivationPath).toBe('');
      expect(result.xpub).toBe('');
      expect(result.label).toBe('');
    });
  });

  describe('BitBox Format Parser', () => {
    const bitboxJson = {
      keypath: "m/84'/0'/0'",
      xpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
    };

    it('detects BitBox format', () => {
      const result = bitboxParser.canParse(bitboxJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('parses BitBox format', () => {
      const result = bitboxParser.parse(bitboxJson);
      expect(result.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
    });

    it('rejects malformed BitBox payloads in detection', () => {
      expect(bitboxParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
      expect(bitboxParser.canParse({ keypath: "m/84'/0'/0'" })).toEqual({ detected: false, confidence: 0 });
      expect(bitboxParser.canParse({ xpub: 'xpub123' })).toEqual({ detected: false, confidence: 0 });
      expect(bitboxParser.canParse({ keypath: '', xpub: 'xpub123' })).toEqual({ detected: false, confidence: 0 });
    });

    it('falls back to empty parse fields when keypath/xpub are missing', () => {
      expect(bitboxParser.parse({})).toEqual({
        xpub: '',
        derivationPath: '',
      });
    });
  });

  describe('Simple Coldcard/Passport Parser', () => {
    const simpleJson = {
      xfp: 'FA79B6AA',
      xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
      deriv: "m/84'/0'/0'",
      name: 'My Coldcard',
    };

    it('detects simple Coldcard format', () => {
      const result = simpleColdcardParser.canParse(simpleJson);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('parses simple Coldcard format', () => {
      const result = simpleColdcardParser.parse(simpleJson);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result.fingerprint).toBe('FA79B6AA');
      expect(result.derivationPath).toBe("m/84'/0'/0'");
      expect(result.label).toBe('My Coldcard');
    });

    it('falls back to empty strings when expected fields are missing', () => {
      const result = simpleColdcardParser.parse({});
      expect(result).toEqual({
        xpub: '',
        fingerprint: '',
        derivationPath: '',
        label: '',
      });
    });
  });

  describe('Generic JSON Parser', () => {
    const xpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

    it('detects only object payloads with a sufficiently long xpub-like field', () => {
      expect(genericJsonParser.canParse('not-an-object')).toEqual({ detected: false, confidence: 0 });
      expect(genericJsonParser.canParse({ xpub: 'short-xpub' })).toEqual({ detected: false, confidence: 0 });
      expect(genericJsonParser.canParse({ extPubKey: xpub })).toEqual({ detected: true, confidence: 50 });
    });

    it('parses JSON with various xpub field names', () => {
      const zpubJson = { zpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs' };
      const result = genericJsonParser.parse(zpubJson);
      expect(result.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
    });

    it('parses JSON with various fingerprint field names', () => {
      const json = { xpub: 'xpub123456789012345678901234567890123456789012345678901234567', master_fingerprint: 'DEADBEEF' };
      const result = genericJsonParser.parse(json);
      expect(result.fingerprint).toBe('DEADBEEF');
    });

    it('uses first non-empty path/label fields after skipping empty values', () => {
      const result = genericJsonParser.parse({
        xpub,
        derivation: '',
        path: "m/84'/0'/0'",
        label: '',
        wallet_name: 'Fallback Label',
      });

      expect(result.derivationPath).toBe("m/84'/0'/0'");
      expect(result.label).toBe('Fallback Label');
    });
  });

  describe('Plain Xpub Parser', () => {
    it('detects plain xpub string', () => {
      const xpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
      const result = plainXpubParser.canParse(xpub);
      expect(result.detected).toBe(true);
    });

    it('parses plain xpub string', () => {
      const xpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
      const result = plainXpubParser.parse(xpub);
      expect(result.xpub).toBe(xpub);
    });

    it('extracts xpub from text with surrounding content', () => {
      const text = 'My wallet xpub is xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj please use it';
      const result = plainXpubParser.parse(text);
      expect(result.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
    });

    it('detects embedded xpub text with lower confidence', () => {
      const text = 'prefix xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj suffix';
      const result = plainXpubParser.canParse(text);
      expect(result).toEqual({ detected: true, confidence: 40 });
    });

    it('parses zpub, ypub, and other prefixes', () => {
      const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
      const result = plainXpubParser.parse(zpub);
      expect(result.xpub).toBe(zpub);
    });

    it('returns empty parse result for non-string input or strings without xpub', () => {
      expect(plainXpubParser.parse(123 as unknown as string)).toEqual({});
      expect(plainXpubParser.parse('no xpub present here')).toEqual({});
    });
  });

  describe('Registry parseDeviceJson', () => {
    it('parses JSON string input', () => {
      const jsonString = JSON.stringify({
        xfp: 'FA79B6AA',
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
        deriv: "m/84'/0'/0'",
      });
      const result = parseDeviceJson(jsonString);
      expect(result).not.toBeNull();
      expect(result?.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
      expect(result?.fingerprint).toBe('FA79B6AA');
    });

    it('falls back to plain text parsing for invalid JSON', () => {
      const plainXpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
      const result = parseDeviceJson(plainXpub);
      expect(result).not.toBeNull();
      expect(result?.xpub).toBe(plainXpub);
    });

    it('returns null for unparseable content', () => {
      const result = parseDeviceJson('this is not valid content');
      expect(result).toBeNull();
    });

    it('includes format identifier in result', () => {
      const jsonString = JSON.stringify({
        xfp: 'FA79B6AA',
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
      });
      const result = parseDeviceJson(jsonString);
      expect(result?.format).toBe('simple-coldcard');
    });
  });

  describe('Registry parseDeviceData', () => {
    it('parses object input directly', () => {
      const data = {
        xfp: 'FA79B6AA',
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
      };
      const result = parseDeviceData(data);
      expect(result).not.toBeNull();
      expect(result?.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
    });

    it('parses string input', () => {
      const xpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
      const result = parseDeviceData(xpub);
      expect(result).not.toBeNull();
      expect(result?.xpub).toBe(xpub);
    });
  });

  describe('Priority-based Format Detection', () => {
    it('prefers higher priority parsers', () => {
      // Descriptor JSON has priority 92, simple-coldcard has 84
      const descriptorJson = {
        descriptor: "wpkh([fa79b6aa/84h/0h/0h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)#abcd1234",
        xfp: 'fa79b6aa',
        xpub: 'should-not-use-this',
      };
      const result = parseDeviceData(descriptorJson);
      // Should use descriptor parser, not simple-coldcard
      expect(result?.format).toBe('descriptor-json');
      expect(result?.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
    });

    it('uses coldcard-nested over coldcard-flat when both bip sections and flat keys present', () => {
      // In practice this shouldn't happen, but testing priority
      const mixedFormat = {
        xfp: 'FA79B6AA',
        bip84: {
          _pub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
          deriv: "m/84'/0'/0'",
        },
        p2wsh: 'Zpub74mMqDrTGjmahLnCEpF18LoRMJCp8Wu1x6dJXw8rfT2vfCHKn8f8uxXJQgAKmLB4vZKT7EfXwMrnk9z1wJZBgUPbK1rhMjYFRvG8cBb2HA1',
        p2wsh_deriv: "m/48'/0'/0'/2'",
      };
      const result = parseDeviceData(mixedFormat);
      // coldcard-nested has priority 90, coldcard-flat has 88
      expect(result?.format).toBe('coldcard-nested');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty object', () => {
      const result = parseDeviceData({});
      expect(result).toBeNull();
    });

    it('handles null', () => {
      const result = parseDeviceData(null);
      expect(result).toBeNull();
    });

    it('handles undefined', () => {
      const result = parseDeviceData(undefined);
      expect(result).toBeNull();
    });

    it('handles empty string', () => {
      const result = parseDeviceJson('');
      expect(result).toBeNull();
    });

    it('handles whitespace-only string', () => {
      const result = parseDeviceJson('   ');
      expect(result).toBeNull();
    });

    it('handles malformed JSON string', () => {
      const result = parseDeviceJson('{ invalid json }');
      expect(result).toBeNull();
    });

    it('handles xpub with extra whitespace', () => {
      const xpub = '  xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj  ';
      const result = parseDeviceJson(xpub);
      expect(result).not.toBeNull();
      expect(result?.xpub).toBe('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj');
    });
  });

  describe('Registry Stats', () => {
    it('returns correct parser count', () => {
      const stats = deviceParserRegistry.getStats();
      expect(stats.parserCount).toBeGreaterThanOrEqual(10);
    });

    it('lists all registered parsers', () => {
      const stats = deviceParserRegistry.getStats();
      const parserIds = stats.parsers.map(p => p.id);
      expect(parserIds).toContain('coldcard-nested');
      expect(parserIds).toContain('coldcard-flat');
      expect(parserIds).toContain('keystone-standard');
      expect(parserIds).toContain('keystone-multisig');
      expect(parserIds).toContain('descriptor-json');
      expect(parserIds).toContain('ledger');
      expect(parserIds).toContain('bitbox');
      expect(parserIds).toContain('plain-xpub');
    });
  });
});
