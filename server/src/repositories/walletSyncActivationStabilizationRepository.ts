import { z } from 'zod';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';
import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import { safeJsonParse } from '../utils/safeJson';
import {
  WALLET_SYNC_ACTIVATION_CONTINUITY_KEY,
  WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
} from './operationalSystemSettings';

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

export const WALLET_SYNC_ACTIVATION_CONTINUITY_VERSION = 1 as const;

// Stored under its own key so a rolled-back binary, which neither reads nor
// writes it, can still parse the v1 stabilization state. The record is bound
// to the exact stabilization row version (PostgreSQL `xmin`) and interval it
// describes; any write to that row by another binary changes the version and
// loses continuity, even when it writes byte-identical v1 state.
const continuitySchema = z.object({
  version: z.literal(WALLET_SYNC_ACTIVATION_CONTINUITY_VERSION),
  requiredMutationFenceFloor: z.number().int().min(1),
  stabilizationRowVersion: z.string().min(1),
  registryIncarnation: z.string().min(1),
  candidateReadySince: z.iso.datetime({ offset: true }).nullable(),
  lastReadyAt: z.iso.datetime({ offset: true }).nullable(),
  eligible: z.boolean(),
}).strict();

type WalletSyncActivationContinuity = z.infer<typeof continuitySchema>;

export type WalletSyncActivationReadinessObservation =
  | { status: 'ready'; observedAt: Date; registryIncarnation: string | null }
  | { status: 'blocked' | 'unavailable'; taint: boolean };

export interface ObserveWalletSyncActivationReadinessInput {
  observation: WalletSyncActivationReadinessObservation;
  evaluatedAt: Date;
  readyObservationMaxAgeMs: number;
  drainHorizonMs: number;
}

export interface InspectWalletSyncActivationReadinessInput {
  readyObservationMaxAgeMs: number;
  drainHorizonMs: number;
  registryIncarnation: string | null;
}

export interface WalletSyncActivationStabilizationResult {
  state: WalletSyncActivationStabilization;
  readyObservationAccepted: boolean;
  drainHorizonSatisfied: boolean;
  /**
   * - `held`: a full drain has completed with no tainting evidence and an
   *   unchanged registry incarnation since, so an already-active policy may
   *   re-admit on current exact readiness without draining again.
   * - `incarnation_changed` (inspect only): the registry incarnation differs
   *   from the recorded one, so Redis lost data since the last observation.
   * - `none`: neither.
   */
  continuity: WalletSyncActivationContinuityStatus;
}

export type WalletSyncActivationContinuityStatus = 'held' | 'incarnation_changed' | 'none';

interface StabilizationRow {
  value: string;
  rowVersion: string;
}

interface StabilizationSnapshotRow {
  value: string | null;
  rowVersion: string | null;
  continuity: string | null;
  databaseNow: Date;
}

