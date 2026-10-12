import { vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import type { PrismaTxClient } from '../../../src/models/prisma';
import { ConflictError } from '../../../src/errors/ApiError';
import { importFromDescriptor } from '../../../src/services/walletImport/descriptorImport';
import { walletRepository } from '../../../src/repositories/walletRepository';
import {
  lockWalletImportForUser,
  withWalletImportTransaction,
} from '../../../src/repositories/walletImportLock';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestUser, getTestUser } from '../setup/helpers';

vi.mock('../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/services/hardwareWalletCapabilities')>(),
  assertHardwareWalletCapability: vi.fn(),
  assertWalletHardwareCapability: vi.fn(),
  assertWalletHardwareCapabilityById: vi.fn(),
}));

const XPUB = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
const FINGERPRINT = 'aabbccdd';
const DERIVATION_PATH = "m/84'/1'/0'";
const RECEIVE_DESCRIPTOR = `wpkh([${FINGERPRINT}/84'/1'/0']${XPUB}/0/*)`;
const CHANGE_DESCRIPTOR = `wpkh([${FINGERPRINT}/84'/1'/0']${XPUB}/1/*)`;
const INSERT_GATE_KEY = 'sanctuary:test:wallet-import-insert-gate:v1';
const INSERT_GATE_TRIGGER = 'test_wallet_import_insert_gate';
const INSERT_GATE_FUNCTION = 'test_wallet_import_insert_gate_fn';
const describeWithDatabase = canRunIntegrationTests() ? describe : describe.skip;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function waitForAdvisoryWait(prisma: PrismaClient, pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{
      waitEventType: string | null;
      waitEvent: string | null;
    }>>`
      SELECT wait_event_type AS "waitEventType", wait_event AS "waitEvent"
      FROM pg_stat_activity
      WHERE pid = ${pid}
    `;
    if (rows[0]?.waitEventType === 'Lock' && rows[0]?.waitEvent === 'advisory') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Backend ${pid} did not wait on an advisory lock within 5 seconds`);
}

async function waitForAdvisoryLockKey(prisma: PrismaClient, lockKey: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
      SELECT activity.pid AS pid
      FROM pg_locks AS waiting_lock
      JOIN pg_stat_activity AS activity ON activity.pid = waiting_lock.pid
      WHERE waiting_lock.locktype = 'advisory'
        AND waiting_lock.granted = false
        AND waiting_lock.objsubid = 1
        AND waiting_lock.classid = (
          (hashtextextended(${lockKey}, 0) >> 32) & 4294967295
        )::oid
        AND waiting_lock.objid = (
          hashtextextended(${lockKey}, 0) & 4294967295
        )::oid
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
      LIMIT 1
    `;
    if (rows[0]) return Number(rows[0].pid);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`No backend waited on advisory lock ${lockKey} within 5 seconds`);
}

async function installInsertGate(prisma: PrismaClient): Promise<void> {
  await dropInsertGate(prisma);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${INSERT_GATE_FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."name" LIKE 'concurrent-import-%' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('${INSERT_GATE_KEY}', 0));
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${INSERT_GATE_TRIGGER}
    BEFORE INSERT ON "wallets"
    FOR EACH ROW EXECUTE FUNCTION ${INSERT_GATE_FUNCTION}()
  `);
}

async function dropInsertGate(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${INSERT_GATE_TRIGGER} ON "wallets"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${INSERT_GATE_FUNCTION}()`);
}

