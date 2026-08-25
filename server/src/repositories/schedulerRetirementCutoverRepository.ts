import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import {
  projectSchedulerRetirementReadiness,
  type SchedulerRetirementReadiness,
} from './schedulerRetirementReadinessProjection';
import { readSubscriptionCoverageWithClient } from './subscriptionCoverageReadRepository';
import { readWalletSyncActivationPolicyWithClient } from './walletSyncActivationPolicyRepository';
import { acquireWalletSyncRetirementLock } from './walletSyncRetirementLock';
import {
  forbidStaleWalletScheduleWithClient,
  readStaleWalletSchedulePolicyWithClient,
  type StaleWalletScheduleTombstone,
} from './walletSyncSchedulePolicyRepository';

export type SchedulerRetirementCutoverResult =
  | {
      status: 'forbidden';
      newlyForbidden: boolean;
      tombstone: StaleWalletScheduleTombstone;
    }
  | {
      status: 'legacy_enabled';
      reason: 'activation_not_durable' | 'readiness_blocked';
      readiness?: SchedulerRetirementReadiness;
    };

class RetirementReadinessChangedError extends Error {
  constructor(readonly readiness: SchedulerRetirementReadiness) {
    super('Scheduler retirement readiness changed during cutover');
    this.name = 'RetirementReadinessChangedError';
  }
}

async function lockReadinessTables(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  // One statement fixes lock acquisition order for every cutover. SHARE waits
  // for older writers and blocks every readiness-table DML writer until commit.
  await tx.$executeRaw(Prisma.sql`
    LOCK TABLE
      "wallets",
      "addresses",
      "address_subscription_checkpoints",
      "address_subscription_comparison_failures",
      "network_header_checkpoints",
      "network_subscription_coverage_state",
      "network_header_reconciliations",
      "network_header_confirmation_retries"
    IN SHARE MODE
  `);
}

async function readReadiness(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<SchedulerRetirementReadiness> {
  return projectSchedulerRetirementReadiness(
    await readSubscriptionCoverageWithClient(tx),
  );
}

async function establishInTransaction(): Promise<SchedulerRetirementCutoverResult> {
  return prisma.$transaction(async (tx) => {
    await acquireWalletSyncRetirementLock(tx);
    await lockReadinessTables(tx);

    const existing = await readStaleWalletSchedulePolicyWithClient(tx);
    if (existing.mode === 'forbidden') {
      return {
        status: 'forbidden',
        newlyForbidden: false,
        tombstone: existing.tombstone,
      };
    }
    if ((await readWalletSyncActivationPolicyWithClient(tx)).mode !== 'active') {
      return { status: 'legacy_enabled', reason: 'activation_not_durable' };
    }

    const before = await readReadiness(tx);
    if (before.status !== 'ready') {
      return {
        status: 'legacy_enabled',
        reason: 'readiness_blocked',
        readiness: before,
      };
    }

    const timestamps = await tx.$queryRaw<Array<{ forbiddenAt: Date }>>(Prisma.sql`
      SELECT statement_timestamp() AS "forbiddenAt"
    `);
    const forbiddenAt = timestamps[0]?.forbiddenAt;
    if (!(forbiddenAt instanceof Date) || Number.isNaN(forbiddenAt.getTime())) {
      throw new Error('Scheduler retirement database timestamp is unavailable');
    }
    const tombstone = await forbidStaleWalletScheduleWithClient(tx, forbiddenAt);
    const after = await readReadiness(tx);
    if (after.status !== 'ready') throw new RetirementReadinessChangedError(after);
    return { status: 'forbidden', newlyForbidden: true, tombstone };
  }, {
    // The SHARE barrier, not a transaction-start snapshot, stabilizes the
    // predicate. READ COMMITTED ensures the first readiness query sees writers
    // that committed while LOCK TABLE was waiting.
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 60_000,
  });
}

/** Atomically prove exact readiness and establish the irreversible tombstone. */
export async function establishSchedulerRetirementCutover(): Promise<
  SchedulerRetirementCutoverResult
> {
  try {
    return await establishInTransaction();
  } catch (error) {
    if (error instanceof RetirementReadinessChangedError) {
      return {
        status: 'legacy_enabled',
        reason: 'readiness_blocked',
        readiness: error.readiness,
      };
    }
    throw error;
  }
}

export const schedulerRetirementCutoverRepository = {
  establish: establishSchedulerRetirementCutover,
};
