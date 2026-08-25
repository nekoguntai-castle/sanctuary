import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import type {
  IncrementalSyncLifecycleState,
  SubscriptionCheckpointState,
  SubscriptionCheckpointSyncIntent,
  SubscriptionEnrollmentCompletionInput,
  SubscriptionEnrollmentCompletionResult,
} from './types';
import {
  resolvePersistedBitcoinNetwork,
  type BitcoinNetwork,
} from '../constants/bitcoinNetworks';

const MAX_SYNC_GENERATION = 2_147_483_647;

function persistedNetworkPredicate(column: string, network: BitcoinNetwork): Prisma.Sql {
  const sqlColumn = Prisma.raw(column);
  return network === 'testnet3'
    ? Prisma.sql`${sqlColumn} IN ('testnet3', 'testnet')`
    : Prisma.sql`${sqlColumn} = ${network}`;
}

const lifecycleSelect = {
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
  syncInProgress: true,
  lastSyncedAt: true,
  lastSyncedBlockHeight: true,
  lastSyncStatus: true,
  lastSyncError: true,
  lastSyncFailureClass: true,
  syncExecutionOwner: true,
  syncStartedAt: true,
  syncStateVersion: true,
} satisfies Prisma.WalletSelect;

interface LockedCompletionTarget extends IncrementalSyncLifecycleState {
  addressId: string;
  walletId: string;
  network: string;
}

class CompletionLostRace extends Error {}
class CompletionGenerationExhausted extends Error {}

async function lockTarget(
  tx: PrismaTxClient,
  input: SubscriptionEnrollmentCompletionInput,
): Promise<LockedCompletionTarget | null> {
  const walletNetwork = persistedNetworkPredicate('wallet."network"', input.network);
  const rows = await tx.$queryRaw<LockedCompletionTarget[]>(Prisma.sql`
    SELECT
      address."id" AS "addressId",
      wallet."id" AS "walletId",
      wallet."network",
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
      wallet."syncInProgress",
      wallet."lastSyncedAt",
      wallet."lastSyncedBlockHeight",
      wallet."lastSyncStatus",
      wallet."lastSyncError",
      wallet."lastSyncFailureClass",
      wallet."syncExecutionOwner",
      wallet."syncStartedAt",
      wallet."syncStateVersion"
    FROM "addresses" AS address
    INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
    WHERE address."id" = ${input.addressId}
      AND address."address" = ${input.address}
      AND ${walletNetwork}
    FOR UPDATE OF address, wallet
  `);
  return rows[0] ?? null;
}

function isEligible(
  current: SubscriptionCheckpointState | null,
  input: SubscriptionEnrollmentCompletionInput,
): boolean {
  if (!current) return input.generation === 1;
  return resolvePersistedBitcoinNetwork(current.network) === input.network
    && current.requestedEnrollmentGeneration === input.generation
    && current.processedEnrollmentGeneration < input.generation;
}

function requiresIntent(
  current: SubscriptionCheckpointState | null,
  observedStatus: string | null,
): boolean {
  if (!current?.statusKnown) return observedStatus !== null;
  return current.observedStatus !== observedStatus;
}

const checkpointColumns = Prisma.raw(`
  "addressId",
  "network",
  "scriptHash",
  "statusKnown",
  "observedStatus",
  "lastObservedAt",
  "requestedEnrollmentGeneration",
  "processedEnrollmentGeneration",
  "coverageGapStartedAt"
`);

