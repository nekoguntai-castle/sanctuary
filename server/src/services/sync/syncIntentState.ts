/** Durable generation counters that decide whether a wallet has unprocessed sync intent. */
export interface SyncIntentGenerations {
  requestedIncrementalSyncGeneration: number;
  processedIncrementalSyncGeneration: number;
  requestedFullResyncGeneration: number;
  processedFullResyncGeneration: number;
}

/** True while requested incremental or full-resync work has not been processed. */
export function hasDurablePendingSync(wallet: SyncIntentGenerations): boolean {
  return wallet.requestedIncrementalSyncGeneration
      > wallet.processedIncrementalSyncGeneration
    || wallet.requestedFullResyncGeneration
      > wallet.processedFullResyncGeneration;
}
