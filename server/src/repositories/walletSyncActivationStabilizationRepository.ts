import { z } from 'zod';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';
import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import { safeJsonParse } from '../utils/safeJson';
import { WALLET_SYNC_ACTIVATION_STABILIZATION_KEY } from './operationalSystemSettings';

export const WALLET_SYNC_ACTIVATION_STABILIZATION_VERSION = 1 as const;

const stabilizationSchema = z.object({
  version: z.literal(WALLET_SYNC_ACTIVATION_STABILIZATION_VERSION),
  requiredMutationFenceFloor: z.number().int().min(1),
  candidateReadySince: z.iso.datetime({ offset: true }).nullable(),
  lastReadyAt: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((state, context) => {
  const hasCandidate = state.candidateReadySince !== null;
  const hasLastReady = state.lastReadyAt !== null;
  if (hasCandidate !== hasLastReady) {
    context.addIssue({
      code: 'custom',
      message: 'candidateReadySince and lastReadyAt must both be present or absent',
    });
    return;
  }
  if (
    state.candidateReadySince !== null
    && state.lastReadyAt !== null
    && Date.parse(state.lastReadyAt) < Date.parse(state.candidateReadySince)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'lastReadyAt cannot precede candidateReadySince',
    });
  }
});

export interface WalletSyncActivationStabilization {
  version: typeof WALLET_SYNC_ACTIVATION_STABILIZATION_VERSION;
  requiredMutationFenceFloor: number;
  candidateReadySince: string | null;
  lastReadyAt: string | null;
}

export type WalletSyncActivationReadinessObservation =
  | { status: 'ready'; observedAt: Date }
  | { status: 'blocked' | 'unavailable' };

export interface ObserveWalletSyncActivationReadinessInput {
  observation: WalletSyncActivationReadinessObservation;
  evaluatedAt: Date;
  readyObservationMaxAgeMs: number;
  drainHorizonMs: number;
}

export interface InspectWalletSyncActivationReadinessInput {
  readyObservationMaxAgeMs: number;
  drainHorizonMs: number;
}

export interface WalletSyncActivationStabilizationResult {
  state: WalletSyncActivationStabilization;
  readyObservationAccepted: boolean;
  drainHorizonSatisfied: boolean;
}

interface StabilizationRow {
  value: string;
}

interface StabilizationSnapshotRow {
  value: string | null;
  databaseNow: Date;
}

function emptyStabilization(): WalletSyncActivationStabilization {
  return {
    version: WALLET_SYNC_ACTIVATION_STABILIZATION_VERSION,
    requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    candidateReadySince: null,
    lastReadyAt: null,
  };
}

/** Parse strict durable state, throwing so malformed activation proof fails closed. */
export function parseWalletSyncActivationStabilization(
  value: string,
): WalletSyncActivationStabilization {
  const parsed = safeJsonParse(
    value,
    stabilizationSchema.nullable(),
    null,
    WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
  );
  if (parsed === null) {
    throw new Error('Invalid durable wallet-sync activation stabilization state');
  }
  return parsed;
}

function requireValidDate(value: Date, description: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(`${description} must be a valid date`);
}

