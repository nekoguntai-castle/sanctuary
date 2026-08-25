import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import { resolvePersistedBitcoinNetwork } from '../constants/bitcoinNetworks';
import {
  parseNetworkHeaderCheckpointRow,
  type NetworkHeaderCheckpointState,
} from './networkHeaderCheckpointRepository';
import {
  assertFence,
  createState,
  databaseNow,
  isFailureClass,
  isMode,
  initialMode,
  lockCheckpoint,
  lockState,
  NETWORK_HEADER_HISTORY_WINDOW,
  nextGeneration,
  parseState,
  requireFence,
  requireHash,
  requireHeight,
  requireObservation,
  requireOwnerToken,
  requireReconciledHeader,
  updateExistingState,
} from './networkHeaderReconciliationPersistence';
import type {
  NetworkHeaderFinalizationResult,
  NetworkHeaderReconciliationFailureClass,
  NetworkHeaderReconciliationMode,
  NetworkHeaderReconciliationState,
  ObserveNetworkHeaderInput,
  ReconciledHeaderRecord,
  ReconciliationFence,
} from './networkHeaderReconciliationTypes';
import {
  findNetworkHeaderConfirmationRetries,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
} from './networkHeaderConfirmationRepository';

export { NETWORK_HEADER_HISTORY_WINDOW } from './networkHeaderReconciliationPersistence';
export const NETWORK_HEADER_RECONCILIATION_MAX_RETRY_MS = 300_000;

