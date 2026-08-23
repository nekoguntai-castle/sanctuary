import { Prisma } from '../generated/prisma/client';
import {
  isWalletSyncFailureClass,
  type WalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';
import prisma, { type PrismaTxClient } from '../models/prisma';
import type {
  IncrementalSyncClaimResult,
  IncrementalSyncFence,
  IncrementalSyncIntentState,
  IncrementalSyncLifecycleState,
  IncrementalSyncRequestMode,
  IncrementalSyncRequestResult,
  IncrementalSyncTerminalResult,
  WalletSyncMutationFence,
} from './types';

const MAX_RECOVERY_BATCH_SIZE = 100;
const MAX_SYNC_GENERATION = 2_147_483_647;
// Preserve the deliberate ceiling used by wallet-sized SQL repair statements.
// Mutation units remain logically bounded and never include network work.
const WALLET_SYNC_MUTATION_TIMEOUT_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const syncIntentSelect = {
  id: true,
  requestedIncrementalSyncGeneration: true,
  claimedIncrementalSyncGeneration: true,
  processedIncrementalSyncGeneration: true,
  incrementalSyncLeaseToken: true,
  incrementalSyncClaimedAt: true,
  incrementalSyncLeaseExpiresAt: true,
  syncRetryCount: true,
  syncNextRetryAt: true,
  syncActionRequiredAt: true,
  requestedFullResyncGeneration: true,
  preparedFullResyncGeneration: true,
  processedFullResyncGeneration: true,
} satisfies Prisma.WalletSelect;

const lifecycleReturningColumns = Prisma.raw(`
  "id",
  "requestedIncrementalSyncGeneration",
  "claimedIncrementalSyncGeneration",
  "processedIncrementalSyncGeneration",
  "incrementalSyncLeaseToken",
  "incrementalSyncClaimedAt",
  "incrementalSyncLeaseExpiresAt",
  "syncRetryCount",
  "syncNextRetryAt",
  "syncActionRequiredAt",
  "requestedFullResyncGeneration",
  "preparedFullResyncGeneration",
  "processedFullResyncGeneration",
  "syncInProgress",
  "lastSyncedAt",
  "lastSyncedBlockHeight",
  "lastSyncStatus",
  "lastSyncError",
  "lastSyncFailureClass",
  "syncExecutionOwner",
  "syncStartedAt",
  "syncStateVersion"
`);

interface RequestRow extends IncrementalSyncIntentState {
  previousRequestedGeneration: number;
}

export interface IncrementalSyncClaimInput {
  leaseToken: string;
  claimedAt: Date;
  leaseExpiresAt: Date;
  expectedRequestedGeneration: number;
  expectedExpiredFence?: WalletSyncMutationFence;
}

export interface IncrementalSyncRetryReleaseInput {
  nextRetryAt: Date;
  releasedAt: Date;
  errorMessage: string;
  failureClass: WalletSyncFailureClass;
}

export interface IncrementalSyncSuccessInput {
  syncedAt: Date;
  lastSyncedBlockHeight: number;
}

export interface IncrementalSyncActionRequiredReleaseInput {
  actionRequiredAt: Date;
  errorMessage: string;
  failureClass: WalletSyncFailureClass;
}

export interface ExpiredIncrementalSyncClaimCursor {
  leaseExpiresAt: Date;
  walletId: string;
}

export interface ExpiredIncrementalSyncClaim extends ExpiredIncrementalSyncClaimCursor {
  generation: number;
  leaseToken: string;
}

function recoveryLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_RECOVERY_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Sync intent recovery limit must be a positive integer');
  }
  return Math.min(limit, MAX_RECOVERY_BATCH_SIZE);
}

function requireGeneration(generation: number): void {
  const supported = [
    Number.isInteger(generation),
    generation >= 1,
    generation <= MAX_SYNC_GENERATION,
  ].every(Boolean);
  if (!supported) {
    throw new Error('Incremental sync fence generation is outside the supported range');
  }
}

function requireWalletId(walletId: string): void {
  if (walletId.trim().length === 0) {
    throw new Error('Wallet sync mutation fence wallet ID must not be empty');
  }
}

function requireFence(fence: IncrementalSyncFence): void {
  requireGeneration(fence.generation);
  if (!UUID_PATTERN.test(fence.leaseToken)) {
    throw new Error('Incremental sync fence token must be a UUID');
  }
}

