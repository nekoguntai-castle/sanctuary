import { createLogger } from '../../../utils/logger';
import { recordRejectedEvidence } from './rejectedEvidence';
import type { CompactTransactionEvidenceEnvelope } from './transactionEvidenceProjection';
import type { SyncContext, TxHistoryEntry } from './types';
import {
  clearAuthenticatedEvidenceComplexity,
  fetchAuthenticatedOutpoints,
  fetchCompactAuthenticatedTransactions,
  type EvidenceRequestOptions,
} from './evidenceAuthentication';
import { releaseAuthenticatedTransactionDetails } from './evidenceArchitectureReceipts';
import type { SyncStageRuntime } from './attemptRuntime';

/** Opens a remote stage budgeted for `items` work items. */
export type HistoryEvidenceStageOpener = (stage: string, items: number) => SyncStageRuntime;

const log = createLogger('BITCOIN:SVC_SYNC_EVIDENCE');

const recordFailClosed = (ctx: SyncContext, reason: string): void => {
  recordRejectedEvidence(ctx, reason);
  log.warn('[SYNC] Rejected unauthenticated transaction evidence', { reason, count: 1 });
};

const packedInputTxid = (envelope: CompactTransactionEvidenceEnvelope, index: number): string => (
  Buffer.from(envelope.inputTxids.subarray(index * 32, (index + 1) * 32)).toString('hex')
);

const parentOutpointRequests = (
  ctx: SyncContext,
  acceptedCurrent: ReadonlySet<string>,
): Map<string, Set<number>> => {
  const requests = new Map<string, Set<number>>();
  for (const txid of acceptedCurrent) {
    const envelope = ctx.authenticatedTransactionEvidence.get(txid);
    if (!envelope) continue;
    for (let index = 0; index < envelope.inputVouts.length; index += 1) {
      const parentTxid = packedInputTxid(envelope, index);
      const vouts = requests.get(parentTxid) ?? new Set<number>();
      vouts.add(envelope.inputVouts[index]!);
      requests.set(parentTxid, vouts);
    }
  }
  return requests;
};

const envelopePaysScript = (
  envelope: CompactTransactionEvidenceEnvelope,
  walletScriptIndex: number | undefined,
): boolean => walletScriptIndex !== undefined
  && envelope.paidWalletScriptIndexes.includes(walletScriptIndex);

const envelopeSpendsScript = (
  ctx: SyncContext,
  envelope: CompactTransactionEvidenceEnvelope,
  script: string,
): boolean => {
  for (let index = 0; index < envelope.inputVouts.length; index += 1) {
    const parentTxid = packedInputTxid(envelope, index);
    const vout = envelope.inputVouts[index]!;
    if (ctx.authenticatedOutpointEvidence.get(`${parentTxid}:${vout}`)?.scriptHex === script) {
      return true;
    }
  }
  return false;
};

const collectAuthenticatedSpentOutpoints = (
  ctx: SyncContext,
  acceptedCurrent: ReadonlySet<string>,
): void => {
  ctx.authenticatedSpentOutpointKeys.clear();
  for (const txid of acceptedCurrent) {
    const envelope = ctx.authenticatedTransactionEvidence.get(txid);
    if (!envelope) continue;
    for (let index = 0; index < envelope.inputVouts.length; index += 1) {
      const parentTxid = packedInputTxid(envelope, index);
      const vout = envelope.inputVouts[index]!;
      const key = `${parentTxid}:${vout}`;
      const script = ctx.authenticatedOutpointEvidence.get(key)?.scriptHex;
      if (script && ctx.walletScriptToAddress.has(script)) ctx.authenticatedSpentOutpointKeys.add(key);
    }
  }
};

const authenticateAddressHistory = (
  ctx: SyncContext,
  address: SyncContext['addresses'][number],
  acceptedCurrent: ReadonlySet<string>,
  scriptIndexes: ReadonlyMap<string, number>,
): TxHistoryEntry[] => {
  const script = address.scriptPubKey?.toLowerCase();
  if (!script) return [];
  const authenticated: TxHistoryEntry[] = [];
  for (const item of ctx.historyResults.get(address.address) ?? []) {
    const envelope = acceptedCurrent.has(item.tx_hash)
      ? ctx.authenticatedTransactionEvidence.get(item.tx_hash)
      : undefined;
    const relevant = envelope !== undefined
      && (envelopePaysScript(envelope, scriptIndexes.get(script))
        || envelopeSpendsScript(ctx, envelope, script));
    if (envelope && !relevant) recordFailClosed(ctx, 'history_script_mismatch');
    if (relevant) authenticated.push(item);
  }
  return authenticated;
};