function requireDuration(value: number, description: string, allowZero: boolean): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${description} must be an integer of at least ${minimum}ms`);
  }
}

function assertSupportedFloor(state: WalletSyncActivationStabilization): void {
  if (state.requiredMutationFenceFloor > WALLET_SYNC_MUTATION_FENCE_FLOOR) {
    throw new Error(
      'Wallet-sync activation stabilization requires mutation-fence floor '
      + `${state.requiredMutationFenceFloor}; current binary supports `
      + WALLET_SYNC_MUTATION_FENCE_FLOOR,
    );
  }
}

function assertStateNotFuture(
  state: WalletSyncActivationStabilization,
  evaluatedAt: Date,
): void {
  const evaluatedAtMs = evaluatedAt.getTime();
  if (
    (state.candidateReadySince !== null
      && Date.parse(state.candidateReadySince) > evaluatedAtMs)
    || (state.lastReadyAt !== null && Date.parse(state.lastReadyAt) > evaluatedAtMs)
  ) {
    throw new Error('Durable wallet-sync activation stabilization timestamps are in the future');
  }
}

function currentFloorState(
  state: WalletSyncActivationStabilization,
): WalletSyncActivationStabilization {
  assertSupportedFloor(state);
  /* v8 ignore else -- floor 1 is the first supported floor; exercised when a future binary raises it. */
  if (state.requiredMutationFenceFloor === WALLET_SYNC_MUTATION_FENCE_FLOOR) return state;
  /* v8 ignore next */
  return emptyStabilization();
}

function requireObservationInput(input: ObserveWalletSyncActivationReadinessInput): void {
  requireValidDate(input.evaluatedAt, 'Wallet-sync readiness evaluation time');
  requireDuration(input.readyObservationMaxAgeMs, 'Wallet-sync ready observation maximum age', false);
  requireDuration(input.drainHorizonMs, 'Wallet-sync activation drain horizon', true);
  if (input.observation.status !== 'ready') return;
  requireValidDate(input.observation.observedAt, 'Wallet-sync ready observation time');
  if (input.observation.observedAt.getTime() > input.evaluatedAt.getTime()) {
    throw new Error('Wallet-sync ready observation time cannot be in the future');
  }
}

function requireInspectionInput(input: InspectWalletSyncActivationReadinessInput): void {
  requireDuration(input.readyObservationMaxAgeMs, 'Wallet-sync ready observation maximum age', false);
  requireDuration(input.drainHorizonMs, 'Wallet-sync activation drain horizon', true);
}

function projectReadyObservation(
  state: WalletSyncActivationStabilization,
  recordedAt: Date,
  readyObservationMaxAgeMs: number,
): WalletSyncActivationStabilization {
  const observedAtMs = recordedAt.getTime();
  const lastReadyAtMs = state.lastReadyAt === null ? null : Date.parse(state.lastReadyAt);
  // A missed refresh beyond the accepted age starts a new candidate interval;
  // the previous partial drain can never contribute to activation.
  const continuous = state.candidateReadySince !== null
    && lastReadyAtMs !== null
    && observedAtMs - lastReadyAtMs <= readyObservationMaxAgeMs;
  const candidateReadySince = continuous && state.candidateReadySince !== null
    ? state.candidateReadySince
    : recordedAt.toISOString();
  return {
    ...emptyStabilization(),
    candidateReadySince,
    lastReadyAt: recordedAt.toISOString(),
  };
}

function drainHorizonSatisfied(
  candidateReadySince: string,
  lastReadyAt: string,
  evaluatedAt: Date,
  readyObservationMaxAgeMs: number,
  drainHorizonMs: number,
): boolean {
  const evaluatedAtMs = evaluatedAt.getTime();
  return evaluatedAtMs - Date.parse(candidateReadySince) >= drainHorizonMs
    && evaluatedAtMs - Date.parse(lastReadyAt) <= readyObservationMaxAgeMs;
}

function readyInterval(state: WalletSyncActivationStabilization): {
  candidateReadySince: string;
  lastReadyAt: string;
} | null {
  if (state.candidateReadySince === null || state.lastReadyAt === null) return null;
  return {
    candidateReadySince: state.candidateReadySince,
    lastReadyAt: state.lastReadyAt,
  };
}

function nextStabilization(
  current: WalletSyncActivationStabilization,
  input: ObserveWalletSyncActivationReadinessInput,
  recordedAt: Date,
): { state: WalletSyncActivationStabilization; accepted: boolean } {
  if (input.observation.status !== 'ready') {
    return { state: emptyStabilization(), accepted: false };
  }
  const observationAgeMs = input.evaluatedAt.getTime() - input.observation.observedAt.getTime();
  if (observationAgeMs > input.readyObservationMaxAgeMs) {
    return { state: emptyStabilization(), accepted: false };
  }
  return {
    state: projectReadyObservation(
      current,
      recordedAt,
      input.readyObservationMaxAgeMs,
    ),
    accepted: true,
  };
}

async function readStabilizationSnapshot(): Promise<{
  state: WalletSyncActivationStabilization;
  databaseNow: Date;
}> {
  const rows = await prisma.$queryRaw<StabilizationSnapshotRow[]>(Prisma.sql`
    SELECT
      (
        SELECT "value"
        FROM "system_settings"
        WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
      ) AS "value",
      clock_timestamp() AS "databaseNow"
  `);
  const row = rows[0];
  if (!(row?.databaseNow instanceof Date) || !Number.isFinite(row.databaseNow.getTime())) {
    throw new Error('Wallet-sync activation stabilization database clock is unavailable');
  }
  const stored = row.value === null
    ? emptyStabilization()
    : parseWalletSyncActivationStabilization(row.value);
  assertStateNotFuture(stored, row.databaseNow);
  return {
    state: currentFloorState(stored),
    databaseNow: row.databaseNow,
  };
}

export async function readWalletSyncActivationStabilization(): Promise<
  WalletSyncActivationStabilization
> {
  return (await readStabilizationSnapshot()).state;
}

/**
 * Evaluate existing evidence without extending it. PostgreSQL supplies the
 * comparison clock so frequent admission inspections neither write nor depend
 * on application-host clock skew.
 */
export async function inspectWalletSyncActivationReadiness(
  input: InspectWalletSyncActivationReadinessInput,
): Promise<WalletSyncActivationStabilizationResult> {
  requireInspectionInput(input);
  const { state, databaseNow } = await readStabilizationSnapshot();
  const interval = readyInterval(state);
  const readyObservationAccepted = interval !== null
    && databaseNow.getTime() - Date.parse(interval.lastReadyAt)
      <= input.readyObservationMaxAgeMs;
  return {
    state,
    readyObservationAccepted,
    drainHorizonSatisfied: readyObservationAccepted && interval !== null && drainHorizonSatisfied(
      interval.candidateReadySince,
      interval.lastReadyAt,
      databaseNow,
      input.readyObservationMaxAgeMs,
      input.drainHorizonMs,
    ),
  };
}

/**
 * Serialize readiness evidence across replicas. The create-if-missing step is
 * followed by an explicit row lock so every observation updates one continuous
 * candidate interval or resets it atomically.
 */
export async function observeWalletSyncActivationReadiness(
  input: ObserveWalletSyncActivationReadinessInput,
): Promise<WalletSyncActivationStabilizationResult> {
  requireObservationInput(input);
  return prisma.$transaction(async (tx) => {
    const empty = emptyStabilization();
    await tx.systemSetting.createMany({
      data: [{
        key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
        value: JSON.stringify(empty),
      }],
      skipDuplicates: true,
    });
    const rows = await tx.$queryRaw<StabilizationRow[]>(Prisma.sql`
      SELECT "value"
      FROM "system_settings"
      WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) throw new Error('Wallet-sync activation stabilization row is unavailable');
    const clockRows = await tx.$queryRaw<Pick<StabilizationSnapshotRow, 'databaseNow'>[]>(Prisma.sql`
      SELECT clock_timestamp() AS "databaseNow"
    `);
    const recordedAt = clockRows[0]?.databaseNow;
    if (!(recordedAt instanceof Date) || !Number.isFinite(recordedAt.getTime())) {
      throw new Error('Wallet-sync activation stabilization database clock is unavailable');
    }
    const stored = parseWalletSyncActivationStabilization(row.value);
    assertStateNotFuture(stored, recordedAt);
    const current = currentFloorState(stored);
    const next = nextStabilization(current, input, recordedAt);
    const interval = readyInterval(next.state);
    await tx.systemSetting.update({
      where: { key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY },
      data: { value: JSON.stringify(next.state) },
    });
    return {
      state: next.state,
      readyObservationAccepted: next.accepted,
      drainHorizonSatisfied: next.accepted && interval !== null && drainHorizonSatisfied(
        interval.candidateReadySince,
        interval.lastReadyAt,
        recordedAt,
        input.readyObservationMaxAgeMs,
        input.drainHorizonMs,
      ),
    };
  });
}

export const walletSyncActivationStabilizationRepository = {
  inspect: inspectWalletSyncActivationReadiness,
  read: readWalletSyncActivationStabilization,
  observe: observeWalletSyncActivationReadiness,
};

export default walletSyncActivationStabilizationRepository;