function requireDate(value: Date, description: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${description} must be a valid date`);
  }
}

function requireMutationFence(fence: WalletSyncMutationFence): void {
  requireWalletId(fence.walletId);
  requireFence(fence);
}

function requireExpiredClaimCursor(cursor: ExpiredIncrementalSyncClaimCursor): void {
  requireDate(cursor.leaseExpiresAt, 'Expired incremental sync claim cursor time');
  requireWalletId(cursor.walletId);
}

function requireClaimInput(walletId: string, input: IncrementalSyncClaimInput): void {
  requireWalletId(walletId);
  requireFence({ generation: 1, leaseToken: input.leaseToken });
  requireGeneration(input.expectedRequestedGeneration ?? 0);
  requireDate(input.claimedAt, 'Incremental sync claim time');
  requireDate(input.leaseExpiresAt, 'Incremental sync lease expiry');
  if (input.leaseExpiresAt.getTime() <= input.claimedAt.getTime()) {
    throw new Error('Incremental sync lease must expire after it is claimed');
  }
  if (input.expectedExpiredFence !== undefined) {
    requireMutationFence(input.expectedExpiredFence);
    if (input.expectedExpiredFence.walletId !== walletId) {
      throw new Error('Expired incremental sync fence belongs to another wallet');
    }
    if (input.expectedExpiredFence.generation !== input.expectedRequestedGeneration) {
      throw new Error('Expired incremental sync fence generation must match the requested generation');
    }
    if (input.expectedExpiredFence.leaseToken === input.leaseToken) {
      throw new Error('Expired incremental sync reclaim must rotate the lease token');
    }
  }
}

interface LockedMutationFenceRow {
  claimedIncrementalSyncGeneration: number;
  incrementalSyncLeaseToken: string | null;
}

/** A short mutation transaction no longer owns the exact wallet-sync fence. */
export class WalletSyncMutationFenceLostError extends Error {
  readonly code = 'wallet_sync_mutation_fence_lost';
  readonly fence: WalletSyncMutationFence;

  constructor(fence: WalletSyncMutationFence) {
    super('Wallet sync mutation fence is no longer authoritative');
    this.name = 'WalletSyncMutationFenceLostError';
    this.fence = Object.freeze({ ...fence });
  }
}

/**
 * Repository-owned short transaction for non-sync or compatibility mutations
 * that do not claim wallet-sync lease authority. Canonical sync writes must use
 * `withWalletSyncMutationFence` instead.
 */
export async function withWalletSyncMutationTransaction<T>(
  callback: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(callback);
}

/**
 * Run one canonical mutation unit under the exact wallet generation/token.
 * The row lock and writes share one short transaction; callers must finish the
 * callback before resuming network I/O. PostgreSQL renders UUID text in lower
 * case, so token comparison normalizes case without changing UUID identity.
 */
export async function withWalletSyncMutationFence<T>(
  fence: WalletSyncMutationFence,
  callback: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  requireMutationFence(fence);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedMutationFenceRow[]>(Prisma.sql`
      SELECT
        "claimedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken"::TEXT AS "incrementalSyncLeaseToken"
      FROM "wallets"
      WHERE "id" = ${fence.walletId}
      FOR UPDATE
    `);
    const locked = rows[0];
    if (!locked
      || locked.claimedIncrementalSyncGeneration !== fence.generation
      || locked.incrementalSyncLeaseToken?.toLowerCase() !== fence.leaseToken.toLowerCase()) {
      throw new WalletSyncMutationFenceLostError(fence);
    }
    return callback(tx);
  }, { timeout: WALLET_SYNC_MUTATION_TIMEOUT_MS });
}

function requireFailureMetadata(errorMessage: string, failureClass: unknown): void {
  const valid = [
    errorMessage.trim().length > 0,
    isWalletSyncFailureClass(failureClass),
  ].every(Boolean);
  if (!valid) {
    throw new Error('Incremental sync failure metadata is invalid');
  }
}

function requireSuccessInput(
  input: IncrementalSyncSuccessInput | undefined,
): IncrementalSyncSuccessInput {
  if (!input) throw new Error('Incremental sync completion requires success metadata');
  requireDate(input.syncedAt, 'Incremental sync completion time');
  const validHeight = [
    Number.isInteger(input.lastSyncedBlockHeight),
    input.lastSyncedBlockHeight >= 0,
  ].every(Boolean);
  if (!validHeight) {
    throw new Error('Incremental sync block height must be a non-negative integer');
  }
  return input;
}

function terminalResult(
  rows: IncrementalSyncLifecycleState[],
): IncrementalSyncTerminalResult {
  const state = rows[0];
  if (!state) return { status: 'lost_fence' };
  return {
    status: 'applied',
    state,
    trailingGenerationPending:
      state.requestedIncrementalSyncGeneration > state.processedIncrementalSyncGeneration,
  };
}

export async function findIncrementalSyncIntent(
  walletId: string,
): Promise<IncrementalSyncIntentState | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    select: syncIntentSelect,
  }) as Promise<IncrementalSyncIntentState | null>;
}

/**
 * Persist one coalesced request. Pending work remains one generation ahead of
 * the active claim, so any number of triggers during execution produce at most
 * one trailing pass.
 */
export async function requestIncrementalSync(
  walletId: string,
  mode: IncrementalSyncRequestMode = 'automatic',
): Promise<IncrementalSyncRequestResult> {
  const explicitReopen = mode === 'explicit_reopen';
  const rows = await prisma.$queryRaw<RequestRow[]>(Prisma.sql`
    WITH current AS (
      SELECT "id",
             "requestedIncrementalSyncGeneration",
             "claimedIncrementalSyncGeneration"
      FROM "wallets"
      WHERE "id" = ${walletId}
      FOR UPDATE
    )
    UPDATE "wallets" AS wallet
    SET "requestedIncrementalSyncGeneration" = GREATEST(
          wallet."requestedIncrementalSyncGeneration"::BIGINT,
          wallet."claimedIncrementalSyncGeneration"::BIGINT + 1
        )::INTEGER,
        "syncActionRequiredAt" = CASE
          WHEN ${explicitReopen} THEN NULL
          ELSE wallet."syncActionRequiredAt"
        END,
        "syncNextRetryAt" = CASE
          WHEN ${explicitReopen} THEN NULL
          ELSE wallet."syncNextRetryAt"
        END,
        "syncRetryCount" = CASE
          WHEN ${explicitReopen} THEN 0
          ELSE wallet."syncRetryCount"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM current
    WHERE wallet."id" = current."id"
      AND GREATEST(
        current."requestedIncrementalSyncGeneration"::BIGINT,
        current."claimedIncrementalSyncGeneration"::BIGINT + 1
      ) <= ${MAX_SYNC_GENERATION}
    RETURNING
      wallet."id",
      wallet."requestedIncrementalSyncGeneration",
      wallet."claimedIncrementalSyncGeneration",
      wallet."processedIncrementalSyncGeneration",
      wallet."incrementalSyncLeaseToken",
      wallet."incrementalSyncClaimedAt",
      wallet."incrementalSyncLeaseExpiresAt",
      wallet."syncRetryCount",
      wallet."syncNextRetryAt",
      wallet."syncActionRequiredAt",
      wallet."requestedFullResyncGeneration",
      wallet."preparedFullResyncGeneration",
      wallet."processedFullResyncGeneration",
      current."requestedIncrementalSyncGeneration" AS "previousRequestedGeneration"
  `);
  const row = rows[0];
  if (!row) {
    const state = await findIncrementalSyncIntent(walletId);
    return { status: state ? 'generation_exhausted' : 'not_found' };
  }
  const { previousRequestedGeneration, ...state } = row;
  return {
    status: state.requestedIncrementalSyncGeneration > previousRequestedGeneration
      ? 'requested'
      : 'merged',
    state,
  };
}

/**
 * Claim pending work after the caller has acquired the wallet execution lock.
 * Reclaiming an expired lease additionally requires the exact previous fence.
 * The reclaim keeps that old claimed generation while rotating its token; a
 * newer requested generation is deliberately left pending as a trailing pass.
 */
export async function claimIncrementalSync(
  walletId: string,
  input: IncrementalSyncClaimInput,
): Promise<IncrementalSyncClaimResult> {
  requireClaimInput(walletId, input);
  const expectedGeneration = input.expectedRequestedGeneration!;
  const expectedExpiredFence = input.expectedExpiredFence;
  const eligibility = expectedExpiredFence === undefined
    ? Prisma.sql`
      AND "requestedIncrementalSyncGeneration" = ${expectedGeneration}
      AND "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
    `
    : Prisma.sql`
      AND "claimedIncrementalSyncGeneration" = ${expectedExpiredFence.generation}
      AND "incrementalSyncLeaseToken" = ${expectedExpiredFence.leaseToken}::UUID
      AND "incrementalSyncLeaseExpiresAt" IS NOT NULL
      AND "incrementalSyncLeaseExpiresAt" <= ${input.claimedAt}
    `;
  const rows = await prisma.$queryRaw<IncrementalSyncLifecycleState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = ${expectedGeneration},
        "incrementalSyncLeaseToken" = ${input.leaseToken}::UUID,
        "incrementalSyncClaimedAt" = ${input.claimedAt},
        "incrementalSyncLeaseExpiresAt" = ${input.leaseExpiresAt},
        "syncInProgress" = TRUE,
        "lastSyncStatus" = 'syncing',
        "lastSyncError" = NULL,
        "lastSyncFailureClass" = NULL,
        "syncExecutionOwner" = 'worker',
        "syncNextRetryAt" = NULL,
        "syncStartedAt" = ${input.claimedAt},
        "syncStateVersion" = "syncStateVersion" + 1,
        "updatedAt" = ${input.claimedAt}
    WHERE "id" = ${walletId}
      AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "requestedIncrementalSyncGeneration" >= ${expectedGeneration}
      AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      AND ("syncNextRetryAt" IS NULL OR "syncNextRetryAt" <= ${input.claimedAt})
      ${eligibility}
    RETURNING ${lifecycleReturningColumns}
  `);
  const state = rows[0];
  if (!state) {
    const current = await findIncrementalSyncIntent(walletId);
    if (current
      && current.claimedIncrementalSyncGeneration === expectedGeneration
      && current.processedIncrementalSyncGeneration < expectedGeneration) {
      return { status: 'already_claimed' };
    }
    return { status: 'not_claimed' };
  }
  return {
    status: 'claimed',
    claim: Object.freeze({
      walletId,
      generation: state.claimedIncrementalSyncGeneration,
      leaseToken: input.leaseToken,
      claimedAt: input.claimedAt,
      leaseExpiresAt: input.leaseExpiresAt,
    }),
    state,
  };
}

