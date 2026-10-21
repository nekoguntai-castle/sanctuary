/**
 * Electrum txid case normalization.
 *
 * Address history and listunspent txids are canonical lowercase hex once
 * parsed: a case variant of an authenticated txid must not become a second
 * transaction or UTXO row (case-sensitive Postgres text keys).
 */

import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  getAddressHistory,
  getAddressHistoryBatch,
  getAddressUTXOs,
  getAddressUTXOsBatch,
} from '../../../../src/services/bitcoin/electrum/methods';
import {
  ElectrumResponseValidationError,
  UtxoItemSchema,
} from '../../../../src/services/bitcoin/electrum/types';

const ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

function realTxid(): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 7), 0);
  tx.addOutput(Buffer.from(`0014${'ab'.repeat(20)}`, 'hex'), BigInt(50_000));
  return tx.getId();
}

const LOWER = realTxid();
const UPPER = LOWER.toUpperCase();
const MIXED = [...LOWER].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char)).join('');
const NON_HEX = 'g'.repeat(64);

describe('electrum methods: txid case normalization', () => {
  it('lowercases an uppercase history txid', async () => {
    const request = vi.fn().mockResolvedValue([{ tx_hash: UPPER, height: 100 }]);

    const history = await getAddressHistory(request, ADDRESS, 'testnet3');

    expect(history).toStrictEqual([{ tx_hash: LOWER, height: 100 }]);
  });

  it('lowercases a mixed-case history txid in a batch', async () => {
    expect(MIXED).not.toBe(LOWER);
    const batchRequest = vi.fn().mockResolvedValue([[{ tx_hash: MIXED, height: 100 }]]);

    const histories = await getAddressHistoryBatch(batchRequest, [ADDRESS], 'testnet3');

    expect(histories.get(ADDRESS)).toStrictEqual([{ tx_hash: LOWER, height: 100 }]);
  });

  it('lowercases uppercase listunspent txids, single and batched', async () => {
    const utxo = { tx_hash: UPPER, tx_pos: 0, height: 100, value: 50_000 };
    const request = vi.fn().mockResolvedValue([utxo]);
    const batchRequest = vi.fn().mockResolvedValue([[utxo]]);

    const single = await getAddressUTXOs(request, ADDRESS, 'testnet3');
    const batched = await getAddressUTXOsBatch(batchRequest, [ADDRESS], 'testnet3');

    expect(single).toStrictEqual([{ ...utxo, tx_hash: LOWER }]);
    expect(batched.get(ADDRESS)).toStrictEqual([{ ...utxo, tx_hash: LOWER }]);
  });

  it('lowercases the txid when the sync phase re-parses a listunspent item', () => {
    const parsed = UtxoItemSchema.safeParse({ tx_hash: UPPER, tx_pos: 0, height: 1, value: 1 });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.tx_hash).toBe(LOWER);
  });

  it('rejects a 64-character txid that is not hex', async () => {
    const request = vi.fn().mockResolvedValue([{ tx_hash: NON_HEX, height: 100 }]);
    const batchRequest = vi.fn().mockResolvedValue([[{ tx_hash: NON_HEX, tx_pos: 0, height: 100, value: 1 }]]);

    await expect(getAddressHistory(request, ADDRESS, 'testnet3'))
      .rejects.toBeInstanceOf(ElectrumResponseValidationError);
    const batched = await getAddressUTXOsBatch(batchRequest, [ADDRESS], 'testnet3');
    expect(batched.has(ADDRESS)).toBe(false);
  });

  it('returns lowercase txids unchanged', async () => {
    const request = vi.fn().mockResolvedValue([{ tx_hash: LOWER, height: 100 }]);

    await expect(getAddressHistory(request, ADDRESS, 'testnet3'))
      .resolves.toStrictEqual([{ tx_hash: LOWER, height: 100 }]);
    expect(UtxoItemSchema.parse({ tx_hash: LOWER, tx_pos: 1, height: 1, value: 1 }).tx_hash).toBe(LOWER);
  });
});
