import { describe, it, expect } from 'vitest';
import {
  BitcoinAddressSchema,
  EmailSchema,
  UsernameSchema,
  TxidSchema,
  XpubSchema,
  DerivationPathSchema,
  FingerprintSchema,
  PaginationSchema,
  FeeRateSchema,
  OptionalStringSchema,
} from '../../../../src/api/schemas/common';

describe('Common Schemas', () => {
  it('validates email and lowercases', () => {
    const result = EmailSchema.parse('TEST@EXAMPLE.COM');
    expect(result).toBe('test@example.com');
  });

  it('validates username rules', () => {
    expect(UsernameSchema.safeParse('abc_123').success).toBe(true);
    expect(UsernameSchema.safeParse('ab').success).toBe(false);
  });

  it('normalizes usernames to trimmed lowercase', () => {
    expect(UsernameSchema.parse('  Mixed_Case123  ')).toBe('mixed_case123');
    expect(UsernameSchema.safeParse('   ').success).toBe(false);
  });

  it('normalizes optional strings', () => {
    expect(OptionalStringSchema.parse('hello')).toBe('hello');
    expect(OptionalStringSchema.parse('')).toBeUndefined();
    expect(OptionalStringSchema.parse(undefined)).toBeUndefined();
  });

  it('validates bitcoin address formats', () => {
    expect(BitcoinAddressSchema.safeParse('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh').success).toBe(true);
    expect(BitcoinAddressSchema.safeParse('not-an-address').success).toBe(false);
  });

  it('validates txid format', () => {
    expect(TxidSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(TxidSchema.safeParse('abc').success).toBe(false);
  });

  it('validates xpub format', () => {
    expect(XpubSchema.safeParse('xpub' + 'a'.repeat(79)).success).toBe(true);
    expect(XpubSchema.safeParse('xpub-short').success).toBe(false);
  });

  it('validates derivation path', () => {
    expect(DerivationPathSchema.safeParse("m/84'/0'/0'").success).toBe(true);
    expect(DerivationPathSchema.safeParse('m/invalid/path').success).toBe(false);
  });

  it('validates fingerprint', () => {
    expect(FingerprintSchema.safeParse('abcdef12').success).toBe(true);
    expect(FingerprintSchema.safeParse('xyz').success).toBe(false);
  });

  it('applies pagination defaults', () => {
    const result = PaginationSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('validates fee rate minimum', () => {
    expect(FeeRateSchema.safeParse(1).success).toBe(true);
    expect(FeeRateSchema.safeParse(0).success).toBe(false);
  });
});
