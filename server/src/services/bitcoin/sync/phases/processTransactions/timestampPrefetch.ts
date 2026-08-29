import { getBlockTimestamp } from "../../../utils/blockHeight";
import type { NodeRequestOptions } from "../../../nodeClient";
import {
  mapWithSyncConcurrency,
  SYNC_REMOTE_FALLBACK_CONCURRENCY,
} from "../../attemptRuntime";
import type { RawTransaction, SyncContext } from "../../types";

export async function resolveTransactionBlockTime(
  txDetails: RawTransaction,
  height: number,
  network: SyncContext["network"],
  options?: NodeRequestOptions,
  blockTimestamps?: ReadonlyMap<number, Date | null>,
): Promise<Date | null> {
  if (txDetails.time) return new Date(txDetails.time * 1000);
  if (height <= 0) return null;
  if (blockTimestamps) return blockTimestamps.get(height) ?? null;
  return getBlockTimestamp(height, network, options);
}

const uniqueCandidateHeights = (
  ctx: SyncContext,
  batchTxidSet: ReadonlySet<string>,
): number[] => {
  const heights = new Set<number>();
  for (const history of ctx.historyResults.values()) {
    for (const item of history) {
      if (!batchTxidSet.has(item.tx_hash) || item.height <= 0) continue;
      if (ctx.txDetailsCache.get(item.tx_hash)?.time
        || ctx.authenticatedTransactionEvidence.get(item.tx_hash)?.metadata.time) continue;
      heights.add(item.height);
    }
  }
  return [...heights];
};

export async function prefetchTransactionBlockTimestamps(
  ctx: SyncContext,
  batchTxidSet: ReadonlySet<string>,
  options?: NodeRequestOptions,
): Promise<ReadonlyMap<number, Date | null>> {
  const heights = uniqueCandidateHeights(ctx, batchTxidSet);
  const entries = await mapWithSyncConcurrency<
    number,
    readonly [number, Date | null]
  >(
    heights,
    SYNC_REMOTE_FALLBACK_CONCURRENCY,
    options?.signal ? { signal: options.signal } : undefined,
    async (height): Promise<readonly [number, Date | null]> => [
      height,
      await getBlockTimestamp(height, ctx.network, options),
    ],
  );
  return new Map(entries);
}