/** Complete only the exact claimed generation owned by this lease token. */
export async function completeIncrementalSync(
  walletId: string,
  fence: IncrementalSyncFence,
  success: IncrementalSyncSuccessInput,
): Promise<IncrementalSyncTerminalResult> {
  requireFence(fence);
  const completed = requireSuccessInput(success);
  const rows = await prisma.$queryRaw<IncrementalSyncLifecycleState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "processedIncrementalSyncGeneration" = "claimedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = 0,
        "syncNextRetryAt" = NULL,
        "syncActionRequiredAt" = NULL,
        "syncInProgress" = FALSE,
        "lastSyncedAt" = ${completed.syncedAt},
        "lastSyncedBlockHeight" = ${completed.lastSyncedBlockHeight},
        "lastSyncStatus" = 'success',
        "lastSyncError" = NULL,
        "lastSyncFailureClass" = NULL,
        "syncExecutionOwner" = NULL,
        "syncStartedAt" = NULL,
        "syncStateVersion" = "syncStateVersion" + 1,
        "updatedAt" = ${completed.syncedAt}
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING ${lifecycleReturningColumns}
  `);
  return terminalResult(rows);
}

/** Release a fenced claim into bounded automatic retry. */
export async function releaseIncrementalSyncForRetry(
  walletId: string,
  fence: IncrementalSyncFence,
  input: IncrementalSyncRetryReleaseInput,
): Promise<IncrementalSyncTerminalResult> {
  requireFence(fence);
  requireDate(input.releasedAt, 'Incremental sync release time');
  requireDate(input.nextRetryAt, 'Incremental sync retry time');
  if (input.nextRetryAt.getTime() <= input.releasedAt.getTime()) {
    throw new Error('Incremental sync retry must be scheduled in the future');
  }
  const { errorMessage, failureClass } = input;
  requireFailureMetadata(errorMessage, failureClass);
  const rows = await prisma.$queryRaw<IncrementalSyncLifecycleState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = "syncRetryCount" + 1,
        "syncNextRetryAt" = ${input.nextRetryAt},
        "syncActionRequiredAt" = NULL,
        "syncInProgress" = FALSE,
        "lastSyncStatus" = 'retrying',
        "lastSyncError" = ${errorMessage},
        "lastSyncFailureClass" = ${failureClass},
        "syncExecutionOwner" = 'worker',
        "syncStartedAt" = NULL,
        "syncStateVersion" = "syncStateVersion" + 1,
        "updatedAt" = ${input.releasedAt}
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING ${lifecycleReturningColumns}
  `);
  return terminalResult(rows);
}

