import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { RawTransactionEvidenceError } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import { authenticateTransactionDetails } from '../../../../../src/services/bitcoin/blockchain/receiveEvidenceAuthentication';

const makeTransaction = (): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(
    bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    }).output!,
    42_000n,
  );
  return transaction;
};

const makeAddressTransaction = (network: bitcoin.Network): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.addInput(new Uint8Array(32).fill(1), 3, 0xfffffffd, Uint8Array.from([0x51]));
  transaction.addOutput(
    bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      network,
    }).output!,
    500n,
  );
  transaction.addOutput(Uint8Array.from([0x6a]), 0n);
  return transaction;
};

describe('single-address receive evidence authentication', () => {
  it('normalizes transaction inputs and outputs from authenticated raw bytes', () => {
    const transaction = makeTransaction();
    const result = authenticateTransactionDetails(transaction.getId(), {
      txid: transaction.getId(),
      hex: transaction.toHex(),
      // Deliberately hostile structured fields must not survive normalization.
      vin: [{ txid: 'ff'.repeat(32), vout: 9 }],
      vout: [{ value: 21, n: 7, scriptPubKey: { hex: '51', address: 'wrong' } }],
      time: 123,
    }, 'testnet3');

    expect(result.txid).toBe(transaction.getId());
    expect(result.hex).toBe(transaction.toHex());
    expect(result.time).toBe(123);
    expect(result.vout).toEqual([expect.objectContaining({
      n: 0,
      value: 0.00042,
      scriptPubKey: expect.objectContaining({
        hex: Buffer.from(transaction.outs[0].script).toString('hex'),
      }),
    })]);
    expect(result.vin?.[0]).toMatchObject({ txid: '0'.repeat(64), vout: 0xffffffff });
  });

  it.each([
    ['mainnet', bitcoin.networks.bitcoin, 'bc1'],
    ['regtest', bitcoin.networks.regtest, 'bcrt1'],
  ] as const)('decodes output addresses on the exact %s network', (networkName, network, prefix) => {
    const transaction = makeAddressTransaction(network);
    const result = authenticateTransactionDetails(transaction.getId(), {
      txid: transaction.getId(),
      hex: transaction.toHex(),
    }, networkName);

    expect(result.vout?.[0].scriptPubKey.address).toMatch(new RegExp(`^${prefix}`));
    expect(result.vout?.[0].scriptPubKey.addresses).toEqual([
      result.vout?.[0].scriptPubKey.address,
    ]);
  });

  it('normalizes non-coinbase inputs and preserves non-address output scripts', () => {
    const transaction = makeAddressTransaction(bitcoin.networks.testnet);
    const result = authenticateTransactionDetails(transaction.getId(), {
      txid: transaction.getId(),
      hex: transaction.toHex(),
      time: 'not-a-number',
    }, 'signet');

    expect(result.time).toBeUndefined();
    expect(result.vin?.[0]).toEqual({
      txid: '01'.repeat(32),
      vout: 3,
      sequence: 0xfffffffd,
    });
    expect(result.vout?.[1]).toMatchObject({
      n: 1,
      value: 0,
      scriptPubKey: { hex: '6a', address: undefined, addresses: [] },
    });
  });

  it.each([
    { candidate: undefined, reason: 'malformed_raw_transaction' },
    { candidate: {}, reason: 'malformed_raw_transaction' },
    { candidate: { txid: 'not-a-txid', hex: makeTransaction().toHex() }, reason: 'txid_mismatch' },
    { candidate: { txid: '11'.repeat(32), hex: makeTransaction().toHex() }, reason: 'txid_mismatch' },
  ] as const)('rejects missing or mismatched provider identity %#', ({ candidate, reason }) => {
    const transaction = makeTransaction();
    expect(() => authenticateTransactionDetails(
      transaction.getId(),
      candidate,
      'testnet3',
    )).toThrow(expect.objectContaining<Partial<RawTransactionEvidenceError>>({ reason }));
  });

  it('rejects raw bytes whose computed txid differs from both requested identities', () => {
    const transaction = makeTransaction();
    const expectedTxid = '22'.repeat(32);
    expect(() => authenticateTransactionDetails(expectedTxid, {
      txid: expectedTxid,
      hex: transaction.toHex(),
    }, 'testnet3')).toThrow(expect.objectContaining<Partial<RawTransactionEvidenceError>>({
      reason: 'txid_mismatch',
    }));
  });
});
