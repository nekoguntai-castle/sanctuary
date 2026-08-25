import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { PrismaTxClient } from '../models/prisma';
import { resolvePersistedBitcoinNetwork } from '../constants/bitcoinNetworks';
import {
  classifyHeaderObservation,
  parseNetworkHeaderCheckpointRow,
  type NetworkHeaderCheckpointState,
  type PersistedHeaderCheckpointRow,
} from './networkHeaderCheckpointRepository';
import {
  HeaderReconciliationOwnershipError,
  type NetworkHeaderReconciliationFailureClass,
  type NetworkHeaderReconciliationMode,
  type NetworkHeaderReconciliationState,
  type ObserveNetworkHeaderInput,
  type ReconciledHeaderRecord,
  type ReconciliationFence,
} from './networkHeaderReconciliationTypes';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HEADER_PATTERN = /^[0-9a-fA-F]{160}$/;
const FAILURE_CLASSES: readonly string[] = [
  'endpoint_unavailable',
  'validation_failed',
  'confirmation_failed',
  'ownership_lost',
];
const MAX_INT = 2_147_483_647;
/** Canonical two-day tail at Bitcoin's expected ten-minute block interval. */
export const NETWORK_HEADER_HISTORY_WINDOW = 288;

type DbClient = PrismaTxClient | PrismaClient;

interface ReconciliationRow {
  network: string;
  generation: number;
  ownerToken: string;
  mode: string;
  targetHeight: number;
  targetHash: string;
  targetHeaderHex: string;
  targetObservedAt: Date;
  anchorHeight: number;
  anchorHash: string;
  cursorHeight: number | null;
  cursorHash: string | null;
  confirmationCursorWalletId: string | null;
  confirmationEnumerationComplete: boolean;
  pendingTargetHeight: number | null;
  pendingTargetHash: string | null;
  pendingTargetPreviousHash: string | null;
  pendingTargetHeaderHex: string | null;
  pendingTargetObservedAt: Date | null;
  pendingTargetGenesisHash: string | null;
  gapStartedAt: Date;
  lastAttemptAt: Date | null;
  lastFailureClass: string | null;
  consecutiveFailureCount: number;
  retryEligibleAt: Date;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function requireHeight(value: number, description: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INT) {
    throw new Error(`${description} must be a valid block height`);
  }
}

export function requireHash(value: string, description: string): void {
  if (!HASH_PATTERN.test(value)) throw new Error(`${description} must be a lowercase block hash`);
}

export function requireOwnerToken(value: string): void {
  if (typeof value !== 'string' || value.length < 16 || value.length > 200) {
    throw new Error('Header reconciliation owner token is invalid');
  }
}

export function requireObservation(input: ObserveNetworkHeaderInput): void {
  resolvePersistedBitcoinNetwork(input.network);
  requireOwnerToken(input.ownerToken);
  requireHeight(input.height, 'Observed header height');
  requireHash(input.hash, 'Observed header hash');
  requireHash(input.previousHash, 'Observed header parent');
  requireHash(input.genesisHash, 'Expected genesis hash');
  if (!HEADER_PATTERN.test(input.headerHex)) throw new Error('Observed header must be exactly 80 bytes');
  if (!validDate(input.observedAt)) throw new Error('Observed header time is invalid');
}

export function requireReconciledHeader(header: ReconciledHeaderRecord): void {
  requireHeight(header.height, 'Reconciled header height');
  requireHash(header.hash, 'Reconciled header hash');
  requireHash(header.previousHash, 'Reconciled header parent');
  if (!validDate(header.observedAt)) throw new Error('Reconciled header time is invalid');
}

export function isMode(value: string): value is NetworkHeaderReconciliationMode {
  return value === 'forward' || value === 'ancestor_search' || value === 'genesis_rebuild';
}

export const isFailureClass = (value: string): boolean => FAILURE_CLASSES.includes(value);

