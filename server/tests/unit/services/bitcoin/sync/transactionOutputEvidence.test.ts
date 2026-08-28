import { describe, expect, it } from 'vitest';
import {
  transactionOutputAddress,
  transactionOutputAddresses,
  transactionOutputScriptHex,
} from '../../../../../src/services/bitcoin/sync/transactionOutputEvidence';

describe('compact transaction output evidence', () => {
  it('prefers compact authenticated fields', () => {
    const output = {
      value: 1,
      scriptHex: '0014aa',
      address: 'bc1compact',
      scriptPubKey: {
        hex: 'legacy',
        address: 'bc1legacy',
        addresses: ['bc1legacy'],
      },
    };

    expect(transactionOutputScriptHex(output)).toBe('0014aa');
    expect(transactionOutputAddress(output)).toBe('bc1compact');
    expect(transactionOutputAddresses(output)).toEqual(['bc1compact']);
  });

  it('preserves nested verbose-client output compatibility', () => {
    const output = {
      value: 1,
      scriptPubKey: {
        hex: '0014bb',
        address: 'bc1direct',
        addresses: ['bc1listed'],
      },
    };

    expect(transactionOutputScriptHex(output)).toBe('0014bb');
    expect(transactionOutputAddress(output)).toBe('bc1direct');
    expect(transactionOutputAddresses(output)).toEqual(['bc1listed', 'bc1direct']);
  });

  it('does not duplicate a nested direct address already in the address list', () => {
    const output = {
      value: 1,
      scriptPubKey: { address: 'bc1same', addresses: ['bc1same'] },
    };

    expect(transactionOutputAddresses(output)).toEqual(['bc1same']);
  });

  it('returns empty evidence for absent outputs and script metadata', () => {
    expect(transactionOutputScriptHex(undefined)).toBeUndefined();
    expect(transactionOutputAddress({ value: 1 })).toBeUndefined();
    expect(transactionOutputAddresses(undefined)).toEqual([]);
    expect(transactionOutputAddresses({ value: 1 })).toEqual([]);
  });
});