/** Open or retarget one network's fenced work while atomically opening its gap. */
export async function observeNetworkHeader(
  input: ObserveNetworkHeaderInput,
): Promise<NetworkHeaderReconciliationState> {
  requireObservation(input);
  return prisma.$transaction(async (tx) => {
    const now = await databaseNow(tx);
    const checkpoint = await lockCheckpoint(tx, input.network);
    const current = await lockState(tx, input.network);
    if (checkpoint) {
      await tx.networkHeaderCheckpoint.update({
        where: { network: input.network },
        data: { coverageGapStartedAt: checkpoint.coverageGapStartedAt ?? now },
      });
    }
    return current
      ? updateExistingState(tx, current, input, checkpoint, now)
      : createState(tx, input, checkpoint, now);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimNetworkHeaderReconciliation(
  networkInput: unknown,
  ownerToken: string,
): Promise<NetworkHeaderReconciliationState | null> {
  const network = resolvePersistedBitcoinNetwork(networkInput);
  requireOwnerToken(ownerToken);
  return prisma.$transaction(async (tx) => {
    const current = await lockState(tx, network);
    if (!current || current.ownerToken === ownerToken) return current;
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network },
      data: {
        generation: nextGeneration(current.generation),
        ownerToken,
      },
    });
    return parseState(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function findDueNetworkHeaderReconciliations(
  limit = 20,
): Promise<NetworkHeaderReconciliationState[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Header reconciliation scan limit is invalid');
  }
  const now = await databaseNow(prisma);
  const rows = await prisma.networkHeaderReconciliation.findMany({
    where: { retryEligibleAt: { lte: now } },
    orderBy: [{ retryEligibleAt: 'asc' }, { network: 'asc' }],
    take: limit,
  });
  return rows.map(parseState);
}

function assertFirstHeaderLink(
  state: NetworkHeaderReconciliationState,
  expectedCursor: { height: number; hash: string } | null,
  first: ReconciledHeaderRecord,
): void {
  if (expectedCursor) {
    if (first.height !== expectedCursor.height + 1 || first.previousHash !== expectedCursor.hash) {
      throw new Error('Header reconciliation page does not extend the expected cursor');
    }
    return;
  }
  if (first.height !== state.anchorHeight || first.hash !== state.anchorHash) {
    throw new Error('Header reconciliation page does not revalidate the anchor');
  }
}

function assertHeaderPage(
  state: NetworkHeaderReconciliationState,
  expectedCursor: { height: number; hash: string } | null,
  headers: ReconciledHeaderRecord[],
): void {
  headers.forEach(requireReconciledHeader);
  assertFirstHeaderLink(state, expectedCursor, headers[0]);
  for (let index = 1; index < headers.length; index += 1) {
    const previous = headers[index - 1];
    const current = headers[index];
    if (current.height !== previous.height + 1 || current.previousHash !== previous.hash) {
      throw new Error('Header reconciliation page is not a contiguous chain');
    }
  }
  const last = headers[headers.length - 1];
  if (last.height > state.targetHeight) {
    throw new Error('Header reconciliation page advances beyond its target');
  }
  if (last.height === state.targetHeight && last.hash !== state.targetHash) {
    throw new Error('Header reconciliation page does not prove the target identity');
  }
}

async function assertNoConflictingStagedHeaders(
  tx: PrismaTxClient,
  network: string,
  headers: ReconciledHeaderRecord[],
): Promise<void> {
  const existing = await tx.networkHeaderReconciliationHeader.findMany({
    where: { network, height: { in: headers.map(header => header.height) } },
    select: { height: true, hash: true, previousHash: true },
  });
  const requested = new Map(headers.map(header => [header.height, header]));
  const conflicting = existing.some(header => {
    const candidate = requested.get(header.height)!;
    return candidate.hash !== header.hash
      || candidate.previousHash !== header.previousHash;
  });
  if (conflicting) throw new Error('Header reconciliation staged height conflicts with existing proof');
}

/** CAS one validated header page onto the exact generation, owner, and cursor. */
export async function recordNetworkHeaderCursor(input: ReconciliationFence & {
  expectedCursor: { height: number; hash: string } | null;
  headers: ReconciledHeaderRecord[];
}): Promise<NetworkHeaderReconciliationState> {
  requireFence(input);
  if (input.headers.length < 1 || input.headers.length > 2016) {
    throw new Error('Header reconciliation page size is invalid');
  }
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, input.network);
    assertFence(state, input);
    if (state.cursorHeight !== (input.expectedCursor?.height ?? null)
      || state.cursorHash !== (input.expectedCursor?.hash ?? null)) {
      throw new Error('Header reconciliation cursor changed');
    }
    assertHeaderPage(state, input.expectedCursor, input.headers);
    await assertNoConflictingStagedHeaders(tx, input.network, input.headers);
    await tx.networkHeaderReconciliationHeader.createMany({
      data: input.headers.map((header) => ({ network: input.network, ...header })),
      skipDuplicates: true,
    });
    const last = input.headers[input.headers.length - 1];
    const now = await databaseNow(tx);
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        mode: 'forward',
        cursorHeight: last.height,
        cursorHash: last.hash,
        lastAttemptAt: now,
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: now,
      },
    });
    await tx.networkHeaderReconciliationHeader.deleteMany({
      where: {
        network: input.network,
        height: { lt: Math.max(0, last.height - NETWORK_HEADER_HISTORY_WINDOW + 1) },
      },
    });
    return parseState(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function resetNetworkHeaderCursor(input: ReconciliationFence & {
  mode: NetworkHeaderReconciliationMode;
  anchorHeight: number;
  anchorHash: string;
}): Promise<NetworkHeaderReconciliationState> {
  requireFence(input);
  if (!isMode(input.mode)) throw new Error('Header reconciliation reset mode is invalid');
  requireHeight(input.anchorHeight, 'Header reconciliation reset anchor height');
  requireHash(input.anchorHash, 'Header reconciliation reset anchor hash');
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, input.network);
    assertFence(state, input);
    const generation = nextGeneration(state.generation);
    await tx.networkHeaderReconciliationHeader.deleteMany({ where: { network: input.network } });
    await tx.networkHeaderConfirmationRetry.deleteMany({ where: { network: input.network } });
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        generation,
        mode: input.mode,
        anchorHeight: input.anchorHeight,
        anchorHash: input.anchorHash,
        cursorHeight: null,
        cursorHash: null,
        confirmationCursorWalletId: null,
        confirmationEnumerationComplete: false,
        pendingTargetHeight: null,
        pendingTargetHash: null,
        pendingTargetPreviousHash: null,
        pendingTargetHeaderHex: null,
        pendingTargetObservedAt: null,
        pendingTargetGenesisHash: null,
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: await databaseNow(tx),
      },
    });
    return parseState(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recordNetworkHeaderReconciliationFailure(input: ReconciliationFence & {
  failureClass: NetworkHeaderReconciliationFailureClass;
  retryDelayMs: number;
}): Promise<boolean> {
  requireFence(input);
  if (!isFailureClass(input.failureClass)) throw new Error('Header failure class is invalid');
  if (!Number.isSafeInteger(input.retryDelayMs) || input.retryDelayMs < 0 || input.retryDelayMs > 3_600_000) {
    throw new Error('Header retry delay is invalid');
  }
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, input.network);
    if (!state
      || state.generation !== input.generation
      || state.ownerToken !== input.ownerToken) return false;
    const now = await databaseNow(tx);
    const consecutiveFailureCount = Math.min(30, state.consecutiveFailureCount + 1);
    const exponent = Math.min(16, consecutiveFailureCount - 1);
    const retryDelayMs = Math.min(
      NETWORK_HEADER_RECONCILIATION_MAX_RETRY_MS,
      input.retryDelayMs * (2 ** exponent),
    );
    await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        lastAttemptAt: now,
        lastFailureClass: input.failureClass,
        consecutiveFailureCount,
        retryEligibleAt: new Date(now.getTime() + retryDelayMs),
      },
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export {
  findNetworkHeaderConfirmationRetries,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
} from './networkHeaderConfirmationRepository';

export async function findNetworkHeaderHistory(
  networkInput: unknown,
  maxHeight: number,
  limit = NETWORK_HEADER_HISTORY_WINDOW,
): Promise<ReconciledHeaderRecord[]> {
  const network = resolvePersistedBitcoinNetwork(networkInput);
  requireHeight(maxHeight, 'Header history maximum height');
  if (!Number.isInteger(limit) || limit < 1 || limit > NETWORK_HEADER_HISTORY_WINDOW) {
    throw new Error('Header history page limit is invalid');
  }
  return prisma.networkHeaderHistory.findMany({
    where: { network, height: { lte: maxHeight } },
    orderBy: { height: 'desc' },
    take: limit,
    select: { height: true, hash: true, previousHash: true, observedAt: true },
  });
}

