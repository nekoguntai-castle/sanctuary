import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  findActionableIncrementalSyncIntents,
  findExpiredIncrementalSyncClaims,
  findIncrementalSyncIntent,
} from '../../../src/repositories/syncIntentRepository';
import {
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpoint,
  findSubscriptionCheckpointOwners,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

interface ExplainPlanNode {
  'Actual Loops'?: number;
  'Actual Rows'?: number;
  'Relation Name'?: string;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  'Rows Removed by Join Filter'?: number;
  Plans?: ExplainPlanNode[];
}

interface ExplainResultRow {
  'QUERY PLAN': Array<{ Plan: ExplainPlanNode }>;
}

function collectPlanNodes(
  node: ExplainPlanNode,
  predicate: (candidate: ExplainPlanNode) => boolean,
): ExplainPlanNode[] {
  return [
    ...(predicate(node) ? [node] : []),
    ...(node.Plans ?? []).flatMap(child => collectPlanNodes(child, predicate)),
  ];
}

function touchedRowsForRelation(plan: ExplainPlanNode, relation: string): number {
  return collectPlanNodes(plan, node => node['Relation Name'] === relation)
    .reduce(
      (total, node) => total + (
        (node['Actual Rows'] ?? 0)
        + (node['Rows Removed by Filter'] ?? 0)
        + (node['Rows Removed by Index Recheck'] ?? 0)
        + (node['Rows Removed by Join Filter'] ?? 0)
      ) * (node['Actual Loops'] ?? 1),
      0,
    );
}

describeWithDatabase('sync intent readers', () => {
  const userIds: string[] = [];
  const walletIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  afterEach(async () => {
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture() {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'signet' });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id);
    return { wallet, address };
  }

  it('reads actionable generations without admitting action-required intent', async () => {
    const { wallet } = await createFixture();
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { requestedIncrementalSyncGeneration: 1 },
    });

    await expect(findIncrementalSyncIntent(wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { syncActionRequiredAt: new Date() },
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        syncActionRequiredAt: null,
        requestedFullResyncGeneration: 1,
      },
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));
  });

  it('does not reclaim an expired incremental claim during wake-up repair', async () => {
    const { wallet } = await createFixture();
    const claimedAt = new Date('2026-08-22T10:00:00.000Z');
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
        incrementalSyncClaimedAt: claimedAt,
        incrementalSyncLeaseExpiresAt: new Date('2026-08-22T10:05:00.000Z'),
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: claimedAt,
      },
    });

    await expect(findActionableIncrementalSyncIntents({
      now: new Date('2026-08-22T11:00:00.000Z'),
    })).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: wallet.id }),
    ]));
  });

  it('pages only actionable expired claims by lease expiry and wallet ID', async () => {
    const now = new Date('2026-08-22T11:00:00.000Z');
    const earlierExpiry = new Date('2026-08-22T10:00:00.000Z');
    const sharedExpiry = new Date('2026-08-22T10:30:00.000Z');
    const claimedAt = new Date('2026-08-22T09:00:00.000Z');
    const fixtures: Awaited<ReturnType<typeof createFixture>>[] = [];
    for (let index = 0; index < 7; index += 1) {
      fixtures.push(await createFixture());
    }
    const [earlier, sharedA, sharedB, future, fullResync, actionRequired, unclaimed] =
      fixtures.map(({ wallet }) => wallet);

    async function setClaim(
      walletId: string,
      leaseToken: string,
      leaseExpiresAt: Date,
      extra: { requestedFullResyncGeneration?: number; syncActionRequiredAt?: Date } = {},
    ): Promise<void> {
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          requestedIncrementalSyncGeneration: 2,
          claimedIncrementalSyncGeneration: 1,
          processedIncrementalSyncGeneration: 0,
          incrementalSyncLeaseToken: leaseToken,
          incrementalSyncClaimedAt: claimedAt,
          incrementalSyncLeaseExpiresAt: leaseExpiresAt,
          syncInProgress: true,
          syncExecutionOwner: 'worker',
          syncStartedAt: claimedAt,
          ...extra,
        },
      });
    }

    await setClaim(
      earlier.id,
      '10000000-0000-4000-8000-000000000001',
      earlierExpiry,
    );
    await setClaim(
      sharedA.id,
      '20000000-0000-4000-8000-000000000002',
      sharedExpiry,
    );
    await setClaim(
      sharedB.id,
      '30000000-0000-4000-8000-000000000003',
      sharedExpiry,
    );
    await setClaim(
      future.id,
      '40000000-0000-4000-8000-000000000004',
      new Date('2026-08-22T12:00:00.000Z'),
    );
    await setClaim(
      fullResync.id,
      '50000000-0000-4000-8000-000000000005',
      earlierExpiry,
      { requestedFullResyncGeneration: 1 },
    );
    await setClaim(
      actionRequired.id,
      '60000000-0000-4000-8000-000000000006',
      earlierExpiry,
      { syncActionRequiredAt: now },
    );
    await prisma.wallet.update({
      where: { id: unclaimed.id },
      data: { requestedIncrementalSyncGeneration: 1 },
    });

    const firstPage = await findExpiredIncrementalSyncClaims({ now, limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(firstPage[0]).toMatchObject({
      walletId: earlier.id,
      generation: 1,
      leaseToken: '10000000-0000-4000-8000-000000000001',
      leaseExpiresAt: earlierExpiry,
    });
    const secondPage = await findExpiredIncrementalSyncClaims({
      now,
      cursor: {
        leaseExpiresAt: firstPage[1].leaseExpiresAt,
        walletId: firstPage[1].walletId,
      },
      limit: 2,
    });
    const allRows = [...firstPage, ...secondPage];
    expect(allRows.map(row => row.walletId).sort()).toEqual(
      [earlier.id, sharedA.id, sharedB.id].sort(),
    );
    expect(allRows.slice(1).map(row => row.leaseExpiresAt)).toEqual([
      sharedExpiry,
      sharedExpiry,
    ]);
    expect(allRows.slice(1).map(row => row.walletId)).toEqual(
      [sharedA.id, sharedB.id].sort(),
    );
    expect(allRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ walletId: future.id }),
      expect.objectContaining({ walletId: fullResync.id }),
      expect.objectContaining({ walletId: actionRequired.id }),
      expect.objectContaining({ walletId: unclaimed.id }),
    ]));
  });

  it('makes an address-only rolling-version insert a pending unknown checkpoint', async () => {
    const { address } = await createFixture();

    await expect(findPendingSubscriptionEnrollments({ network: 'signet' }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          addressId: address.id,
          checkpointMissing: false,
          statusKnown: false,
          requestedEnrollmentGeneration: 1,
          processedEnrollmentGeneration: 0,
        }),
      ]));
    await expect(findSubscriptionCheckpoint(address.id)).resolves.toMatchObject({
      network: 'signet',
      statusKnown: false,
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
    });

    await prisma.addressSubscriptionCheckpoint.update({
      where: { addressId: address.id },
      data: {
        scriptHash: 'a'.repeat(64),
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: new Date(),
        processedEnrollmentGeneration: 1,
        coverageGapStartedAt: null,
      },
    });

    await expect(findSubscriptionCheckpoint(address.id)).resolves.toMatchObject({
      statusKnown: true,
      observedStatus: null,
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 1,
    });
    await expect(findPendingSubscriptionEnrollments({ network: 'signet' }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ addressId: address.id })]));
  });

  it('pages pending enrollment without traversing a representative quiet address population', async () => {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'signet' });
    walletIds.push(wallet.id);
    const quietIds = Array.from(
      { length: 10_000 },
      (_, index) => `a-quiet-${index.toString().padStart(5, '0')}`,
    );
    const pendingIds = Array.from(
      { length: 201 },
      (_, index) => `z-pending-${index.toString().padStart(3, '0')}`,
    );
    const rollingWriterId = 'zz-rolling-writer-000';
    const allIds = [...quietIds, ...pendingIds, rollingWriterId];
    await prisma.address.createMany({
      data: allIds.map((id, index) => ({
        id,
        walletId: wallet.id,
        address: `integration-${id}`,
        derivationPath: `m/84'/1'/0'/0/${index}`,
        index,
      })),
    });
    const observedAt = new Date('2026-08-25T10:00:00.000Z');
    await prisma.$executeRaw`
      UPDATE "address_subscription_checkpoints"
      SET "scriptHash" = ${'a'.repeat(64)},
          "statusKnown" = TRUE,
          "lastObservedAt" = ${observedAt},
          "requestedEnrollmentGeneration" = 1,
          "processedEnrollmentGeneration" = 1,
          "coverageGapStartedAt" = NULL
      WHERE "addressId" LIKE 'a-quiet-%'
    `;
    await prisma.$executeRaw`
      UPDATE "address_subscription_checkpoints"
      SET "scriptHash" = ${'b'.repeat(64)},
          "statusKnown" = TRUE,
          "lastObservedAt" = ${observedAt},
          "requestedEnrollmentGeneration" = 2,
          "processedEnrollmentGeneration" = 1,
          "coverageGapStartedAt" = ${observedAt}
      WHERE "addressId" LIKE 'z-pending-%'
    `;
    await expect(
      prisma.addressSubscriptionCheckpoint.findUnique({
        where: { addressId: rollingWriterId },
      }),
    ).resolves.toMatchObject({
      network: 'signet',
      statusKnown: false,
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
    });
    await prisma.$executeRawUnsafe(
      'ANALYZE "addresses", "wallets", "address_subscription_checkpoints"',
    );

    const firstPage = await findPendingSubscriptionEnrollments({
      network: 'signet',
      limit: 200,
    });
    const secondPage = await findPendingSubscriptionEnrollments({
      network: 'signet',
      cursor: firstPage.at(-1)?.addressId,
      limit: 200,
    });
    expect(firstPage.map(row => row.addressId)).toEqual(pendingIds.slice(0, 200));
    expect(secondPage.map(row => row.addressId)).toEqual([pendingIds[200], rollingWriterId]);
    expect(secondPage.at(-1)).toMatchObject({
      addressId: rollingWriterId,
      checkpointMissing: false,
    });
    expect(new Set([...firstPage, ...secondPage].map(row => row.addressId)).size)
      .toBe(pendingIds.length + 1);

    const explained = await prisma.$queryRaw<ExplainResultRow[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
        "addresses"."id" AS "addressId"
      FROM "address_subscription_checkpoints" AS "checkpoints"
      INNER JOIN LATERAL (
        SELECT "addresses"."id"
        FROM "addresses"
        INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId"
        WHERE "addresses"."id" = "checkpoints"."addressId"
          AND "wallets"."network" = ${'signet'}
        LIMIT 1
      ) AS "addresses" ON TRUE
      WHERE "checkpoints"."addressId" > ${''}
        AND "checkpoints"."network" = ${'signet'}
        AND "checkpoints"."requestedEnrollmentGeneration"
          > "checkpoints"."processedEnrollmentGeneration"
      ORDER BY "checkpoints"."addressId" ASC
      LIMIT ${200}
    `;
    const plan = explained[0]?.['QUERY PLAN'][0]?.Plan;
    expect(plan?.['Actual Rows']).toBe(200);
    expect(plan ? touchedRowsForRelation(plan, 'addresses') : Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(400);

    const ownerExplain = await prisma.$queryRaw<ExplainResultRow[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT "checkpoints"."addressId"
      FROM "address_subscription_checkpoints" AS "checkpoints"
      INNER JOIN "addresses" ON "addresses"."id" = "checkpoints"."addressId"
      INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId"
      WHERE "checkpoints"."network" = ${'signet'}
        AND "wallets"."network" = ${'signet'}
        AND "checkpoints"."scriptHash" = ${'a'.repeat(64)}
        AND "checkpoints"."statusKnown" = TRUE
        AND "checkpoints"."addressId" > ${''}
      ORDER BY "checkpoints"."addressId" ASC
      LIMIT ${200}
    `;
    const ownerPlan = ownerExplain[0]?.['QUERY PLAN'][0]?.Plan;
    expect(ownerPlan?.['Actual Rows']).toBe(200);
    expect(ownerPlan ? touchedRowsForRelation(ownerPlan, 'addresses') : Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(400);
    await expect(findSubscriptionCheckpointOwners('signet', 'a'.repeat(64), { limit: 200 }))
      .resolves.toHaveLength(200);
  }, 60_000);
});