/** Release a fenced claim into visible, deliberately reopened terminal state. */
export async function releaseIncrementalSyncAsActionRequired(
  walletId: string,
  fence: IncrementalSyncFence,
  input: IncrementalSyncActionRequiredReleaseInput,
): Promise<IncrementalSyncTerminalResult> {
  requireFence(fence);
  const { actionRequiredAt, errorMessage, failureClass } = input;
  requireDate(actionRequiredAt, 'Incremental sync action-required time');
  requireFailureMetadata(errorMessage, failureClass);
  const rows = await prisma.$queryRaw<IncrementalSyncLifecycleState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = "syncRetryCount" + 1,
        "syncNextRetryAt" = NULL,
        "syncActionRequiredAt" = ${actionRequiredAt},
        "syncInProgress" = FALSE,
        "lastSyncStatus" = 'failed',
        "lastSyncError" = ${errorMessage},
        "lastSyncFailureClass" = ${failureClass},
        "syncExecutionOwner" = NULL,
        "syncStartedAt" = NULL,
        "syncStateVersion" = "syncStateVersion" + 1,
        "updatedAt" = ${actionRequiredAt}
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING ${lifecycleReturningColumns}
  `);
  return terminalResult(rows);
}

/**
 * Read one bounded, due-time ordered page of exact expired claim identities.
 * This reader never probes execution locks or rotates a lease; those authority
 * checks remain in admission and the lock-owning canonical consumer. The
 * composite cursor matches the existing partial expiry index.
 */
export async function findExpiredIncrementalSyncClaims(options: {
  now: Date;
  cursor?: ExpiredIncrementalSyncClaimCursor;
  limit?: number;
}): Promise<ExpiredIncrementalSyncClaim[]> {
  requireDate(options.now, 'Expired incremental sync claim recovery time');
  if (options.cursor) requireExpiredClaimCursor(options.cursor);
  const limit = recoveryLimit(options.limit);
  const cursor = options.cursor;

  return prisma.$queryRaw<ExpiredIncrementalSyncClaim[]>(Prisma.sql`
    SELECT
      "id" AS "walletId",
      "claimedIncrementalSyncGeneration" AS "generation",
      "incrementalSyncLeaseToken"::TEXT AS "leaseToken",
      "incrementalSyncLeaseExpiresAt" AS "leaseExpiresAt"
    FROM "wallets"
    WHERE "incrementalSyncLeaseExpiresAt" <= ${options.now}
      AND "incrementalSyncLeaseExpiresAt" IS NOT NULL
      AND "incrementalSyncLeaseToken" IS NOT NULL
      AND "claimedIncrementalSyncGeneration" >= 1
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "requestedIncrementalSyncGeneration" >= "claimedIncrementalSyncGeneration"
      AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      AND ("syncNextRetryAt" IS NULL OR "syncNextRetryAt" <= ${options.now})
      ${cursor ? Prisma.sql`
        AND (
          "incrementalSyncLeaseExpiresAt" > ${cursor.leaseExpiresAt}
          OR (
            "incrementalSyncLeaseExpiresAt" = ${cursor.leaseExpiresAt}
            AND "id" > ${cursor.walletId}
          )
        )
      ` : Prisma.empty}
    ORDER BY "incrementalSyncLeaseExpiresAt" ASC, "id" ASC
    LIMIT ${limit}
  `);
}

/** Read a bounded page for wake-up repair; this function never reclaims. */
export async function findActionableIncrementalSyncIntents(options: {
  now: Date;
  cursor?: string;
  limit?: number;
}): Promise<IncrementalSyncIntentState[]> {
  const limit = recoveryLimit(options.limit);
  const cursor = options.cursor ?? '';

  return prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    SELECT
      "id",
      "requestedIncrementalSyncGeneration",
      "claimedIncrementalSyncGeneration",
      "processedIncrementalSyncGeneration",
      "incrementalSyncLeaseToken",
      "incrementalSyncClaimedAt",
      "incrementalSyncLeaseExpiresAt",
      "syncRetryCount",
      "syncNextRetryAt",
      "syncActionRequiredAt",
      "requestedFullResyncGeneration",
      "preparedFullResyncGeneration",
      "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "id" > ${cursor}
      AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      AND (
        "syncNextRetryAt" IS NULL
        OR "syncNextRetryAt" <= ${options.now}
      )
      AND "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
    ORDER BY "id" ASC
    LIMIT ${limit}
  `);
}

export const syncIntentRepository = {
  findIncrementalSyncIntent,
  requestIncrementalSync,
  claimIncrementalSync,
  completeIncrementalSync,
  releaseIncrementalSyncForRetry,
  releaseIncrementalSyncAsActionRequired,
  findExpiredIncrementalSyncClaims,
  findActionableIncrementalSyncIntents,
};

export default syncIntentRepository;