interface LockedClockRow {
  databaseNow: Date;
  continuity: string | null;
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

/** Malformed continuity only forfeits the fast path; it never blocks the drain. */
function parseContinuity(value: string | null): WalletSyncActivationContinuity | null {
  if (value === null) return null;
  return safeJsonParse(value, continuitySchema.nullable(), null, WALLET_SYNC_ACTIVATION_CONTINUITY_KEY);
}

function boundContinuity(
  continuity: WalletSyncActivationContinuity | null,
  state: WalletSyncActivationStabilization,
  rowVersion: string | null,
): WalletSyncActivationContinuity | null {
  if (
    continuity === null
    || rowVersion === null
    || continuity.stabilizationRowVersion !== rowVersion
    || continuity.requiredMutationFenceFloor !== WALLET_SYNC_MUTATION_FENCE_FLOOR
    || state.requiredMutationFenceFloor !== WALLET_SYNC_MUTATION_FENCE_FLOOR
    || continuity.candidateReadySince !== state.candidateReadySince
    || continuity.lastReadyAt !== state.lastReadyAt
  ) {
    return null;
  }
  return continuity;
}

/** The row version is filled in once the stabilization row write is known. */
type UnboundContinuity = Omit<WalletSyncActivationContinuity, 'stabilizationRowVersion'>;

function bindContinuity(
  state: WalletSyncActivationStabilization,
  registryIncarnation: string,
  eligible: boolean,
): UnboundContinuity {
  return {
    version: WALLET_SYNC_ACTIVATION_CONTINUITY_VERSION,
    requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    registryIncarnation,
    candidateReadySince: state.candidateReadySince,
    lastReadyAt: state.lastReadyAt,
    eligible,
  };
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

interface StabilizationTransition {
  state: WalletSyncActivationStabilization;
  continuity: UnboundContinuity | null;
  accepted: boolean;
  drainSatisfied: boolean;
}

function transition(
  current: WalletSyncActivationStabilization,
  previous: WalletSyncActivationContinuity | null,
  input: ObserveWalletSyncActivationReadinessInput,
  recordedAt: Date,
): StabilizationTransition {
  const { observation } = input;
  const rebindPrevious = (state: WalletSyncActivationStabilization) => (previous === null
    ? null
    : bindContinuity(state, previous.registryIncarnation, previous.eligible));
  if (observation.status !== 'ready') {
    // Every non-ready observation resets the interval; only tainting evidence
    // also forfeits the completed drain.
    const state = emptyStabilization();
    return {
      state,
      continuity: observation.taint ? null : rebindPrevious(state),
      accepted: false,
      drainSatisfied: false,
    };
  }
  const observationAgeMs = input.evaluatedAt.getTime() - observation.observedAt.getTime();
  if (observationAgeMs > input.readyObservationMaxAgeMs) {
    const state = emptyStabilization();
    return { state, continuity: rebindPrevious(state), accepted: false, drainSatisfied: false };
  }
  const { registryIncarnation } = observation;
  // A missing nonce read keeps the interval but cannot carry continuity.
  // Otherwise unknown history (no record bound to this exact row version and
  // interval, as after an upgrade or a write by another binary) or a changed
  // registry incarnation (Redis lost data) restarts the interval as if tainted.
  const continuous = previous !== null
    && registryIncarnation !== null
    && previous.registryIncarnation === registryIncarnation;
  const state = projectReadyObservation(
    continuous || registryIncarnation === null ? current : emptyStabilization(),
    recordedAt,
    input.readyObservationMaxAgeMs,
  );
  const interval = readyInterval(state);
  const drainSatisfied = interval !== null && drainHorizonSatisfied(
    interval.candidateReadySince,
    interval.lastReadyAt,
    recordedAt,
    input.readyObservationMaxAgeMs,
    input.drainHorizonMs,
  );
  const continuity = registryIncarnation === null
    ? null
    : bindContinuity(
      state,
      registryIncarnation,
      (continuous && previous.eligible) || drainSatisfied,
    );
  return { state, continuity, accepted: true, drainSatisfied };
}

async function readStabilizationSnapshot(): Promise<{
  state: WalletSyncActivationStabilization;
  continuity: WalletSyncActivationContinuity | null;
  databaseNow: Date;
}> {
  const rows = await prisma.$queryRaw<StabilizationSnapshotRow[]>(Prisma.sql`
    SELECT
      (
        SELECT "value"
        FROM "system_settings"
        WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
      ) AS "value",
      (
        SELECT xmin::text
        FROM "system_settings"
        WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
      ) AS "rowVersion",
      (
        SELECT "value"
        FROM "system_settings"
        WHERE "key" = ${WALLET_SYNC_ACTIVATION_CONTINUITY_KEY}
      ) AS "continuity",
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
  const state = currentFloorState(stored);
  return {
    state,
    continuity: boundContinuity(parseContinuity(row.continuity), state, row.rowVersion),
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
  const { state, continuity, databaseNow } = await readStabilizationSnapshot();
  const interval = readyInterval(state);
  const readyObservationAccepted = interval !== null
    && databaseNow.getTime() - Date.parse(interval.lastReadyAt)
      <= input.readyObservationMaxAgeMs;
  let continuityStatus: WalletSyncActivationContinuityStatus = 'none';
  if (continuity !== null && continuity.registryIncarnation !== input.registryIncarnation) {
    continuityStatus = 'incarnation_changed';
  } else if (readyObservationAccepted && continuity?.eligible) {
    continuityStatus = 'held';
  }
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
    continuity: continuityStatus,
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
      SELECT "value", xmin::text AS "rowVersion"
      FROM "system_settings"
      WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) throw new Error('Wallet-sync activation stabilization row is unavailable');
    // The stabilization row lock above serializes every writer of the
    // continuity key, so it is read alongside the post-lock clock.
    const clockRows = await tx.$queryRaw<LockedClockRow[]>(Prisma.sql`
      SELECT
        clock_timestamp() AS "databaseNow",
        (
          SELECT "value"
          FROM "system_settings"
          WHERE "key" = ${WALLET_SYNC_ACTIVATION_CONTINUITY_KEY}
        ) AS "continuity"
    `);
    const recordedAt = clockRows[0]?.databaseNow;
    if (!(recordedAt instanceof Date) || !Number.isFinite(recordedAt.getTime())) {
      throw new Error('Wallet-sync activation stabilization database clock is unavailable');
    }
    const stored = parseWalletSyncActivationStabilization(row.value);
    assertStateNotFuture(stored, recordedAt);
    const current = currentFloorState(stored);
    const storedContinuity = clockRows[0]?.continuity ?? null;
    const previous = boundContinuity(parseContinuity(storedContinuity), current, row.rowVersion);
    const next = transition(current, previous, input, recordedAt);

    // Skip writes that would change nothing; a steadily blocked fleet otherwise
    // rewrites both rows on every observation.
    const nextState = JSON.stringify(next.state);
    let rowVersion = row.rowVersion;
    if (nextState !== row.value) {
      const updated = await tx.$queryRaw<Pick<StabilizationRow, 'rowVersion'>[]>(Prisma.sql`
        UPDATE "system_settings"
        SET "value" = ${nextState}, "updatedAt" = clock_timestamp()
        WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
        RETURNING xmin::text AS "rowVersion"
      `);
      const updatedVersion = updated[0]?.rowVersion;
      if (!updatedVersion) throw new Error('Wallet-sync activation stabilization row is unavailable');
      rowVersion = updatedVersion;
    }
    // Schema field order, so an unchanged record serializes byte-identically.
    const continuity: WalletSyncActivationContinuity | null = next.continuity === null
      ? null
      : {
        version: next.continuity.version,
        requiredMutationFenceFloor: next.continuity.requiredMutationFenceFloor,
        stabilizationRowVersion: rowVersion,
        registryIncarnation: next.continuity.registryIncarnation,
        candidateReadySince: next.continuity.candidateReadySince,
        lastReadyAt: next.continuity.lastReadyAt,
        eligible: next.continuity.eligible,
      };
    const nextContinuity = continuity === null ? null : JSON.stringify(continuity);
    if (nextContinuity === null) {
      if (storedContinuity !== null) {
        await tx.systemSetting.deleteMany({ where: { key: WALLET_SYNC_ACTIVATION_CONTINUITY_KEY } });
      }
    } else if (nextContinuity !== storedContinuity) {
      await tx.systemSetting.upsert({
        where: { key: WALLET_SYNC_ACTIVATION_CONTINUITY_KEY },
        create: { key: WALLET_SYNC_ACTIVATION_CONTINUITY_KEY, value: nextContinuity },
        update: { value: nextContinuity },
      });
    }
    return {
      state: next.state,
      readyObservationAccepted: next.accepted,
      drainHorizonSatisfied: next.accepted && next.drainSatisfied,
      continuity: next.accepted && continuity?.eligible ? 'held' : 'none',
    };
  });
}

export const walletSyncActivationStabilizationRepository = {
  inspect: inspectWalletSyncActivationReadiness,
  read: readWalletSyncActivationStabilization,
  observe: observeWalletSyncActivationReadiness,
};

export default walletSyncActivationStabilizationRepository;