function waitAtInsertGate(
  prisma: PrismaClient,
  acquired: Deferred<void>,
  release: Deferred<void>,
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${INSERT_GATE_KEY}, 0))`;
    acquired.resolve();
    await release.promise;
  });
}

async function holdWalletImportLock(
  userId: string,
  entered: Deferred<number>,
  release: Deferred<void>,
): Promise<string> {
  return withWalletImportTransaction(userId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ pid: number; isolation: string }>>`
      SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation
    `;
    entered.resolve(Number(rows[0].pid));
    await release.promise;
    return rows[0].isolation;
  });
}

async function createExistingSigner(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const device = await prisma.device.create({
    data: {
      userId,
      type: 'bitbox',
      label: 'Existing import concurrency signer',
      fingerprint: FINGERPRINT,
      xpub: XPUB,
      derivationPath: DERIVATION_PATH,
    },
  });
  await prisma.deviceAccount.create({
    data: {
      deviceId: device.id,
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: DERIVATION_PATH,
      xpub: XPUB,
    },
  });
  await prisma.deviceUser.create({
    data: { deviceId: device.id, userId, role: 'owner' },
  });
}

describeWithDatabase('wallet import concurrency', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('holds a same-user contender on the actual advisory lock until commit', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const ownerEntered = deferred<number>();
    const ownerRelease = deferred<void>();
    const contenderPid = deferred<number>();
    const contenderEntered = deferred<void>();
    const owner = holdWalletImportLock(user.id, ownerEntered, ownerRelease);
    let contender: Promise<void> | undefined;
    let observationError: unknown;

    try {
      await withDeadline(ownerEntered.promise, 'owner lock acquisition');
      contender = prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        contenderPid.resolve(Number(rows[0].pid));
        await lockWalletImportForUser(tx as PrismaTxClient, user.id);
        contenderEntered.resolve();
      });
      const pid = await withDeadline(contenderPid.promise, 'contender backend PID');
      await withDeadline(waitForAdvisoryWait(prisma, pid), 'contender advisory-lock wait');
    } catch (error) {
      observationError = error;
    } finally {
      ownerRelease.resolve();
    }

    const outcomes = await Promise.allSettled([owner, ...(contender ? [contender] : [])]);
    if (observationError) throw observationError;
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 'read committed' });
    expect(contender).toBeDefined();
    expect(outcomes[1]?.status).toBe('fulfilled');
    await withDeadline(contenderEntered.promise, 'contender lock acquisition');
  });

  it('releases the per-user lock after rollback and does not block another user', async () => {
    const firstUser = await createTestUser(prisma, getTestUser());
    const otherUser = await createTestUser(prisma, getTestUser());
    const holderEntered = deferred<number>();
    const holderRelease = deferred<void>();
    const holder = holdWalletImportLock(firstUser.id, holderEntered, holderRelease);
    let holderError: unknown;

    try {
      await withDeadline(holderEntered.promise, 'held user lock');
      const otherUserEntered = await withDeadline(
        withWalletImportTransaction(otherUser.id, async () => true),
        'independent user transaction',
      );
      expect(otherUserEntered).toBe(true);
    } catch (error) {
      holderError = error;
    } finally {
      holderRelease.resolve();
    }
    await expect(holder).resolves.toBe('read committed');
    if (holderError) throw holderError;

    await expect(withWalletImportTransaction(firstUser.id, async () => {
      throw new Error('force wallet import rollback');
    })).rejects.toThrow('force wallet import rollback');
    await expect(
      withWalletImportTransaction(firstUser.id, async () => 'lock-reacquired'),
    ).resolves.toBe('lock-reacquired');
  });

  it('creates one wallet and one conflict for simultaneous identical imports', async () => {
    const user = await createTestUser(prisma, getTestUser());
    await createExistingSigner(prisma, user.id);
    await installInsertGate(prisma);
    const gateAcquired = deferred<void>();
    const gateRelease = deferred<void>();
    const gateOwner = waitAtInsertGate(prisma, gateAcquired, gateRelease);
    const secondPreflight = deferred<void>();
    let preflightCount = 0;
    let firstImport: Promise<unknown> | undefined;
    let secondImport: Promise<unknown> | undefined;
    let observationError: unknown;
    const originalAccessibleQuery = walletRepository.findAccessibleWithSelect;
    const accessibleQuerySpy = vi.spyOn(walletRepository, 'findAccessibleWithSelect')
      .mockImplementation(async (userId, select, additionalWhere, client) => {
        const rows = await originalAccessibleQuery(userId, select, additionalWhere, client);
        if (userId === user.id && client === undefined) {
          preflightCount += 1;
          if (preflightCount === 2) secondPreflight.resolve();
        }
        return rows;
      });
    const input = {
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      network: 'testnet3' as const,
    };

    try {
      await withDeadline(gateAcquired.promise, 'insert-gate lock acquisition');
      firstImport = importFromDescriptor(user.id, { ...input, name: 'concurrent-import-a' });
      await withDeadline(
        waitForAdvisoryLockKey(prisma, INSERT_GATE_KEY),
        'first import to block before commit',
      );
      secondImport = importFromDescriptor(user.id, { ...input, name: 'concurrent-import-b' });
      await withDeadline(secondPreflight.promise, 'both import preflight reads');
      await withDeadline(
        waitForAdvisoryLockKey(prisma, `sanctuary:wallet-import:v1:${user.id}`),
        'second import to wait on the per-user lock',
      );
    } catch (error) {
      observationError = error;
    } finally {
      gateRelease.resolve();
      accessibleQuerySpy.mockRestore();
      try {
        await withDeadline(
          Promise.allSettled([gateOwner, firstImport, secondImport].filter(
            (promise): promise is Promise<unknown> => promise !== undefined,
          )),
          'blocked import transactions to finish',
        );
      } finally {
        await dropInsertGate(prisma);
      }
    }
    if (observationError) throw observationError;

    const results = await Promise.allSettled([firstImport!, secondImport!]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: expect.any(ConflictError) });
    const wallets = await prisma.wallet.findMany({
      where: { users: { some: { userId: user.id } } },
      select: { id: true },
    });
    expect(wallets).toHaveLength(1);
    await expect(prisma.walletDevice.count({ where: { walletId: wallets[0].id } })).resolves.toBe(1);
    await expect(prisma.deviceAccount.count({ where: { device: { userId: user.id } } })).resolves.toBe(1);
    await expect(prisma.address.count({ where: { walletId: wallets[0].id } })).resolves.toBeGreaterThan(0);
  });
});
