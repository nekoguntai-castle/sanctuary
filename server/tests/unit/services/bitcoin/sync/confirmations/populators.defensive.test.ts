/**
 * Defensive guards in the exported field populators.
 *
 * Population only hands these functions authenticated byte projections, which
 * always carry vin/vout arrays and inputs with a txid and vout. The guards stay
 * because the exported signatures allow other shapes; they are exercised here
 * directly.
 */

import { describe, expect, it } from 'vitest';

import {
  populateAddressId,
  populateBlockHeight,
  populateBlockTime,
  populateCounterpartyAddress,
  populateFee,
} from '../../../../../../src/services/bitcoin/sync/confirmations/fieldPopulators';
import type { PopulationStats } from '../../../../../../src/services/bitcoin/sync/confirmations/types';
import type {
  RawTransaction,
  TransactionInput,
  TransactionOutput,
} from '../../../../../../src/services/bitcoin/sync/types';

const WALLET_ADDRESS = 'wallet-addr';

function emptyStats(): PopulationStats {
  return {
    feesPopulated: 0,
    blockHeightsPopulated: 0,
    blockTimesPopulated: 0,
    counterpartyAddressesPopulated: 0,
    addressIdsPopulated: 0,
  };
}

function throwingOutput(): TransactionOutput {
  const output = {} as TransactionOutput;
  Object.defineProperty(output, 'value', {
    get() {
      throw new Error('value parse error');
    },
  });
  Object.defineProperty(output, 'scriptPubKey', {
    get() {
      throw new Error('script parse error');
    },
  });
  return output;
}

function parentCache(valueSats: number): Map<string, RawTransaction> {
  return new Map([[
    'parent',
    { txid: 'parent', vin: [], vout: [{ value: valueSats / 100_000_000, address: 'sender' }] },
  ]]);
}

function feeFor(inputs: TransactionInput[], outputs: TransactionOutput[], prevTxCache = parentCache(100_000)) {
  const updates: Record<string, unknown> = {};
  const stats = emptyStats();
  populateFee(
    { fee: null, type: 'sent', amount: BigInt(-90_000), txid: 'child' },
    inputs, outputs, prevTxCache, true, false, updates, stats,
  );
  return { updates, stats };
}

function counterpartyFor(inputs: TransactionInput[], outputs: TransactionOutput[], isSentTx: boolean) {
  const updates: Record<string, unknown> = {};
  populateCounterpartyAddress(
    { counterpartyAddress: null, txid: 'child' },
    inputs, outputs, parentCache(100_000), new Set([WALLET_ADDRESS]), isSentTx, !isSentTx, updates, emptyStats(),
  );
  return updates;
}

describe('field populators: defensive guards', () => {
  it('computes a fee from a resolved parent output (control)', () => {
    expect(feeFor([{ txid: 'parent', vout: 0 }], [{ value: 0.0009 }]).updates).toStrictEqual({ fee: BigInt(10_000) });
  });

  it('leaves the fee unset for inputs without a vout or a txid', () => {
    expect(feeFor([{ txid: 'parent' }], [{ value: 0.0009 }]).updates).toStrictEqual({});
    expect(feeFor([{ vout: 0 }], [{ value: 0.0009 }]).updates).toStrictEqual({});
  });

  it('survives an output whose fields throw while computing the fee', () => {
    const { updates, stats } = feeFor([{ txid: 'parent', vout: 0 }], [throwingOutput()]);
    expect(updates).toStrictEqual({});
    expect(stats.feesPopulated).toBe(0);
  });

  it('takes the received counterparty only from an input with a txid and vout', () => {
    expect(counterpartyFor([{ txid: 'parent' }, { vout: 0 }], [], false)).toStrictEqual({});
    expect(counterpartyFor([{ vout: 0 }, { txid: 'parent', vout: 0 }], [], false))
      .toStrictEqual({ counterpartyAddress: 'sender' });
  });

  it('survives an output whose fields throw while resolving the sent counterparty', () => {
    expect(counterpartyFor([], [throwingOutput()], true)).toStrictEqual({});
  });

  it('treats details without vout as having no wallet output for the received addressId', () => {
    const updates: Record<string, unknown> = {};
    populateAddressId(
      { addressId: null, type: 'received' },
      { txid: 'child', vin: [] } as unknown as RawTransaction,
      [{ id: 'addr-1', address: WALLET_ADDRESS }],
      new Map([[WALLET_ADDRESS, 'addr-1']]),
      new Set([WALLET_ADDRESS]),
      updates,
      emptyStats(),
    );
    expect(updates).toStrictEqual({});
  });

  it('leaves block height and time unset without details or chain position', () => {
    const updates: Record<string, unknown> = {};
    const stats = emptyStats();
    populateBlockHeight({ blockHeight: null, txid: 'child' }, undefined, new Map(), 1_000, updates, stats);
    populateBlockTime({ blockTime: null, blockHeight: null }, { txid: 'child', vin: [], vout: [] }, updates, stats);
    expect(updates).toStrictEqual({});
    expect(stats).toStrictEqual(emptyStats());
  });
});
