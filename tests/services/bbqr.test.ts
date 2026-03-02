/**
 * BBQr decoder tests
 */

import { describe, expect, it } from 'vitest';
import {
  BBQrDecoder,
  BBQrEncodings,
  BBQrFileTypes,
  decodeBase32,
  decodeHex,
  extractBBQrData,
  isBBQr,
  parseBBQrHeader,
} from '../../services/bbqr';

describe('BBQr helpers', () => {
  it('detects BBQr prefixes', () => {
    expect(isBBQr('B$HP0100ABC')).toBe(true);
    expect(isBBQr('not-bbqr')).toBe(false);
  });

  it('parses valid headers and rejects invalid metadata', () => {
    expect(parseBBQrHeader('B$HP0201ABC')).toEqual({
      encoding: 'H',
      fileType: 'P',
      totalParts: 2,
      partIndex: 1,
    });

    expect(parseBBQrHeader('B$XP0201ABC')).toBeNull();
    expect(parseBBQrHeader('B$H?0201ABC')).toBeNull();
    expect(parseBBQrHeader('short')).toBeNull();
  });

  it('extracts payload after header', () => {
    expect(extractBBQrData('B$HP0100AABB')).toBe('AABB');
  });

  it('decodes hex and validates malformed hex', () => {
    expect(Array.from(decodeHex('48656C6C6F'))).toEqual(Array.from(Buffer.from('Hello')));
    expect(() => decodeHex('ABC')).toThrow('odd length');
    expect(() => decodeHex('GG')).toThrow('Invalid hex character');
  });

  it('decodes base32 and validates malformed base32', () => {
    expect(Array.from(decodeBase32('MZXW6'))).toEqual(Array.from(Buffer.from('foo')));
    expect(() => decodeBase32('MZXW6!')).toThrow('Invalid Base32 character');
  });

  it('exports known encoding and file type labels', () => {
    expect(BBQrEncodings.H).toBe('Hex');
    expect(BBQrFileTypes.P).toBe('PSBT');
  });
});

describe('BBQrDecoder', () => {
  it('tracks receive errors and progress', () => {
    const decoder = new BBQrDecoder();
    expect(decoder.receivePart('bad')).toBe(false);
    expect(decoder.getError()).toBe('Invalid BBQr header');
    expect(decoder.getProgress()).toBe(0);
    expect(decoder.isComplete()).toBe(false);
  });

  it('rejects mismatched part metadata', () => {
    const decoder = new BBQrDecoder();
    expect(decoder.receivePart('B$HP0200AAAA')).toBe(true);

    expect(decoder.receivePart('B$HP0301BBBB')).toBe(false);
    expect(decoder.getError()).toContain('Part count mismatch');

    decoder.reset();
    expect(decoder.receivePart('B$HP0200AAAA')).toBe(true);
    expect(decoder.receivePart('B$2P0201BBBB')).toBe(false);
    expect(decoder.getError()).toContain('Encoding mismatch');

    decoder.reset();
    expect(decoder.receivePart('B$HP0200AAAA')).toBe(true);
    expect(decoder.receivePart('B$HJ0201BBBB')).toBe(false);
    expect(decoder.getError()).toContain('File type mismatch');
  });

  it('reports missing part indices when packet set is incomplete', () => {
    const decoder = new BBQrDecoder();
    expect(decoder.receivePart('B$HP0300AAAA')).toBe(true);
    expect(decoder.receivePart('B$HP0302CCCC')).toBe(true);

    expect(decoder.isComplete()).toBe(false);
    expect(decoder.getReceivedCount()).toBe(2);
    expect(decoder.getTotalParts()).toBe(3);
    expect(decoder.getMissingParts()).toEqual([1]);
  });

  it('decodes complete hex text payloads', () => {
    const text = '{"ok":true}';
    const hex = Buffer.from(text, 'utf8').toString('hex').toUpperCase();
    const part0 = hex.slice(0, Math.ceil(hex.length / 2));
    const part1 = hex.slice(Math.ceil(hex.length / 2));

    const decoder = new BBQrDecoder();
    expect(decoder.receivePart(`B$HJ0200${part0}`)).toBe(true);
    expect(decoder.receivePart(`B$HJ0201${part1}`)).toBe(true);

    expect(decoder.getReceivedCount()).toBe(2);
    expect(decoder.getTotalParts()).toBe(2);
    expect(decoder.getMissingParts()).toEqual([]);
    expect(decoder.getEncoding()).toBe('H');
    expect(decoder.getFileType()).toBe('J');
    expect(decoder.isComplete()).toBe(true);
    expect(decoder.getProgress()).toBe(100);

    const result = decoder.decode();
    expect(result.fileType).toBe('J');
    expect(result.text).toBe(text);
    expect(Buffer.from(result.data).toString('utf8')).toBe(text);
  });

  it('decodes complete base32 payloads', () => {
    const decoder = new BBQrDecoder();
    expect(decoder.receivePart('B$2U0100MZXW6')).toBe(true); // "foo"
    const result = decoder.decode();
    expect(result.fileType).toBe('U');
    expect(result.text).toBe('foo');
  });

  it('decodes non-text file types without attaching text payload', () => {
    const decoder = new BBQrDecoder();
    expect(decoder.receivePart('B$HP010048656C6C6F')).toBe(true); // "Hello"
    const result = decoder.decode();
    expect(result.fileType).toBe('P');
    expect(result.text).toBeUndefined();
    expect(Buffer.from(result.data).toString('utf8')).toBe('Hello');
  });

  it('throws when decoding incomplete data', () => {
    const decoder = new BBQrDecoder();
    decoder.receivePart('B$HP0200AA');
    expect(() => decoder.decode()).toThrow('not all parts received');
  });

  it('throws for unsupported Z encoding', () => {
    const decoder = new BBQrDecoder();
    decoder.receivePart('B$ZP0100ABCDEF');
    expect(decoder.isComplete()).toBe(true);
    expect(() => decoder.decode()).toThrow('not currently supported');
  });

  it('throws when an expected part index is missing', () => {
    const decoder = new BBQrDecoder();
    decoder.receivePart('B$HP0101AA');
    // Force metadata to look complete while missing index 0.
    (decoder as any)._totalParts = 1;
    expect(decoder.isComplete()).toBe(true);
    expect(() => decoder.decode()).toThrow('Missing part 0');
  });

  it('throws on unknown encoding branch', () => {
    const decoder = new BBQrDecoder();
    decoder.receivePart('B$HP0100AA');
    (decoder as any)._encoding = 'X';
    expect(() => decoder.decode()).toThrow('Unknown encoding: X');
  });
});
