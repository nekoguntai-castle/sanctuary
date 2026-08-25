import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { establishSchedulerRetirementCutover } from '../../../src/repositories/schedulerRetirementCutoverRepository';
import { activateWalletSync } from '../../../src/repositories/walletSyncActivationPolicyRepository';
import { readStaleWalletSchedulePolicy } from '../../../src/repositories/walletSyncSchedulePolicyRepository';
import { requestRetainedStaleIncrementalSync } from '../../../src/repositories/syncIntentRepository';
import {
  WALLET_SYNC_RETIREMENT_LOCK_KEY,
  withWalletSyncRetirementLock,
} from '../../../src/repositories/walletSyncRetirementLock';
import {
  completeSubscriptionEnrollment,
  requestSubscriptionEnrollment,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import {
  OPERATIONAL_SYSTEM_SETTING_PREFIX,
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  WALLET_SYNC_ACTIVATION_KEY,
} from '../../../src/repositories/operationalSystemSettings';
import {
  cleanupTestData,
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const NOW = new Date('2026-08-25T00:00:00.000Z');
const HASH = 'a'.repeat(64);
const SCRIPT_HASH = 'b'.repeat(64);
const ENROLLMENT_PAUSE_KEY = 826_250_401;
const ENROLLMENT_PAUSE_TRIGGER = 'test_pause_scheduler_cutover_enrollment';
const ENROLLMENT_PAUSE_FUNCTION = 'test_pause_scheduler_cutover_enrollment_fn';
const MARKER_PAUSE_KEY = 826_250_402;
const MARKER_PAUSE_TRIGGER = 'test_pause_scheduler_cutover_marker';
const MARKER_PAUSE_FUNCTION = 'test_pause_scheduler_cutover_marker_fn';

describeWithDatabase('scheduler retirement cutover', () => {
  const factoryClient = prisma as unknown as PrismaClient;

  async function clearOperationalMarkers(): Promise<void> {
    await prisma.systemSetting.deleteMany({
      where: {
        key: { in: [WALLET_SYNC_ACTIVATION_KEY, STALE_WALLET_SCHEDULE_FORBIDDEN_KEY] },
      },
    });
  }

  async function dropEnrollmentPause(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${ENROLLMENT_PAUSE_TRIGGER} `
        + 'ON "address_subscription_checkpoints"',
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS ${ENROLLMENT_PAUSE_FUNCTION}()`,
    );
  }

  async function dropMarkerPause(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${MARKER_PAUSE_TRIGGER} ON "system_settings"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${MARKER_PAUSE_FUNCTION}()`);
  }

  beforeEach(async () => {
    await clearOperationalMarkers();
    await cleanupTestData();
  });

  afterEach(async () => {
    await dropEnrollmentPause();
    await dropMarkerPause();
    await clearOperationalMarkers();
    await cleanupTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createReadyFixture() {
    const user = await createTestUser(factoryClient);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'signet' });
    const address = await createTestAddress(factoryClient, wallet.id);
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: 'signet',
        lastProcessedHeight: 200,
        lastProcessedHash: HASH,
        observedAt: NOW,
      },
    });
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });
    await activateWalletSync(NOW);
    return { user, wallet, address };
  }

  async function waitForBlockedQuery(fragment: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe<Array<{ blocked: boolean }>>(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query LIKE $1
        ) AS blocked
      `, `%${fragment}%`);
      if (rows[0]?.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for blocked query: ${fragment}`);
  }

  async function runRestoreShapedOperationalReplacement(
    afterSnapshot: () => Promise<void> = async () => undefined,
  ): Promise<void> {
    await withWalletSyncRetirementLock(async (tx) => {
      const preserved = await tx.systemSetting.findMany({
        where: { key: { startsWith: OPERATIONAL_SYSTEM_SETTING_PREFIX } },
      });
      await afterSnapshot();
      await tx.systemSetting.deleteMany({
        where: { key: { startsWith: OPERATIONAL_SYSTEM_SETTING_PREFIX } },
      });
      if (preserved.length > 0) {
        await tx.systemSetting.createMany({ data: preserved });
      }
    });
  }

  it('writes the irreversible marker only for exact readiness and is idempotent', async () => {
    await createReadyFixture();

    await expect(establishSchedulerRetirementCutover()).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: true,
      tombstone: { compatibilityFloor: 2 },
    });
    await expect(establishSchedulerRetirementCutover()).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: false,
    });
    await expect(readStaleWalletSchedulePolicy()).resolves.toMatchObject({
      mode: 'forbidden',
    });
  });

  it('preserves a cutover marker that commits before restore snapshots operational state', async () => {
    await createReadyFixture();
    await expect(establishSchedulerRetirementCutover()).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: true,
    });

    await runRestoreShapedOperationalReplacement();

    await expect(readStaleWalletSchedulePolicy()).resolves.toMatchObject({
      mode: 'forbidden',
    });
  });

  it('makes cutover wait for a restore that snapshots operational state first', async () => {
    await createReadyFixture();
    let releaseRestore!: () => void;
    let restoreSnapshotted!: () => void;
    const snapshotted = new Promise<void>((resolve) => {
      restoreSnapshotted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const restore = runRestoreShapedOperationalReplacement(async () => {
      restoreSnapshotted();
      await release;
    });
    await snapshotted;

    const cutover = establishSchedulerRetirementCutover();
    await waitForBlockedQuery('pg_advisory_xact_lock');
    await expect(prisma.systemSetting.findUnique({
      where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
    })).resolves.toBeNull();

    releaseRestore();
    await restore;
    await expect(cutover).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: true,
    });
    await expect(readStaleWalletSchedulePolicy()).resolves.toMatchObject({
      mode: 'forbidden',
    });
  });

  it('lets a concurrent address transaction commit before the readiness snapshot', async () => {
    const { wallet } = await createReadyFixture();
    let releaseInsert!: () => void;
    let inserted!: () => void;
    const insertReached = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const holdInsert = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const insertPromise = prisma.$transaction(async (tx) => {
      await createTestAddress(tx as unknown as PrismaClient, wallet.id, { index: 99 });
      inserted();
      await holdInsert;
    });
    await insertReached;

    const cutoverPromise = establishSchedulerRetirementCutover();
    await expect(prisma.systemSetting.findUnique({
      where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
    })).resolves.toBeNull();
    releaseInsert();
    await insertPromise;

    await expect(cutoverPromise).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: {
        status: 'blocked',
        networks: [expect.objectContaining({ persisted: 2, unknown: 1 })],
      },
    });
    await expect(readStaleWalletSchedulePolicy()).resolves.toEqual({
      mode: 'legacy_enabled',
    });
  });

  it('uses a post-barrier database clock when a later writer wins', async () => {
    const { wallet } = await createReadyFixture();
    let releaseLock!: () => void;
    let lockHeld!: () => void;
    const held = new Promise<void>(resolve => {
      lockHeld = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    const locker = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        WALLET_SYNC_RETIREMENT_LOCK_KEY,
      );
      lockHeld();
      await release;
    });
    await held;

    const cutover = establishSchedulerRetirementCutover();
    await waitForBlockedQuery('pg_advisory_xact_lock');
    await createTestAddress(factoryClient, wallet.id, { index: 101 });
    releaseLock();
    await locker;

    await expect(cutover).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: {
        status: 'blocked',
        networks: [expect.objectContaining({ persisted: 2, unknown: 1 })],
      },
    });
  });

  it('lets a concurrent enrollment request commit before the readiness snapshot', async () => {
    const { address } = await createReadyFixture();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${ENROLLMENT_PAUSE_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${ENROLLMENT_PAUSE_KEY});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${ENROLLMENT_PAUSE_TRIGGER}
      BEFORE UPDATE ON "address_subscription_checkpoints"
      FOR EACH ROW
      WHEN (
        NEW."requestedEnrollmentGeneration" > OLD."requestedEnrollmentGeneration"
      )
      EXECUTE FUNCTION ${ENROLLMENT_PAUSE_FUNCTION}()
    `);

    let releasePause!: () => void;
    let pauseHeld!: () => void;
    const held = new Promise<void>(resolve => {
      pauseHeld = resolve;
    });
    const release = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    const locker = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${ENROLLMENT_PAUSE_KEY})`,
      );
      pauseHeld();
      await release;
    });
    await held;

    const enrollment = requestSubscriptionEnrollment(address.id, 'signet');
    await waitForBlockedQuery('address_subscription_checkpoints');
    const cutover = establishSchedulerRetirementCutover();
    releasePause();
    await locker;
    await expect(enrollment).resolves.toMatchObject({ status: 'requested' });

    await expect(cutover).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: {
        status: 'blocked',
        networks: [expect.objectContaining({ pending: 1 })],
      },
    });
    await expect(readStaleWalletSchedulePolicy()).resolves.toEqual({
      mode: 'legacy_enabled',
    });
  });

  it('commits cutover before an address that begins after the barrier', async () => {
    const { wallet } = await createReadyFixture();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${MARKER_PAUSE_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${MARKER_PAUSE_KEY});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${MARKER_PAUSE_TRIGGER}
      BEFORE INSERT ON "system_settings"
      FOR EACH ROW
      WHEN (NEW."key" = '${STALE_WALLET_SCHEDULE_FORBIDDEN_KEY}')
      EXECUTE FUNCTION ${MARKER_PAUSE_FUNCTION}()
    `);

    let releasePause!: () => void;
    let pauseHeld!: () => void;
    const held = new Promise<void>(resolve => {
      pauseHeld = resolve;
    });
    const release = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    const locker = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${MARKER_PAUSE_KEY})`);
      pauseHeld();
      await release;
    });
    await held;

    const cutover = establishSchedulerRetirementCutover();
    await waitForBlockedQuery('system_settings');
    let addressCommitted = false;
    const addressPromise = createTestAddress(factoryClient, wallet.id, { index: 100 })
      .then(address => {
        addressCommitted = true;
        return address;
      });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(addressCommitted).toBe(false);

    releasePause();
    await locker;
    await expect(cutover).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: true,
    });
    const address = await addressPromise;
    await expect(prisma.addressSubscriptionCheckpoint.findUnique({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
    });
    await expect(readStaleWalletSchedulePolicy()).resolves.toMatchObject({
      mode: 'forbidden',
    });
  });

  it('neutralizes retained stale admission that was waiting when cutover committed', async () => {
    const { wallet } = await createReadyFixture();
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { requestedIncrementalSyncGeneration: true },
    });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${MARKER_PAUSE_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${MARKER_PAUSE_KEY});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${MARKER_PAUSE_TRIGGER}
      BEFORE INSERT ON "system_settings"
      FOR EACH ROW
      WHEN (NEW."key" = '${STALE_WALLET_SCHEDULE_FORBIDDEN_KEY}')
      EXECUTE FUNCTION ${MARKER_PAUSE_FUNCTION}()
    `);

    let releasePause!: () => void;
    let pauseHeld!: () => void;
    const held = new Promise<void>(resolve => {
      pauseHeld = resolve;
    });
    const release = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    const locker = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${MARKER_PAUSE_KEY})`);
      pauseHeld();
      await release;
    });
    await held;

    const cutover = establishSchedulerRetirementCutover();
    await waitForBlockedQuery('system_settings');
    let admissionSettled = false;
    const admission = requestRetainedStaleIncrementalSync(wallet.id).finally(() => {
      admissionSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(admissionSettled).toBe(false);

    releasePause();
    await locker;
    await expect(cutover).resolves.toMatchObject({ status: 'forbidden' });
    await expect(admission).resolves.toEqual({ status: 'retired' });
    await expect(prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { requestedIncrementalSyncGeneration: true },
    })).resolves.toEqual(before);
  });
});
