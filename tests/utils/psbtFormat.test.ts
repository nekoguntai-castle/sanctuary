import { describe, expect, it } from 'vitest';

import {
  BASE64_TEXT_PATTERN,
  HEX_TEXT_PATTERN,
  base64ToBytes,
  bytesToBase64,
  hasBip174BinaryPsbtMagic,
  hasPsbtMagicBytes,
  hasPsbtMagicText,
  hexTextToBytes,
} from '../../src/utils/psbtFormat';

describe('psbtFormat', () => {
  it('detects PSBT magic bytes separately from strict BIP-174 binary magic', () => {
    const psbtPrefixOnly = new Uint8Array([0x70, 0x73, 0x62, 0x74]);
    const bip174Binary = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);
    const nonPsbt = new Uint8Array([0x70, 0x73, 0x62, 0x73, 0xff]);

    expect(hasPsbtMagicBytes(psbtPrefixOnly)).toBe(true);
    expect(hasBip174BinaryPsbtMagic(psbtPrefixOnly)).toBe(false);
    expect(hasBip174BinaryPsbtMagic(bip174Binary)).toBe(true);
    expect(hasPsbtMagicBytes(nonPsbt)).toBe(false);
  });

  it('detects decoded PSBT text magic without changing caller-specific base64 handling', () => {
    expect(hasPsbtMagicText('psbt\xffpayload')).toBe(true);
    expect(hasPsbtMagicText('not-psbt')).toBe(false);
  });

  it('converts base64, bytes, and hex through small format helpers', () => {
    const bytes = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01]);
    const base64 = bytesToBase64(bytes);

    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(bytes));
    expect(Array.from(hexTextToBytes('70 73 62 74 ff 01'))).toEqual(Array.from(bytes));
    expect(Array.from(hexTextToBytes(''))).toEqual([]);
  });

  it('exports text patterns used by flow-specific parsers', () => {
    expect(BASE64_TEXT_PATTERN.test('cHNidP8=\n')).toBe(true);
    expect(BASE64_TEXT_PATTERN.test('not-base64!')).toBe(false);
    expect(HEX_TEXT_PATTERN.test('70 73 62 74 ff')).toBe(true);
    expect(HEX_TEXT_PATTERN.test('70zz')).toBe(false);
  });
});
