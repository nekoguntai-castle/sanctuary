import type {
  EvidenceProjectionRole,
  SyncContext,
  SyncEvidenceArchitectureEvent,
} from './types';
import type {
  ExactTransactionOutputsEvidenceResult,
  FullTransactionEvidenceResult,
} from './transactionEvidenceProjection';

const compactSealedTxids = new WeakMap<SyncContext, Set<string>>();
const activeFullEvidence = new WeakMap<SyncContext, Map<string, EvidenceProjectionRole>>();

const emit = (ctx: SyncContext, event: SyncEvidenceArchitectureEvent): void => {
  const observer = ctx.evidenceObserver;
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Diagnostic receipts must never change sync behavior.
    return;
  }
};

const sealedTxidsFor = (ctx: SyncContext): Set<string> => {
  const existing = compactSealedTxids.get(ctx);
  if (existing) return existing;
  const initialized = new Set(ctx.authenticatedTransactionEvidence.keys());
  compactSealedTxids.set(ctx, initialized);
  return initialized;
};

const fullEvidenceFor = (ctx: SyncContext): Map<string, EvidenceProjectionRole> => {
  const existing = activeFullEvidence.get(ctx);
  if (existing) return existing;
  const initialized = new Map<string, EvidenceProjectionRole>();
  activeFullEvidence.set(ctx, initialized);
  return initialized;
};

const fullCurrentCount = (ctx: SyncContext): number => {
  let count = 0;
  for (const role of fullEvidenceFor(ctx).values()) {
    if (role === 'current') count += 1;
  }
  return count;
};

export const recordRemoteEvidenceFetch = (
  ctx: SyncContext,
  txids: readonly string[],
  transport: 'batch' | 'single',
): void => {
  if (!ctx.evidenceObserver) return;
  const sealed = sealedTxidsFor(ctx);
  emit(ctx, {
    type: 'remote_fetch',
    txids: [...txids],
    transport,
    refetchTxids: txids.filter(txid => sealed.has(txid)),
  });
};

export const recordCompactProjection = (
  ctx: SyncContext,
  txid: string,
  digest: string,
  canonicalBytes: number,
): void => {
  if (!ctx.evidenceObserver) return;
  sealedTxidsFor(ctx).add(txid);
  emit(ctx, { type: 'compact_project', txid, digest, canonicalBytes });
};

export const recordFullProjection = (
  ctx: SyncContext,
  txid: string,
  result: FullTransactionEvidenceResult,
  role: EvidenceProjectionRole,
): void => {
  if (!ctx.evidenceObserver) return;
  fullEvidenceFor(ctx).set(txid, role);
  emit(ctx, { type: 'compact_to_full_reuse', txid, digest: result.digest });
  emit(ctx, {
    type: 'full_project',
    txid,
    digest: result.digest,
    canonicalBytes: result.canonicalBytes.byteLength,
    source: 'compact',
    role,
    txDetailsCacheSize: ctx.txDetailsCache.size,
  });
  emit(ctx, {
    type: 'cache_state',
    reason: 'full_project',
    txid,
    txDetailsCacheSize: ctx.txDetailsCache.size,
    fullCurrentCount: fullCurrentCount(ctx),
  });
};

export const recordExactOutputProjection = (
  ctx: SyncContext,
  txid: string,
  result: ExactTransactionOutputsEvidenceResult,
  role: EvidenceProjectionRole,
): void => {
  if (!ctx.evidenceObserver) return;
  for (const output of result.outputs) {
    emit(ctx, {
      type: 'exact_output_project',
      txid,
      vout: output.vout,
      digest: result.digest,
      role,
    });
  }
  emit(ctx, {
    type: 'exact_output_batch_project',
    txid,
    vouts: result.outputs.map(output => output.vout),
    missingVouts: [...result.missingVouts],
    invalidVouts: [...result.invalidVouts],
    digest: result.digest,
    role,
  });
};

export function releaseAuthenticatedTransactionDetails(
  ctx: SyncContext,
  receipt: { scope: 'candidate' | 'batch' | 'rollback' | 'attempt'; txid?: string },
): void {
  ctx.txDetailsCache.clear();
  activeFullEvidence.get(ctx)?.clear();
  if (!ctx.evidenceObserver) return;
  emit(ctx, {
    type: 'cache_state',
    reason: 'release',
    ...receipt,
    txDetailsCacheSize: 0,
    fullCurrentCount: 0,
  });
}