/**
 * Promote only a fully proven target. The serializable transaction replaces
 * staged canonical heights in bulk. A coalesced observation rolls into the
 * next generation without closing the gap; otherwise active work is removed.
 */
export async function finalizeNetworkHeaderReconciliation(
  fence: ReconciliationFence,
): Promise<NetworkHeaderFinalizationResult> {
  requireFence(fence);
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, fence.network);
    assertFence(state, fence);
    if (state.cursorHeight !== state.targetHeight || state.cursorHash !== state.targetHash) {
      throw new Error('Header reconciliation target is not fully proven');
    }
    if (!state.confirmationEnumerationComplete) {
      throw new Error('Header reconciliation confirmation enumeration is incomplete');
    }
    const retryCount = await tx.networkHeaderConfirmationRetry.count({
      where: { network: fence.network },
    });
    if (retryCount !== 0) {
      throw new Error('Header reconciliation confirmation retries remain unresolved');
    }
    const staged = await tx.networkHeaderReconciliationHeader.findMany({
      where: { network: fence.network },
      orderBy: { height: 'asc' },
    });
    const stagedTarget = staged.find(header => header.height === state.targetHeight);
    if (!stagedTarget || stagedTarget.hash !== state.targetHash) {
      throw new Error('Header reconciliation staged proof does not contain the exact target');
    }
    const stagedHeights = staged.map(header => header.height);
    await tx.networkHeaderHistory.deleteMany({
      where: { network: fence.network, height: { in: stagedHeights } },
    });
    await tx.networkHeaderHistory.createMany({ data: staged });
    await tx.networkHeaderHistory.deleteMany({
      where: {
        network: fence.network,
        OR: [
          { height: { lt: Math.max(0, state.targetHeight - NETWORK_HEADER_HISTORY_WINDOW + 1) } },
          { height: { gt: state.targetHeight } },
        ],
      },
    });
    const hasPendingTarget = state.pendingTargetHeight !== null;
    const row = await tx.networkHeaderCheckpoint.upsert({
      where: { network: fence.network },
      create: {
        network: fence.network,
        lastProcessedHeight: state.targetHeight,
        lastProcessedHash: state.targetHash,
        observedAt: state.targetObservedAt,
        coverageGapStartedAt: hasPendingTarget ? state.gapStartedAt : null,
      },
      update: {
        lastProcessedHeight: state.targetHeight,
        lastProcessedHash: state.targetHash,
        observedAt: state.targetObservedAt,
        coverageGapStartedAt: hasPendingTarget ? state.gapStartedAt : null,
      },
    });
    const checkpoint = parseNetworkHeaderCheckpointRow(row);
    if (!hasPendingTarget) {
      await tx.networkHeaderReconciliation.delete({ where: { network: fence.network } });
      return { checkpoint, continuation: null };
    }
    const pendingInput: ObserveNetworkHeaderInput = {
      network: state.network,
      ownerToken: state.ownerToken,
      height: state.pendingTargetHeight!,
      hash: state.pendingTargetHash!,
      previousHash: state.pendingTargetPreviousHash!,
      headerHex: state.pendingTargetHeaderHex!,
      observedAt: state.pendingTargetObservedAt!,
      genesisHash: state.pendingTargetGenesisHash!,
    };
    const anchor = initialMode(checkpoint, pendingInput);
    const now = await databaseNow(tx);
    await tx.networkHeaderReconciliationHeader.deleteMany({ where: { network: fence.network } });
    const continued = await tx.networkHeaderReconciliation.update({
      where: { network: fence.network },
      data: {
        generation: nextGeneration(state.generation),
        mode: anchor.mode,
        targetHeight: pendingInput.height,
        targetHash: pendingInput.hash,
        targetHeaderHex: pendingInput.headerHex,
        targetObservedAt: pendingInput.observedAt,
        anchorHeight: anchor.anchorHeight,
        anchorHash: anchor.anchorHash,
        cursorHeight: null,
        cursorHash: null,
        confirmationCursorWalletId: null,
        confirmationEnumerationComplete: false,
        pendingTargetHeight: null,
        pendingTargetHash: null,
        pendingTargetPreviousHash: null,
        pendingTargetHeaderHex: null,
        pendingTargetObservedAt: null,
        pendingTargetGenesisHash: null,
        lastAttemptAt: now,
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: now,
      },
    });
    return { checkpoint, continuation: parseState(continued) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const networkHeaderReconciliationRepository = {
  claimNetworkHeaderReconciliation,
  finalizeNetworkHeaderReconciliation,
  findDueNetworkHeaderReconciliations,
  findNetworkHeaderConfirmationRetries,
  findNetworkHeaderHistory,
  observeNetworkHeader,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
  recordNetworkHeaderCursor,
  recordNetworkHeaderReconciliationFailure,
  resetNetworkHeaderCursor,
};

export default networkHeaderReconciliationRepository;
