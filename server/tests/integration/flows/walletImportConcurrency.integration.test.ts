import { vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import type { PrismaTxClient } from '../../../src/models/prisma';
import { ConflictError } from '../../../src/errors/ApiError';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../src/services/bitcoin/bip32';
import { importFromDescriptor } from '../../../src/services/walletImport/descriptorImport';
import { deviceRepository } from '../../../src/repositories/deviceRepository';
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

function accountDescriptor(accountIndex: number): {
  descriptor: string;
  changeDescriptor: string;
} {
  const root = bip32.fromSeed(Buffer.alloc(32, 42), bitcoin.networks.testnet);
  const fingerprint = Buffer.from(root.fingerprint).toString('hex');
  const path = `m/84'/1'/${accountIndex}'`;
  const xpub = root.derivePath(path).neutered().toBase58();
  const origin = `[${fingerprint}/${path.slice(2)}]${xpub}`;
  return {
    descriptor: `wpkh(${origin}/0/*)`,
    changeDescriptor: `wpkh(${origin}/1/*)`,
  };
}

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

  it('refreshes distinct account resolutions after the first concurrent import commits', async () => {
    const user = await createTestUser(prisma, getTestUser());
    await installInsertGate(prisma);
    const gateAcquired = deferred<void>();
    const gateRelease = deferred<void>();
    const gateOwner = waitAtInsertGate(prisma, gateAcquired, gateRelease);
    const preflightsReady = deferred<void>();
    const preflightRelease = deferred<void>();
    let preflightCount = 0;
    const preflightSnapshots: unknown[][] = [];
    let firstImport: Promise<unknown> | undefined;
    let secondImport: Promise<unknown> | undefined;
    let observationError: unknown;
    const originalResolve = deviceRepository.findByUserIdWithModel;
    const resolveSpy = vi.spyOn(deviceRepository, 'findByUserIdWithModel')
      .mockImplementation(async (userId, client) => {
        if (userId === user.id && client === undefined) {
          const devices = await originalResolve(userId, client);
          preflightSnapshots.push(devices);
          preflightCount += 1;
          if (preflightCount === 2) preflightsReady.resolve();
          await preflightRelease.promise;
          return devices;
        }
        return originalResolve(userId, client);
      });
    const first = accountDescriptor(0);
    const second = accountDescriptor(1);

    try {
      await withDeadline(gateAcquired.promise, 'insert-gate lock acquisition');
      firstImport = importFromDescriptor(user.id, {
        ...first,
        name: 'concurrent-import-account-0',
      });
      secondImport = importFromDescriptor(user.id, {
        ...second,
        name: 'concurrent-import-account-1',
      });
      await withDeadline(preflightsReady.promise, 'both stale device preflights');
      expect(preflightSnapshots).toHaveLength(2);
      expect(preflightSnapshots).toEqual([[], []]);
      preflightRelease.resolve();
      await withDeadline(
        waitForAdvisoryLockKey(prisma, INSERT_GATE_KEY),
        'an import to reach the pre-commit insert gate',
      );
      await withDeadline(
        waitForAdvisoryLockKey(prisma, `sanctuary:wallet-import:v1:${user.id}`),
        'the other import to wait on the per-user lock',
      );
    } catch (error) {
      observationError = error;
    } finally {
      preflightRelease.resolve();
      gateRelease.resolve();
      try {
        await withDeadline(
          Promise.allSettled([gateOwner, firstImport, secondImport].filter(
            (promise): promise is Promise<unknown> => promise !== undefined,
          )),
          'concurrent account imports to finish',
        );
      } finally {
        resolveSpy.mockRestore();
        await dropInsertGate(prisma);
      }
    }
    if (observationError) throw observationError;

    const results = await Promise.allSettled([firstImport!, secondImport!]);
    const outcomeSummary = results.map(result => result.status === 'rejected'
      ? { status: result.status, reason: String(result.reason) }
      : { status: result.status });
    expect(
      outcomeSummary.every(result => result.status === 'fulfilled'),
      JSON.stringify(outcomeSummary),
    ).toBe(true);
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(1);
    const accountPaths = await prisma.deviceAccount.findMany({
      where: { device: { userId: user.id } },
      select: { derivationPath: true },
      orderBy: { derivationPath: 'asc' },
    });
    expect(accountPaths.map(account => account.derivationPath)).toEqual([
      "m/84'/1'/0'",
      "m/84'/1'/1'",
    ]);
    expect(await prisma.wallet.count({ where: { users: { some: { userId: user.id } } } })).toBe(2);
  });

  it('reuses a group-shared signer instead of creating a duplicate device', async () => {
    const owner = await createTestUser(prisma, getTestUser());
    const member = await createTestUser(prisma, getTestUser());
    const group = await prisma.group.create({ data: { name: 'import-shared-signers' } });
    await prisma.groupMember.create({ data: { userId: member.id, groupId: group.id } });
    await createExistingSigner(prisma, owner.id);
    const shared = await prisma.device.findFirstOrThrow({ where: { fingerprint: FINGERPRINT } });
    await prisma.device.update({
      where: { id: shared.id },
      data: { groupId: group.id, groupRole: 'viewer' },
    });

    const result = await importFromDescriptor(member.id, {
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      network: 'testnet3' as const,
      name: 'group-shared-signer-import',
    });

    expect(result.wallet.id).toBeDefined();
    await expect(prisma.device.count({ where: { fingerprint: FINGERPRINT } })).resolves.toBe(1);
    const bindings = await prisma.walletDevice.findMany({ where: { walletId: result.wallet.id } });
    expect(bindings.map(binding => binding.deviceId)).toEqual([shared.id]);
  });

  it('does not let a user outside the group bind a group-shared signer', async () => {
    const owner = await createTestUser(prisma, getTestUser());
    const outsider = await createTestUser(prisma, getTestUser());
    const group = await prisma.group.create({ data: { name: 'import-private-signers' } });
    await prisma.groupMember.create({ data: { userId: owner.id, groupId: group.id } });
    await createExistingSigner(prisma, owner.id);
    await prisma.device.updateMany({
      where: { fingerprint: FINGERPRINT },
      data: { groupId: group.id, groupRole: 'viewer' },
    });

    await expect(importFromDescriptor(outsider.id, {
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      network: 'testnet3' as const,
      name: 'outsider-signer-import',
      // The signer is invisible to a non-member, so creating it again hits the
      // unique fingerprint (P2002, served as 409) instead of binding it.
    })).rejects.toMatchObject({ code: 'P2002' });

    await expect(prisma.device.count({ where: { fingerprint: FINGERPRINT } })).resolves.toBe(1);
    await expect(prisma.deviceUser.count({ where: { userId: outsider.id } })).resolves.toBe(0);
    await expect(prisma.walletDevice.count({ where: { wallet: { users: { some: { userId: outsider.id } } } } }))
      .resolves.toBe(0);
    await expect(prisma.wallet.count({ where: { users: { some: { userId: outsider.id } } } }))
      .resolves.toBe(0);
  });
});
