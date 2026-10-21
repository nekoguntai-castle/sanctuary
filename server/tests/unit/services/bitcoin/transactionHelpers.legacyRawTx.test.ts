import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

const { mockGetTransaction } = vi.hoisted(() => ({ mockGetTransaction: vi.fn() }));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({ getTransaction: mockGetTransaction }),
}));

import { decodeRawTransaction } from '../../../../src/services/bitcoin/electrum/methods';
import { getRawTransactionHex } from '../../../../src/services/bitcoin/transactions/helpers';
import { fetchRawTransactionsForLegacy } from '../../../../src/services/bitcoin/transactions/psbtConstruction';
import { RawTransactionEvidenceError } from '../../../../src/services/bitcoin/rawTransactionEvidence';

function legacyFundingTransaction(salt: number): bitcoin.Transaction {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32, salt), 0);
  const script = bitcoin.payments.p2pkh({ hash: Buffer.alloc(20, salt), network: bitcoin.networks.testnet }).output!;
  transaction.addOutput(script, 100_000n);
  return transaction;
}

/** Serves what a real node client returns: the locally decoded transaction object, never a bare hex string. */
function serveDecoded(...transactions: bitcoin.Transaction[]): void {
  const decoded = new Map(transactions.map(transaction => [
    transaction.getId(), decodeRawTransaction(transaction.toHex(), 'testnet3'),
  ]));
  mockGetTransaction.mockImplementation(async (txid: string) => decoded.get(txid));
}

describe('legacy raw-transaction helpers', () => {
  const funding = legacyFundingTransaction(1);
  const txid = funding.getId();

  beforeEach(() => {
    mockGetTransaction.mockReset();
  });

  it('returns the authenticated raw hex string, not the decoded object', async () => {
    serveDecoded(funding);

    const rawHex = await getRawTransactionHex(txid, 'testnet3');

    expect(typeof rawHex).toBe('string');
    expect(rawHex).toBe(funding.toHex());
  });

  it('builds the legacy nonWitnessUtxo cache from the transaction bytes', async () => {
    serveDecoded(funding);

    const cache = await fetchRawTransactionsForLegacy([txid, txid], 'testnet3');

    expect(cache.size).toBe(1);
    expect(cache.get(txid)).toEqual(Buffer.from(funding.toBuffer()));
    expect(mockGetTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a transaction served under a txid it does not hash to', async () => {
    const other = legacyFundingTransaction(2);
    mockGetTransaction.mockResolvedValue(decodeRawTransaction(other.toHex(), 'testnet3'));

    const error = await getRawTransactionHex(txid, 'testnet3').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RawTransactionEvidenceError);
    expect((error as RawTransactionEvidenceError).reason).toBe('txid_mismatch');
  });
});
