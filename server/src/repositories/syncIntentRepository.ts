import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import type {
  IncrementalSyncClaimResult,
  IncrementalSyncFence,
  IncrementalSyncIntentState,
  IncrementalSyncRequestMode,
  IncrementalSyncRequestResult,
  IncrementalSyncTerminalResult,
} from './types';

const MAX_RECOVERY_BATCH_SIZE = 100;
const MAX_SYNC_GENERATION = 2_147_483_647;
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

interface RequestRow extends IncrementalSyncIntentState {
  previousRequestedGeneration: number;
}

export interface IncrementalSyncClaimInput {
  leaseToken: string;
  claimedAt: Date;
  leaseExpiresAt: Date;
  expectedExpiredFence?: IncrementalSyncFence;
}

export interface IncrementalSyncRetryReleaseInput {
  nextRetryAt: Date;
  releasedAt: Date;
}

function recoveryLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_RECOVERY_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Sync intent recovery limit must be a positive integer');
  }
  return Math.min(limit, MAX_RECOVERY_BATCH_SIZE);
}

function requireFence(fence: IncrementalSyncFence): void {
  if (
    !Number.isInteger(fence.generation)
    || fence.generation < 1
    || fence.generation > MAX_SYNC_GENERATION
  ) {
    throw new Error('Incremental sync fence generation is outside the supported range');
  }
  if (!UUID_PATTERN.test(fence.leaseToken)) {
    throw new Error('Incremental sync fence token must be a UUID');
  }
}

function requireDate(value: Date, description: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${description} must be a valid date`);
  }
}

function requireClaimInput(input: IncrementalSyncClaimInput): void {
  requireFence({ generation: 1, leaseToken: input.leaseToken });
  requireDate(input.claimedAt, 'Incremental sync claim time');
  requireDate(input.leaseExpiresAt, 'Incremental sync lease expiry');
  if (input.leaseExpiresAt.getTime() <= input.claimedAt.getTime()) {
    throw new Error('Incremental sync lease must expire after it is claimed');
  }
  if (input.expectedExpiredFence) {
    requireFence(input.expectedExpiredFence);
    if (input.expectedExpiredFence.leaseToken === input.leaseToken) {
      throw new Error('Reclaimed incremental sync work requires a new fence token');
    }
  }
}

function terminalResult(
  rows: IncrementalSyncIntentState[],
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
 */
export async function claimIncrementalSync(
  walletId: string,
  input: IncrementalSyncClaimInput,
): Promise<IncrementalSyncClaimResult> {
  requireClaimInput(input);
  const expectedGeneration = input.expectedExpiredFence?.generation ?? null;
  const expectedToken = input.expectedExpiredFence?.leaseToken ?? null;
  const rows = await prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = "requestedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = ${input.leaseToken}::UUID,
        "incrementalSyncClaimedAt" = ${input.claimedAt},
        "incrementalSyncLeaseExpiresAt" = ${input.leaseExpiresAt},
        "syncNextRetryAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${walletId}
      AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      AND ("syncNextRetryAt" IS NULL OR "syncNextRetryAt" <= ${input.claimedAt})
      AND (
        (
          ${expectedGeneration}::INTEGER IS NULL
          AND "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
        )
        OR (
          ${expectedGeneration}::INTEGER IS NOT NULL
          AND "claimedIncrementalSyncGeneration" = ${expectedGeneration}
          AND "incrementalSyncLeaseToken" = ${expectedToken}::UUID
          AND "incrementalSyncLeaseExpiresAt" <= ${input.claimedAt}
        )
      )
    RETURNING
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
  `);
  const state = rows[0];
  if (!state) return { status: 'not_claimed' };
  return {
    status: 'claimed',
    claim: {
      generation: state.claimedIncrementalSyncGeneration,
      leaseToken: input.leaseToken,
      claimedAt: input.claimedAt,
      leaseExpiresAt: input.leaseExpiresAt,
    },
    state,
  };
}

/** Complete only the exact claimed generation owned by this lease token. */
export async function completeIncrementalSync(
  walletId: string,
  fence: IncrementalSyncFence,
): Promise<IncrementalSyncTerminalResult> {
  requireFence(fence);
  const rows = await prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "processedIncrementalSyncGeneration" = "claimedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = 0,
        "syncNextRetryAt" = NULL,
        "syncActionRequiredAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING
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
  const rows = await prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = "syncRetryCount" + 1,
        "syncNextRetryAt" = ${input.nextRetryAt},
        "syncActionRequiredAt" = NULL,
        "updatedAt" = ${input.releasedAt}
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING
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
  `);
  return terminalResult(rows);
}

/** Release a fenced claim into visible, deliberately reopened terminal state. */
export async function releaseIncrementalSyncAsActionRequired(
  walletId: string,
  fence: IncrementalSyncFence,
  actionRequiredAt: Date,
): Promise<IncrementalSyncTerminalResult> {
  requireFence(fence);
  requireDate(actionRequiredAt, 'Incremental sync action-required time');
  const rows = await prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    UPDATE "wallets"
    SET "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration",
        "incrementalSyncLeaseToken" = NULL,
        "incrementalSyncClaimedAt" = NULL,
        "incrementalSyncLeaseExpiresAt" = NULL,
        "syncRetryCount" = "syncRetryCount" + 1,
        "syncNextRetryAt" = NULL,
        "syncActionRequiredAt" = ${actionRequiredAt},
        "updatedAt" = ${actionRequiredAt}
    WHERE "id" = ${walletId}
      AND "claimedIncrementalSyncGeneration" = ${fence.generation}
      AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "incrementalSyncLeaseToken" = ${fence.leaseToken}::UUID
    RETURNING
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
  `);
  return terminalResult(rows);
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
      AND (
        "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
        OR "incrementalSyncLeaseExpiresAt" <= ${options.now}
      )
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
  findActionableIncrementalSyncIntents,
};

export default syncIntentRepository;