const restoreMap = <K, V>(target: Map<K, V>, snapshot: Map<K, V>): void => {
  target.clear();
  for (const entry of snapshot) target.set(...entry);
};

const rebuildAuthenticatedHistoryIndexes = (
  ctx: SyncContext,
  filtered: Map<string, TxHistoryEntry[]>,
): void => {
  ctx.historyResults = filtered;
  ctx.allTxids = new Set();
  ctx.txHeightMap = new Map();
  for (const history of filtered.values()) {
    for (const item of history) {
      ctx.allTxids.add(item.tx_hash);
      ctx.txHeightMap.set(item.tx_hash, item.height);
    }
  }
};

const runEvidenceStage = async <T>(
  openStage: HistoryEvidenceStageOpener | undefined,
  name: string,
  items: number,
  options: EvidenceRequestOptions | undefined,
  run: (stageOptions?: EvidenceRequestOptions) => Promise<T>,
): Promise<T> => {
  const stage = openStage?.(name, items);
  try {
    return await run(stage
      ? { ...options, signal: stage.signal, deadlineAt: stage.deadlineAt }
      : options);
  } finally {
    stage?.dispose();
  }
};

/**
 * With `openStage`, current transactions and their parents each get a remote
 * stage budgeted from their own count; otherwise both use `requestOptions`.
 */
export async function authenticateHistoryResults(
  ctx: SyncContext,
  { requestOptions, openStage }: {
    requestOptions?: EvidenceRequestOptions;
    openStage?: HistoryEvidenceStageOpener;
  } = {},
): Promise<void> {
  const evidenceSnapshot = new Map(ctx.authenticatedTransactionEvidence);
  const outpointSnapshot = new Map(ctx.authenticatedOutpointEvidence);
  const coverageSnapshot = new Map(
    [...ctx.authenticatedOutpointCoverage].map(([txid, vouts]) => [txid, new Set(vouts)]),
  );
  const spentSnapshot = new Set(ctx.authenticatedSpentOutpointKeys);
  try {
    const currentTxids = [...new Set(
      [...ctx.historyResults.values()].flatMap(history => history.map(item => item.tx_hash)),
    )];
    const acceptedCurrent = await runEvidenceStage(
      openStage, 'history_transactions', currentTxids.length, requestOptions,
      stageOptions => fetchCompactAuthenticatedTransactions(ctx, currentTxids, stageOptions),
    );
    const parentRequests = parentOutpointRequests(ctx, acceptedCurrent);
    await runEvidenceStage(
      openStage, 'history_parents', parentRequests.size, requestOptions,
      stageOptions => fetchAuthenticatedOutpoints(ctx, parentRequests, {
        ...stageOptions,
        evidenceRole: 'parent',
      }),
    );
    collectAuthenticatedSpentOutpoints(ctx, acceptedCurrent);
    const scriptIndexes = new Map(
      [...ctx.walletScriptToAddress.keys()].map((script, index) => [script, index]),
    );
    const filtered = new Map<string, TxHistoryEntry[]>();
    for (const address of ctx.addresses) {
      filtered.set(address.address, authenticateAddressHistory(
        ctx, address, acceptedCurrent, scriptIndexes,
      ));
    }
    rebuildAuthenticatedHistoryIndexes(ctx, filtered);
  } catch (error) {
    restoreMap(ctx.authenticatedTransactionEvidence, evidenceSnapshot);
    restoreMap(ctx.authenticatedOutpointEvidence, outpointSnapshot);
    restoreMap(ctx.authenticatedOutpointCoverage, coverageSnapshot);
    ctx.authenticatedSpentOutpointKeys = spentSnapshot;
    releaseAuthenticatedTransactionDetails(ctx, { scope: 'rollback' });
    clearAuthenticatedEvidenceComplexity(ctx);
    throw error;
  }
}
