import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  authenticateNodeTransaction,
  fetchAuthenticatedPrevout,
  fetchAuthenticatedTransaction,
} from '../../../../src/services/bitcoin/nodeTransactionAuthentication';
import { RawTransactionEvidenceError } from '../../../../src/services/bitcoin/rawTransactionEvidence';

function transactionWithOutput(valueSats: bigint): bitcoin.Transaction {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32, 9), 0);
  transaction.addOutput(Buffer.from(`0014${'ab'.repeat(20)}`, 'hex'), valueSats);
  return transaction;
}

function clientServing(details: unknown) {
  return { getTransaction: vi.fn().mockResolvedValue(details) };
}

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof RawTransactionEvidenceError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('nodeTransactionAuthentication', () => {
  const transaction = transactionWithOutput(123_456n);
  const txid = transaction.getId();
  const hex = transaction.toHex();

  it('authenticates fetched details whose bytes hash to the requested txid', () => {
    const authenticated = authenticateNodeTransaction(txid, { txid, hex });
    expect(authenticated.txid).toBe(txid);
    expect(authenticated.canonicalHex).toBe(hex);
    expect(authenticated.transaction.getId()).toBe(txid);
  });

  it('accepts an uppercase expected txid', () => {
    expect(authenticateNodeTransaction(txid.toUpperCase(), { hex }).txid).toBe(txid);
  });

  it.each([
    ['undefined hex', { txid }],
    ['object hex', { txid, hex: { raw: hex } }],
    ['null details', null],
    ['undefined details', undefined],
  ])('rejects %s as a malformed raw transaction', (_label, details) => {
    expect(reasonOf(() => authenticateNodeTransaction(txid, details))).toBe('malformed_raw_transaction');
  });

  it('rejects bytes of another transaction served under the requested txid', () => {
    const other = transactionWithOutput(1n).toHex();
    expect(reasonOf(() => authenticateNodeTransaction(txid, { txid, hex: other }))).toBe('txid_mismatch');
  });

  it('fetches a transaction with a single node lookup', async () => {
    const client = clientServing({ txid, hex });
    const authenticated = await fetchAuthenticatedTransaction(client, txid);
    expect(authenticated.canonicalHex).toBe(hex);
    expect(client.getTransaction).toHaveBeenCalledTimes(1);
    expect(client.getTransaction).toHaveBeenCalledWith(txid);
  });

  it('returns the prevout value and script from the authenticated bytes, not the decoded projection', async () => {
    const client = clientServing({ txid, hex, vout: [{ value: 99, scriptPubKey: { hex: '51' } }] });
    const prevout = await fetchAuthenticatedPrevout(client, txid, 0);
    expect(prevout).toEqual({
      valueSats: 123_456,
      scriptPubKeyHex: `0014${'ab'.repeat(20)}`,
      canonicalHex: hex,
    });
    expect(typeof prevout.valueSats).toBe('number');
    expect(client.getTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing prevout index', async () => {
    const error = await fetchAuthenticatedPrevout(clientServing({ hex }), txid, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RawTransactionEvidenceError);
    expect((error as RawTransactionEvidenceError).reason).toBe('missing_output');
  });

  it('rejects a prevout whose details carry no hex', async () => {
    const error = await fetchAuthenticatedPrevout(clientServing({ txid }), txid, 0).catch((e: unknown) => e);
    expect((error as RawTransactionEvidenceError).reason).toBe('malformed_raw_transaction');
  });
});
