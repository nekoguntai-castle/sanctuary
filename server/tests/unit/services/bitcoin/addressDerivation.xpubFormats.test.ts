import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';

import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  convertXpubToFormat,
  deriveAddress,
  validateXpub,
} from '../../../../src/services/bitcoin/addressDerivation';
import { testXpubs } from '../../../fixtures/bitcoin';

describe('Address Derivation Service validateXpub', () => {
  it('should validate correct mainnet xpub', () => {
    const xpub = testXpubs.mainnet.bip44;

    const result = validateXpub(xpub, 'mainnet');

    expect(result.valid).toBe(true);
  });

  it('should validate correct testnet tpub', () => {
    const tpub = testXpubs.testnet.bip84;

    const result = validateXpub(tpub, 'testnet');

    expect(result.valid).toBe(true);
  });

  it('should reject invalid xpub', () => {
    const result = validateXpub('invalid-xpub', 'mainnet');

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject truncated xpub', () => {
    const truncated = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshk';

    const result = validateXpub(truncated, 'mainnet');

    expect(result.valid).toBe(false);
  });

  it('should validate zpub format', () => {
    const zpub = testXpubs.mainnet.bip84;
    expect(zpub).toMatch(/^zpub/);

    const result = validateXpub(zpub, 'mainnet');

    expect(result.valid).toBe(true);
    expect(result.scriptType).toBe('native_segwit');
  });

  it('should validate ypub format', () => {
    const ypub = testXpubs.mainnet.bip49;

    const result = validateXpub(ypub, 'mainnet');

    expect(result.valid).toBe(true);
    expect(result.scriptType).toBe('nested_segwit');
  });

  it('should validate lowercase vpub format', () => {
    const vpub = 'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc';

    const result = validateXpub(vpub, 'testnet');

    expect(result.valid).toBe(true);
    expect(result.scriptType).toBe('native_segwit');
  });

  it('defaults script type when validating a non-public but structurally valid extended key prefix', () => {
    const xprv = bip32.fromSeed(Buffer.alloc(32, 1), bitcoin.networks.bitcoin).toBase58();

    const result = validateXpub(xprv, 'mainnet');

    expect(result.valid).toBe(true);
    expect(result.scriptType).toBe('native_segwit');
  });
});

describe('Address Derivation Service convertXpubToFormat', () => {
  const testZpub = 'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';
  const testXpub = testXpubs.mainnet.bip44;
  const testTpub = testXpubs.testnet.bip84;

  describe('Zpub to xpub conversion', () => {
    it('should convert Zpub to xpub format', () => {
      const result = convertXpubToFormat(testZpub, 'xpub');

      expect(result).toMatch(/^xpub/);
      expect(result).not.toBe(testZpub);
      expect(result.length).toBeGreaterThan(100);
    });

    it('should preserve key data during Zpub to xpub conversion', () => {
      const converted = convertXpubToFormat(testZpub, 'xpub');

      const zpubAddr = deriveAddress(testZpub, 0, { network: 'mainnet' });
      const xpubAddr = deriveAddress(converted, 0, { network: 'mainnet' });

      expect(Buffer.from(zpubAddr.publicKey).equals(Buffer.from(xpubAddr.publicKey))).toBe(true);
    });
  });

  describe('Identity conversions', () => {
    it('should return xpub unchanged when converting xpub to xpub', () => {
      const result = convertXpubToFormat(testXpub, 'xpub');

      expect(result).toBe(testXpub);
    });

    it('should return tpub unchanged when converting tpub to tpub', () => {
      const result = convertXpubToFormat(testTpub, 'tpub');

      expect(result).toBe(testTpub);
    });
  });

  describe('xpub to Zpub conversion', () => {
    it('should convert xpub to Zpub format', () => {
      const result = convertXpubToFormat(testXpub, 'Zpub');

      expect(result).toMatch(/^Zpub/);
      expect(result).not.toBe(testXpub);
    });

    it('should round-trip xpub -> Zpub -> xpub', () => {
      const zpub = convertXpubToFormat(testXpub, 'Zpub');
      const backToXpub = convertXpubToFormat(zpub, 'xpub');

      expect(backToXpub).toBe(testXpub);
    });
  });

  describe('Testnet conversions', () => {
    it('should convert tpub to Vpub format', () => {
      const result = convertXpubToFormat(testTpub, 'Vpub');

      expect(result).toMatch(/^Vpub/);
      expect(result).not.toBe(testTpub);
    });

    it('should round-trip tpub -> Vpub -> tpub', () => {
      const vpub = convertXpubToFormat(testTpub, 'Vpub');
      const backToTpub = convertXpubToFormat(vpub, 'tpub');

      expect(backToTpub).toBe(testTpub);
    });
  });

  describe('Error handling', () => {
    it('should return original xpub if conversion fails', () => {
      const invalidXpub = 'not-an-xpub';
      const result = convertXpubToFormat(invalidXpub, 'xpub');

      expect(result).toBe(invalidXpub);
    });

    it('should return original key for truncated xpub', () => {
      const truncatedXpub = 'xpub6BosfCnifzxcFwrSzQi';
      const result = convertXpubToFormat(truncatedXpub, 'Zpub');

      expect(result).toBe(truncatedXpub);
    });
  });
});