const requireFailureClass = (
  value: string | null,
): NetworkHeaderReconciliationFailureClass | null => {
  switch (value) {
    case null:
    case 'endpoint_unavailable':
    case 'validation_failed':
    case 'confirmation_failed':
    case 'ownership_lost':
      return value;
    default:
      throw new Error('Header reconciliation failure class is invalid');
  }
};

const assertCursorState = (row: ReconciliationRow): void => {
  requireHeight(row.targetHeight, 'Header reconciliation target height');
  requireHeight(row.anchorHeight, 'Header reconciliation anchor height');
  if (row.cursorHeight !== null) requireHeight(row.cursorHeight, 'Header reconciliation cursor height');
  requireHash(row.targetHash, 'Header reconciliation target hash');
  requireHash(row.anchorHash, 'Header reconciliation anchor hash');
  if (row.cursorHash !== null) requireHash(row.cursorHash, 'Header reconciliation cursor hash');
  if ((row.cursorHeight === null) !== (row.cursorHash === null)) {
    throw new Error('Header reconciliation cursor identity is incomplete');
  }
  if (row.cursorHeight !== null && (
    row.cursorHeight > row.targetHeight
    || (row.cursorHeight === row.targetHeight && row.cursorHash !== row.targetHash)
  )) {
    throw new Error('Header reconciliation cursor is inconsistent with its target');
  }
};

const assertPendingTarget = (row: ReconciliationRow): void => {
  const values = [
    row.pendingTargetHeight,
    row.pendingTargetHash,
    row.pendingTargetPreviousHash,
    row.pendingTargetHeaderHex,
    row.pendingTargetObservedAt,
    row.pendingTargetGenesisHash,
  ];
  const present = values.filter(value => value !== null).length;
  if (present !== 0 && present !== values.length) {
    throw new Error('Header reconciliation pending target is incomplete');
  }
  if (present === 0) return;
  requireHeight(row.pendingTargetHeight!, 'Header reconciliation pending target height');
  requireHash(row.pendingTargetHash!, 'Header reconciliation pending target hash');
  requireHash(row.pendingTargetPreviousHash!, 'Header reconciliation pending target parent');
  requireHash(row.pendingTargetGenesisHash!, 'Header reconciliation pending target genesis');
  if (!HEADER_PATTERN.test(row.pendingTargetHeaderHex!)) {
    throw new Error('Header reconciliation pending target is malformed');
  }
  if (!validDate(row.pendingTargetObservedAt)) {
    throw new Error('Header reconciliation pending target time is invalid');
  }
  if (row.cursorHeight !== row.targetHeight || row.cursorHash !== row.targetHash) {
    throw new Error('Header reconciliation pending target requires a proven active target');
  }
};

const requireStateMetadata = (
  row: ReconciliationRow,
): NetworkHeaderReconciliationMode => {
  if (!Number.isInteger(row.generation) || row.generation < 1 || row.generation > MAX_INT) {
    throw new Error('Header reconciliation generation is invalid');
  }
  requireOwnerToken(row.ownerToken);
  if (!isMode(row.mode)) throw new Error('Header reconciliation mode is invalid');
  if (!HEADER_PATTERN.test(row.targetHeaderHex)) throw new Error('Header reconciliation target is malformed');
  requireFailureCount(row.consecutiveFailureCount);
  requireConfirmationCursor(row.confirmationCursorWalletId);
  if (typeof row.confirmationEnumerationComplete !== 'boolean') {
    throw new Error('Header reconciliation confirmation phase is invalid');
  }
  assertPendingTarget(row);
  return row.mode;
};

const requireFailureCount = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 30) {
    throw new Error('Header reconciliation failure count is invalid');
  }
};

const requireConfirmationCursor = (value: unknown): void => {
  if (value !== null && (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 200
  )) {
    throw new Error('Header reconciliation confirmation cursor is invalid');
  }
};

