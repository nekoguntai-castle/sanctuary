import { describe, expect, it } from 'vitest';
import {
  btcAmountToSatoshiString,
  parsePositiveSatoshiAmount,
  requirePositiveSatoshiAmount,
  requirePositiveSatoshiNumber,
} from '../../src/utils/sendAmount';

describe('send amount boundaries', () => {
  it.each([
    ['', null],
    ['.', null],
    ['0', null],
    ['-1', null],
    ['0.000000006', null],
    ['0.00000001', '1'],
    ['.5', '50000000'],
    ['1.00000000', '100000000'],
    ['90071992.54740991', '9007199254740991'],
    ['90071992.54740992', null],
  ])('converts BTC %j exactly', (value, expected) => {
    expect(btcAmountToSatoshiString(value)).toBe(expected);
  });

  it.each([
    ['', null],
    ['.', null],
    ['0', null],
    ['-1', null],
    ['1.5', null],
    ['NaN', null],
    ['Infinity', null],
    ['1', 1],
    ['0001', 1],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['9007199254740992', null],
  ])('parses normalized satoshis %j strictly', (value, expected) => {
    expect(parsePositiveSatoshiAmount(value)).toBe(expected);
  });

  it('throws at required string and number boundaries', () => {
    expect(requirePositiveSatoshiAmount('1')).toBe(1);
    expect(requirePositiveSatoshiNumber(1)).toBe(1);
    expect(() => requirePositiveSatoshiAmount('.')).toThrow('Invalid amount');
    expect(() => requirePositiveSatoshiNumber(Number.POSITIVE_INFINITY)).toThrow('Invalid amount');
  });
});