async function writeCheckpoint(
  tx: PrismaTxClient,
  input: SubscriptionEnrollmentCompletionInput,
  missing: boolean,
): Promise<SubscriptionCheckpointState | null> {
  if (!missing) {
    const checkpointNetwork = persistedNetworkPredicate(
      'checkpoint."network"',
      input.network,
    );
    const rows = await tx.$queryRaw<SubscriptionCheckpointState[]>(Prisma.sql`
      UPDATE "address_subscription_checkpoints" AS checkpoint
      SET "network" = ${input.network},
          "scriptHash" = ${input.scriptHash},
          "statusKnown" = TRUE,
          "observedStatus" = ${input.observedStatus},
          "lastObservedAt" = ${input.observedAt},
          "processedEnrollmentGeneration" = ${input.generation},
          "coverageGapStartedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE checkpoint."addressId" = ${input.addressId}
        AND ${checkpointNetwork}
        AND checkpoint."requestedEnrollmentGeneration" = ${input.generation}
        AND checkpoint."processedEnrollmentGeneration" < ${input.generation}
      RETURNING ${checkpointColumns}
    `);
    return rows[0] ?? null;
  }

  const rows = await tx.$queryRaw<SubscriptionCheckpointState[]>(Prisma.sql`
    INSERT INTO "address_subscription_checkpoints" AS checkpoint (
      "addressId", "network", "scriptHash", "statusKnown", "observedStatus",
      "lastObservedAt", "requestedEnrollmentGeneration", "processedEnrollmentGeneration",
      "coverageGapStartedAt"
    ) VALUES (
      ${input.addressId}, ${input.network}, ${input.scriptHash}, TRUE,
      ${input.observedStatus}, ${input.observedAt}, 1, 1, NULL
    )
    ON CONFLICT ("addressId") DO UPDATE
    SET "network" = EXCLUDED."network",
        "scriptHash" = EXCLUDED."scriptHash",
        "statusKnown" = EXCLUDED."statusKnown",
        "observedStatus" = EXCLUDED."observedStatus",
        "lastObservedAt" = EXCLUDED."lastObservedAt",
        "processedEnrollmentGeneration" = EXCLUDED."processedEnrollmentGeneration",
        "coverageGapStartedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE (
        checkpoint."network" = EXCLUDED."network"
        OR (
          checkpoint."network" = 'testnet'
          AND EXCLUDED."network" = 'testnet3'
        )
      )
      AND checkpoint."requestedEnrollmentGeneration" = ${input.generation}
      AND checkpoint."processedEnrollmentGeneration" < ${input.generation}
    RETURNING ${checkpointColumns}
  `);
  return rows[0] ?? null;
}

async function applyIntent(
  tx: PrismaTxClient,
  target: LockedCompletionTarget,
): Promise<SubscriptionCheckpointSyncIntent> {
  // Coalesce with an already-pending request; otherwise reserve exactly one
  // generation after the active claim so activity during execution becomes a
  // trailing pass rather than being absorbed by the current owner.
  const generation = Math.max(
    target.requestedIncrementalSyncGeneration,
    target.claimedIncrementalSyncGeneration + 1,
  );
  if (generation > MAX_SYNC_GENERATION) {
    throw new CompletionGenerationExhausted();
  }

  const state: IncrementalSyncLifecycleState = generation
    === target.requestedIncrementalSyncGeneration
    ? target
    : await tx.wallet.update({
      where: { id: target.walletId },
      data: {
        requestedIncrementalSyncGeneration: generation,
        syncStateVersion: { increment: 1 },
      },
      select: lifecycleSelect,
    }) as unknown as IncrementalSyncLifecycleState;
  return { walletId: target.walletId, generation, state };
}

async function clearRecoveredComparisonFailure(
  tx: PrismaTxClient,
  input: SubscriptionEnrollmentCompletionInput,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "address_subscription_comparison_failures"
    WHERE "addressId" = ${input.addressId}
      AND "enrollmentGeneration" = ${input.generation}
  `);
}

async function completeInTransaction(
  tx: PrismaTxClient,
  input: SubscriptionEnrollmentCompletionInput,
): Promise<SubscriptionEnrollmentCompletionResult> {
  const target = await lockTarget(tx, input);
  if (!target) return { status: 'not_applied' };
  const current = await tx.addressSubscriptionCheckpoint.findUnique({
    where: { addressId: input.addressId },
  });
  if (!isEligible(current, input)) return { status: 'not_applied' };

  const state = await writeCheckpoint(tx, input, current === null);
  if (!state) throw new CompletionLostRace();
  await clearRecoveredComparisonFailure(tx, input);
  const syncIntent = requiresIntent(current, input.observedStatus)
    ? await applyIntent(tx, target)
    : null;
  return { status: 'applied', state, syncIntent };
}

/**
 * Complete checkpoint evidence and any resulting durable wallet intent in one
 * short transaction. A lost exact-generation race throws inside the callback,
 * rolling back both writes before it is translated to `not_applied`.
 */
export async function applySubscriptionEnrollmentCompletion(
  input: SubscriptionEnrollmentCompletionInput,
): Promise<SubscriptionEnrollmentCompletionResult> {
  try {
    return await prisma.$transaction(
      (tx) => completeInTransaction(tx, input),
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch (error) {
    if (error instanceof CompletionGenerationExhausted) {
      return { status: 'generation_exhausted' };
    }
    if (error instanceof CompletionLostRace) return { status: 'not_applied' };
    throw error;
  }
}