const requireStateTimes = (
  row: ReconciliationRow,
): NetworkHeaderReconciliationFailureClass | null => {
  for (const [description, value] of [
    ['target observation', row.targetObservedAt],
    ['gap start', row.gapStartedAt],
    ['retry eligibility', row.retryEligibleAt],
  ] as const) {
    if (!validDate(value)) throw new Error(`Header reconciliation ${description} time is invalid`);
  }
  if (row.lastAttemptAt !== null && !validDate(row.lastAttemptAt)) {
    throw new Error('Header reconciliation attempt time is invalid');
  }
  return requireFailureClass(row.lastFailureClass);
};

export function parseState(row: ReconciliationRow): NetworkHeaderReconciliationState {
  const network = resolvePersistedBitcoinNetwork(row.network);
  assertCursorState(row);
  const mode = requireStateMetadata(row);
  const lastFailureClass = requireStateTimes(row);
  return { ...row, network, mode, lastFailureClass };
}

export async function databaseNow(tx: DbClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
    SELECT clock_timestamp() AS "now"
  `);
  const now = rows[0]?.now;
  if (!validDate(now)) throw new Error('Header reconciliation database clock is unavailable');
  return now;
}

export async function lockState(
  tx: PrismaTxClient,
  network: string,
): Promise<NetworkHeaderReconciliationState | null> {
  const rows = await tx.$queryRaw<ReconciliationRow[]>(Prisma.sql`
    SELECT * FROM "network_header_reconciliations"
    WHERE "network" = ${network}
    FOR UPDATE
  `);
  return rows[0] ? parseState(rows[0]) : null;
}

export async function lockCheckpoint(
  tx: PrismaTxClient,
  network: string,
): Promise<NetworkHeaderCheckpointState | null> {
  const rows = await tx.$queryRaw<PersistedHeaderCheckpointRow[]>(Prisma.sql`
    SELECT
      "network", "lastProcessedHeight", "lastProcessedHash", "observedAt",
      "coverageGapStartedAt"
    FROM "network_header_checkpoints"
    WHERE "network" = ${network}
    FOR UPDATE
  `);
  return rows[0] ? parseNetworkHeaderCheckpointRow(rows[0]) : null;
}

export function initialMode(
  checkpoint: NetworkHeaderCheckpointState | null,
  input: ObserveNetworkHeaderInput,
): { mode: NetworkHeaderReconciliationMode; anchorHeight: number; anchorHash: string } {
  if (!checkpoint) return { mode: 'genesis_rebuild', anchorHeight: 0, anchorHash: input.genesisHash };
  const verdict = classifyHeaderObservation(checkpoint, {
    height: input.height,
    hash: input.hash,
    previousHash: input.previousHash,
  });
  if (['duplicate', 'contiguous', 'missed_gap'].includes(verdict.classification)) {
    // A missed height range is not itself a reorg: the persisted checkpoint is
    // still a proven parent anchor, and forward paging validates every omission.
    return {
      mode: 'forward',
      anchorHeight: checkpoint.lastProcessedHeight,
      anchorHash: checkpoint.lastProcessedHash,
    };
  }
  return { mode: 'ancestor_search', anchorHeight: 0, anchorHash: input.genesisHash };
}

export function nextGeneration(generation: number): number {
  if (generation >= MAX_INT) throw new Error('Header reconciliation generation exhausted');
  return generation + 1;
}

export async function createState(
  tx: PrismaTxClient,
  input: ObserveNetworkHeaderInput,
  checkpoint: NetworkHeaderCheckpointState | null,
  now: Date,
): Promise<NetworkHeaderReconciliationState> {
  const anchor = initialMode(checkpoint, input);
  const gapStartedAt = checkpoint?.coverageGapStartedAt ?? now;
  const created = await tx.networkHeaderReconciliation.create({
    data: {
      network: input.network,
      generation: 1,
      ownerToken: input.ownerToken,
      mode: anchor.mode,
      targetHeight: input.height,
      targetHash: input.hash,
      targetHeaderHex: input.headerHex,
      targetObservedAt: input.observedAt,
      anchorHeight: anchor.anchorHeight,
      anchorHash: anchor.anchorHash,
      gapStartedAt,
      retryEligibleAt: now,
    },
  });
  return parseState(created);
}

function targetIsCompatible(
  state: NetworkHeaderReconciliationState,
  input: ObserveNetworkHeaderInput,
): boolean {
  return input.height > state.targetHeight
    || (input.height === state.targetHeight && input.hash === state.targetHash);
}

function targetChanged(
  state: NetworkHeaderReconciliationState,
  input: ObserveNetworkHeaderInput,
): boolean {
  return input.height !== state.targetHeight || input.hash !== state.targetHash;
}

function targetIsProven(state: NetworkHeaderReconciliationState): boolean {
  return state.cursorHeight === state.targetHeight && state.cursorHash === state.targetHash;
}

function pendingTargetData(input: ObserveNetworkHeaderInput) {
  return {
    pendingTargetHeight: input.height,
    pendingTargetHash: input.hash,
    pendingTargetPreviousHash: input.previousHash,
    pendingTargetHeaderHex: input.headerHex,
    pendingTargetObservedAt: input.observedAt,
    pendingTargetGenesisHash: input.genesisHash,
  };
}

export async function updateExistingState(
  tx: PrismaTxClient,
  current: NetworkHeaderReconciliationState,
  input: ObserveNetworkHeaderInput,
  checkpoint: NetworkHeaderCheckpointState | null,
  now: Date,
): Promise<NetworkHeaderReconciliationState> {
  const compatible = targetIsCompatible(current, input);
  const ownerChanged = current.ownerToken !== input.ownerToken;
  const identicalActiveTarget = !targetChanged(current, input);
  const frozenTarget = targetIsProven(current);
  if (frozenTarget && !identicalActiveTarget) {
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        generation: nextGeneration(current.generation),
        ownerToken: input.ownerToken,
        ...pendingTargetData(input),
        retryEligibleAt: current.retryEligibleAt > now ? current.retryEligibleAt : now,
      },
    });
    return parseState(updated);
  }
  const reset = !compatible;
  const changedTarget = targetChanged(current, input);
  const anchor = reset ? initialMode(checkpoint, input) : null;
  const generation = ownerChanged || changedTarget
    ? nextGeneration(current.generation)
    : current.generation;
  if (reset) {
    await tx.networkHeaderReconciliationHeader.deleteMany({ where: { network: input.network } });
    await tx.networkHeaderConfirmationRetry.deleteMany({ where: { network: input.network } });
  }
  const updated = await tx.networkHeaderReconciliation.update({
    where: { network: input.network },
    data: {
      generation,
      ownerToken: input.ownerToken,
      targetHeight: input.height,
      targetHash: input.hash,
      targetHeaderHex: input.headerHex,
      targetObservedAt: input.observedAt,
      ...(changedTarget ? {
        confirmationCursorWalletId: null,
        confirmationEnumerationComplete: false,
      } : {}),
      ...(anchor ? {
        mode: anchor.mode,
        anchorHeight: anchor.anchorHeight,
        anchorHash: anchor.anchorHash,
        cursorHeight: null,
        cursorHash: null,
      } : {}),
      retryEligibleAt: current.retryEligibleAt > now ? current.retryEligibleAt : now,
    },
  });
  return parseState(updated);
}

export function requireFence(fence: ReconciliationFence): void {
  resolvePersistedBitcoinNetwork(fence.network);
  requireOwnerToken(fence.ownerToken);
  if (!Number.isInteger(fence.generation) || fence.generation < 1 || fence.generation > MAX_INT) {
    throw new Error('Header reconciliation fence generation is invalid');
  }
}

/** Reject a displaced worker before it can commit staged or authoritative state. */
export function assertFence(
  state: NetworkHeaderReconciliationState | null,
  fence: ReconciliationFence,
): asserts state is NetworkHeaderReconciliationState {
  if (!state || state.generation !== fence.generation || state.ownerToken !== fence.ownerToken) {
    throw new HeaderReconciliationOwnershipError();
  }
}
