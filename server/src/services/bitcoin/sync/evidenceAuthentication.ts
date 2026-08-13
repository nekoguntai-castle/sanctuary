import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../utils/logger';
import { getNetwork } from '../utils';
import {
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import type {
  RawTransaction,
  SyncContext,
  TransactionOutput,
  TxHistoryEntry,
} from './types';

const log = createLogger('BITCOIN:SVC_SYNC_EVIDENCE');
const FETCH_BATCH_SIZE = 100;

const reasonCode = (error: unknown): string => (
  error instanceof RawTransactionEvidenceError ? error.reason : 'fetch_failed'
);

const recordFailClosed = (ctx: SyncContext, reason: string): void => {
  ctx.rejectedEvidenceCount += 1;
  log.warn('[SYNC] Rejected unauthenticated transaction evidence', { reason, count: 1 });
};

const decodeAddress = (script: Uint8Array, ctx: SyncContext): string | undefined => {
  try {
    return bitcoin.address.fromOutputScript(script, getNetwork(ctx.network));
  } catch {
    return undefined;
  }
};

const toAuthenticatedDetails = (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction,
): RawTransaction => {
  const authenticated = parseAuthenticatedRawTransaction({
    expectedTxid,
    rawHex: details.hex ?? '',
  });
  if (details.txid.toLowerCase() !== authenticated.txid) {
    throw new RawTransactionEvidenceError('txid_mismatch');
  }
  const transaction = authenticated.transaction;
  return {
    txid: authenticated.txid,
    time: details.time,
    blocktime: details.blocktime,
    blockheight: details.blockheight,
    confirmations: details.confirmations,
    blockhash: details.blockhash,
    hex: authenticated.canonicalHex,
    vin: transaction.ins.map(input => {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const coinbase = txid === '00'.repeat(32) && input.index === 0xffffffff;
      return coinbase
        ? { coinbase: Buffer.from(input.script).toString('hex') }
        : { txid, vout: input.index };
    }),
    vout: transaction.outs.map((output, n): TransactionOutput => {
      const address = decodeAddress(output.script, ctx);
      return {
        n,
        value: Number(output.value) / 100_000_000,
        scriptPubKey: {
          hex: Buffer.from(output.script).toString('hex'),
          address,
          addresses: address ? [address] : [],
        },
      };
    }),
  };
};

const cacheAuthenticatedResult = (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction | undefined,
): boolean => {
  try {
    if (!details) throw new Error('missing_result');
    ctx.txDetailsCache.set(expectedTxid, toAuthenticatedDetails(ctx, expectedTxid, details));
    return true;
  } catch (error) {
    ctx.txDetailsCache.delete(expectedTxid);
    recordFailClosed(ctx, reasonCode(error));
    return false;
  }
};

/** Fetches raw transactions and puts only txid-bound, byte-derived details in the cache. */
export async function fetchAuthenticatedTransactions(
  ctx: SyncContext,
  txids: readonly string[],
): Promise<Set<string>> {
  const accepted = new Set<string>();
  const unique = [...new Set(txids)];
  for (const txid of unique) {
    if (ctx.txDetailsCache.has(txid)) accepted.add(txid);
  }
  const pending = unique.filter(txid => !accepted.has(txid));
  for (let offset = 0; offset < pending.length; offset += FETCH_BATCH_SIZE) {
    const batchTxids = pending.slice(offset, offset + FETCH_BATCH_SIZE);
    const results = await ctx.client.getTransactionsBatch(batchTxids, false).then(
      value => value,
      () => undefined,
    );
    if (results) {
      for (const txid of batchTxids) {
        if (cacheAuthenticatedResult(ctx, txid, results.get(txid))) accepted.add(txid);
      }
    } else {
      for (const txid of batchTxids) {
        try {
          const details = await ctx.client.getTransaction(txid, false);
          if (cacheAuthenticatedResult(ctx, txid, details)) accepted.add(txid);
        } catch {
          recordFailClosed(ctx, 'fetch_failed');
        }
      }
    }
  }
  return accepted;
}

const previousTxids = (ctx: SyncContext, txids: Iterable<string>): string[] => {
  const result = new Set<string>();
  for (const txid of txids) {
    for (const input of ctx.txDetailsCache.get(txid)?.vin ?? []) {
      if (!input.coinbase && input.txid) result.add(input.txid);
    }
  }
  return [...result];
};

const paysScript = (details: RawTransaction, script: string): boolean => (
  details.vout.some(output => output.scriptPubKey.hex?.toLowerCase() === script)
);

const spendsScript = (ctx: SyncContext, details: RawTransaction, script: string): boolean => (
  details.vin.some(input => {
    if (!input.txid || input.vout === undefined) return false;
    return ctx.txDetailsCache.get(input.txid)?.vout[input.vout]?.scriptPubKey.hex?.toLowerCase() === script;
  })
);

const collectAuthenticatedSpentOutpoints = (
  ctx: SyncContext,
  acceptedCurrent: ReadonlySet<string>,
): void => {
  ctx.authenticatedSpentOutpointKeys.clear();
  for (const txid of acceptedCurrent) {
    for (const input of ctx.txDetailsCache.get(txid)?.vin ?? []) {
      if (!input.txid || input.vout === undefined) continue;
      const previous = ctx.txDetailsCache.get(input.txid)?.vout[input.vout];
      const script = previous?.scriptPubKey.hex?.toLowerCase();
      if (script && ctx.walletScriptToAddress.has(script)) {
        ctx.authenticatedSpentOutpointKeys.add(`${input.txid}:${input.vout}`);
      }
    }
  }
};

const authenticateAddressHistory = (
  ctx: SyncContext,
  address: SyncContext['addresses'][number],
  acceptedCurrent: ReadonlySet<string>,
): TxHistoryEntry[] => {
  const script = address.scriptPubKey?.toLowerCase();
  const history = ctx.historyResults.get(address.address) ?? [];
  if (script === undefined) return [];
  return history.filter(item => {
    const details = acceptedCurrent.has(item.tx_hash)
      ? ctx.txDetailsCache.get(item.tx_hash)
      : undefined;
    const relevant = details !== undefined
      && (paysScript(details, script) || spendsScript(ctx, details, script));
    if (details !== undefined && !relevant) {
      recordFailClosed(ctx, 'history_script_mismatch');
    }
    return relevant;
  });
};

/** Replaces remote history with only raw-authenticated, script-relevant entries. */
export async function authenticateHistoryResults(ctx: SyncContext): Promise<void> {
  const currentTxids = [...new Set(
    [...ctx.historyResults.values()].flatMap(history => history.map(item => item.tx_hash)),
  )];
  const acceptedCurrent = await fetchAuthenticatedTransactions(ctx, currentTxids);
  await fetchAuthenticatedTransactions(ctx, previousTxids(ctx, acceptedCurrent));

  collectAuthenticatedSpentOutpoints(ctx, acceptedCurrent);

  const filtered = new Map<string, TxHistoryEntry[]>();
  for (const address of ctx.addresses) {
    filtered.set(address.address, authenticateAddressHistory(ctx, address, acceptedCurrent));
  }
  ctx.historyResults = filtered;
  ctx.allTxids = new Set([...filtered.values()].flatMap(history => history.map(item => item.tx_hash)));
  ctx.txHeightMap = new Map(
    [...filtered.values()].flatMap(history => history.map(item => [item.tx_hash, item.height] as const)),
  );
}
