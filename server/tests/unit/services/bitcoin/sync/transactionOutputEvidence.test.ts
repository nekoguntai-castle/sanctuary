import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  createBoundedTransactionOutputAddressResolver,
  transactionOutputAddress,
  transactionOutputAddressForNetwork,
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
    expect(transactionOutputAddressForNetwork(output, 'mainnet')).toBe('bc1compact');
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

  it.each([
    ['mainnet', bitcoin.networks.bitcoin],
    ['testnet', bitcoin.networks.testnet],
    ['regtest', bitcoin.networks.regtest],
  ] as const)('decodes compact authenticated scripts lazily on %s', (networkName, network) => {
    const payment = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network });
    const output = { value: 1, scriptHex: Buffer.from(payment.output!).toString('hex') };

    expect(transactionOutputAddressForNetwork(output, networkName)).toBe(payment.address);
    expect(transactionOutputAddressForNetwork({ value: 1, scriptHex: '51' }, networkName))
      .toBeUndefined();
  });

  it('memoizes successful and failed decodes within its fixed entry ceiling', () => {
    const decode = vi.fn((output: { scriptHex?: string } | undefined) => (
      output?.scriptHex === 'aa' ? 'decoded-address' : undefined
    ));
    const resolve = createBoundedTransactionOutputAddressResolver('mainnet', 2, decode);

    expect(resolve({ value: 1, scriptHex: 'aa' })).toBe('decoded-address');
    expect(resolve({ value: 1, scriptHex: 'aa' })).toBe('decoded-address');
    expect(resolve({ value: 1, scriptHex: 'bb' })).toBeUndefined();
    expect(resolve({ value: 1, scriptHex: 'bb' })).toBeUndefined();
    expect(resolve({ value: 1, scriptHex: 'cc' })).toBeUndefined();
    expect(resolve({ value: 1, scriptHex: 'cc' })).toBeUndefined();
    expect(resolve({ value: 1 })).toBeUndefined();
    expect(resolve({ value: 1, address: 'explicit' })).toBe('explicit');
    expect(decode).toHaveBeenCalledTimes(4);
  });
});
