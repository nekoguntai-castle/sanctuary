/**
 * Real-transaction fixtures for missing-field population.
 *
 * Population authenticates every fetched transaction against the txid it was
 * requested by, so populate fixtures serve real serialized transactions under
 * their own `getId()` txids, in the exact shape the Electrum client returns.
 */

import { vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { decodeRawTransaction } from '../../../../../../src/services/bitcoin/electrum/methods';
import type { TransactionDetails } from '../../../../../../src/services/bitcoin/electrum/types';

/** A BIP34 height push, so a projected coinbase input keeps a truthy `coinbase` field. */
export const COINBASE_SCRIPT_SIG_HEX = '03a08601';

export type FixtureInput = { txid: string; vout: number } | 'coinbase';
export interface FixtureOutput {
  script: Uint8Array;
  valueSats: bigint;
}

export function walletOutput(n: number): { address: string; script: Uint8Array } {
  const payment = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, n), network: bitcoin.networks.bitcoin });
  return { address: payment.address!, script: payment.output! };
}

export function buildTransaction(spec: {
  inputs: FixtureInput[];
  outputs: FixtureOutput[];
  locktime?: number;
}): bitcoin.Transaction {
  if (spec.inputs.length === 0) {
    throw new Error('fixture transactions need at least one input');
  }
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = spec.locktime ?? 0;
  for (const input of spec.inputs) {
    if (input === 'coinbase') {
      tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(COINBASE_SCRIPT_SIG_HEX, 'hex'));
    } else {
      tx.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout);
    }
  }
  for (const output of spec.outputs) {
    tx.addOutput(output.script, output.valueSats);
  }
  return tx;
}

/** A one-input, one-output transaction; `seed` (one hex byte) names the dummy funding outpoint. */
export function payingTransaction(script: Uint8Array, valueSats: number, seed: string): bitcoin.Transaction {
  return buildTransaction({
    inputs: [{ txid: seed.repeat(32), vout: 0 }],
    outputs: [{ script, valueSats: BigInt(valueSats) }],
  });
}

/** An OP_RETURN script: an output with no address. */
export const OP_RETURN_SCRIPT = Uint8Array.from(Buffer.from('6a026869', 'hex'));

export function nodeDetails(
  tx: bitcoin.Transaction,
  metadata?: Record<string, unknown>,
): TransactionDetails & Record<string, unknown> {
  return { ...decodeRawTransaction(tx.toHex(), 'mainnet'), ...metadata };
}

export function serveNodeTransactions(entries: Array<[string, unknown]>) {
  const served = new Map(entries);
  return vi.fn(async (txid: string) => {
    const details = served.get(txid);
    if (details instanceof Error) throw details;
    return details ?? null;
  });
}
