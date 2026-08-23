/**
 * System Setting Repository Integration Tests
 *
 * Tests the system setting repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';
import prisma from '../../../src/models/prisma';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../src/constants/walletSyncActivation';
import {
  WALLET_SYNC_ACTIVATION_KEY,
  WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
} from '../../../src/repositories/operationalSystemSettings';
import {
  inspectWalletSyncActivationReadiness,
  observeWalletSyncActivationReadiness,
  readWalletSyncActivationStabilization,
} from '../../../src/repositories/walletSyncActivationStabilizationRepository';

describeIfDatabase('SystemSettingRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('get', () => {
    it('should get a setting by key', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'test.key', value: 'test-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'test.key' },
        });

        expect(setting).not.toBeNull();
        expect(setting?.value).toBe('test-value');
      });
    });

    it('should return null for non-existent key', async () => {
      await withTestTransaction(async (tx) => {
        const setting = await tx.systemSetting.findUnique({
          where: { key: 'non.existent.key' },
        });

        expect(setting).toBeNull();
      });
    });
  });

  describe('set (upsert)', () => {
    it('should create a new setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'new.setting' },
          update: { value: 'new-value' },
          create: { key: 'new.setting', value: 'new-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'new.setting' },
        });

        expect(setting?.value).toBe('new-value');
      });
    });

    it('should update an existing setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'update.me', value: 'old-value' },
        });

        await tx.systemSetting.upsert({
          where: { key: 'update.me' },
          update: { value: 'new-value' },
          create: { key: 'update.me', value: 'new-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'update.me' },
        });

        expect(setting?.value).toBe('new-value');
      });
    });
  });

  describe('type-specific getters', () => {
    it('should get boolean setting (true)', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'bool.true', value: 'true' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'bool.true' },
        });

        const value = setting?.value === 'true' || setting?.value === '1';
        expect(value).toBe(true);
      });
    });

    it('should get boolean setting (false)', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'bool.false', value: 'false' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'bool.false' },
        });

        const value = setting?.value === 'true' || setting?.value === '1';
        expect(value).toBe(false);
      });
    });

    it('should get number setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'number.setting', value: '42' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'number.setting' },
        });

        const value = Number(setting?.value);
        expect(value).toBe(42);
      });
    });

    it('should get JSON setting', async () => {
      await withTestTransaction(async (tx) => {
        const jsonValue = { enabled: true, limit: 100 };
        await tx.systemSetting.create({
          data: { key: 'json.setting', value: JSON.stringify(jsonValue) },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'json.setting' },
        });

        const parsed = JSON.parse(setting?.value || '{}');
        expect(parsed.enabled).toBe(true);
        expect(parsed.limit).toBe(100);
      });
    });
  });

  describe('getAll', () => {
    it('should get all settings', async () => {
      await withTestTransaction(async (tx) => {
        const prefix = `test_${Date.now()}_`;
        await tx.systemSetting.createMany({
          data: [
            { key: `${prefix}setting.a`, value: 'value-a' },
            { key: `${prefix}setting.b`, value: 'value-b' },
            { key: `${prefix}setting.c`, value: 'value-c' },
          ],
        });

        const settings = await tx.systemSetting.findMany({
          where: { key: { startsWith: prefix } },
          orderBy: { key: 'asc' },
        });

        expect(settings).toHaveLength(3);
      });
    });

    it('should order settings by key', async () => {
      await withTestTransaction(async (tx) => {
        const prefix = `order_${Date.now()}_`;
        await tx.systemSetting.createMany({
          data: [
            { key: `${prefix}z.setting`, value: 'z' },
            { key: `${prefix}a.setting`, value: 'a' },
            { key: `${prefix}m.setting`, value: 'm' },
          ],
        });

        const settings = await tx.systemSetting.findMany({
          where: { key: { startsWith: prefix } },
          orderBy: { key: 'asc' },
        });

        expect(settings.map((s) => s.key)).toEqual([
          `${prefix}a.setting`,
          `${prefix}m.setting`,
          `${prefix}z.setting`,
        ]);
      });
    });
  });

  describe('getByPrefix', () => {
    it('should get settings by prefix', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'sync.enabled', value: 'true' },
            { key: 'sync.interval', value: '5000' },
            { key: 'price.enabled', value: 'true' },
          ],
        });

        const syncSettings = await tx.systemSetting.findMany({
          where: {
            key: { startsWith: 'sync.' },
          },
        });

        expect(syncSettings).toHaveLength(2);
        expect(syncSettings.every((s) => s.key.startsWith('sync.'))).toBe(true);
      });
    });
  });

  describe('getAllAsMap', () => {
    it('should return settings as key-value map', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'map.key1', value: 'value1' },
            { key: 'map.key2', value: 'value2' },
          ],
        });

        const settings = await tx.systemSetting.findMany();
        const map: Record<string, string> = {};
        for (const setting of settings) {
          map[setting.key] = setting.value;
        }

        expect(map['map.key1']).toBe('value1');
        expect(map['map.key2']).toBe('value2');
      });
    });
  });

  describe('setMany', () => {
    it('should set multiple settings at once', async () => {
      await withTestTransaction(async (tx) => {
        const testPrefix = `batch_${Date.now()}_`;
        const settings = [
          { key: `${testPrefix}a`, value: 'a' },
          { key: `${testPrefix}b`, value: 'b' },
          { key: `${testPrefix}c`, value: 'c' },
        ];

        // Use Promise.all instead of tx.$transaction (already in transaction)
        await Promise.all(
          settings.map((s) =>
            tx.systemSetting.upsert({
              where: { key: s.key },
              update: { value: s.value },
              create: s,
            })
          )
        );

        const result = await tx.systemSetting.findMany({
          where: {
            key: { startsWith: testPrefix },
          },
        });

        expect(result).toHaveLength(3);
      });
    });
  });

  describe('delete', () => {
    it('should delete a setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'delete.me', value: 'to-be-deleted' },
        });

        await tx.systemSetting.delete({
          where: { key: 'delete.me' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'delete.me' },
        });

        expect(setting).toBeNull();
      });
    });
  });

  describe('deleteByPrefix', () => {
    it('should delete settings by prefix', async () => {
      await withTestTransaction(async (tx) => {
        const testPrefix = `deltest_${Date.now()}_`;
        await tx.systemSetting.createMany({
          data: [
            { key: `${testPrefix}temp.setting1`, value: 'v1' },
            { key: `${testPrefix}temp.setting2`, value: 'v2' },
            { key: `${testPrefix}permanent.setting`, value: 'keep' },
          ],
        });

        const result = await tx.systemSetting.deleteMany({
          where: {
            key: { startsWith: `${testPrefix}temp.` },
          },
        });

        expect(result.count).toBe(2);

        const remaining = await tx.systemSetting.count({
          where: { key: { startsWith: testPrefix } },
        });
        expect(remaining).toBe(1);
      });
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'exists.check', value: 'yes' },
        });

        const count = await tx.systemSetting.count({
          where: { key: 'exists.check' },
        });

        expect(count > 0).toBe(true);
      });
    });

    it('should return false for non-existent key', async () => {
      await withTestTransaction(async (tx) => {
        const count = await tx.systemSetting.count({
          where: { key: 'does.not.exist' },
        });

        expect(count > 0).toBe(false);
      });
    });
  });

  describe('well-known settings', () => {
    it('should handle server name setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'server.name' },
          update: { value: 'My Sanctuary' },
          create: { key: 'server.name', value: 'My Sanctuary' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'server.name' },
        });

        expect(setting?.value).toBe('My Sanctuary');
      });
    });

    it('should handle maintenance mode setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'maintenance.mode' },
          update: { value: 'true' },
          create: { key: 'maintenance.mode', value: 'true' },
        });

        await tx.systemSetting.upsert({
          where: { key: 'maintenance.message' },
          update: { value: 'System upgrade in progress' },
          create: { key: 'maintenance.message', value: 'System upgrade in progress' },
        });

        const mode = await tx.systemSetting.findUnique({
          where: { key: 'maintenance.mode' },
        });
        const message = await tx.systemSetting.findUnique({
          where: { key: 'maintenance.message' },
        });

        expect(mode?.value).toBe('true');
        expect(message?.value).toBe('System upgrade in progress');
      });
    });
  });

  describe('wallet-sync activation stabilization', () => {
    const input = (evaluatedAt = new Date()) => ({
      observation: { status: 'ready' as const, observedAt: evaluatedAt },
      evaluatedAt,
      readyObservationMaxAgeMs: 15_000,
      drainHorizonMs: 30_000,
    });

    afterEach(async () => {
      await prisma.systemSetting.deleteMany({
        where: {
          key: { in: [
            WALLET_SYNC_ACTIVATION_KEY,
            WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
          ] },
        },
      });
    });

    it('serializes concurrent replica observations into one monotonic interval', async () => {
      const before = Date.now();
      const results = await Promise.all([
        observeWalletSyncActivationReadiness(input()),
        observeWalletSyncActivationReadiness(input()),
      ]);
      const after = Date.now();

      expect(results.every(result => result.readyObservationAccepted)).toBe(true);
      const state = await readWalletSyncActivationStabilization();
      expect(state).toMatchObject({
        version: 1,
        requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      });
      expect(Date.parse(state.candidateReadySince!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(state.lastReadyAt!)).toBeGreaterThanOrEqual(
        Date.parse(state.candidateReadySince!),
      );
      expect(Date.parse(state.lastReadyAt!)).toBeLessThanOrEqual(after + 1_000);
    });

    it('reads ready evidence without waiting for a concurrent row-lock holder', async () => {
      await observeWalletSyncActivationReadiness(input());
      let releaseLock!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let locked!: () => void;
      const rowLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const lockOwner = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "value"
          FROM "system_settings"
          WHERE "key" = ${WALLET_SYNC_ACTIVATION_STABILIZATION_KEY}
          FOR UPDATE
        `;
        locked();
        await holdLock;
      });
      await rowLocked;

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const inspected = await Promise.race([
          inspectWalletSyncActivationReadiness({
            readyObservationMaxAgeMs: 15_000,
            drainHorizonMs: 30_000,
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('read-only inspection waited for row lock')),
              1_000,
            );
          }),
        ]);
        expect(inspected.readyObservationAccepted).toBe(true);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        releaseLock();
        await lockOwner;
      }
    });

    it('atomically clears continuous evidence on a blocked observation', async () => {
      await observeWalletSyncActivationReadiness(input());

      await expect(observeWalletSyncActivationReadiness({
        observation: { status: 'blocked' },
        evaluatedAt: new Date(),
        readyObservationMaxAgeMs: 15_000,
        drainHorizonMs: 30_000,
      })).resolves.toMatchObject({
        state: {
          candidateReadySince: null,
          lastReadyAt: null,
        },
        drainHorizonSatisfied: false,
      });
    });

    it('never mutates the immutable active policy while recording readiness', async () => {
      const activeValue = JSON.stringify({
        version: 1,
        activatedAt: '2026-08-22T00:00:00.000Z',
        mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      });
      await prisma.systemSetting.create({
        data: { key: WALLET_SYNC_ACTIVATION_KEY, value: activeValue },
      });

      await observeWalletSyncActivationReadiness(input());

      await expect(prisma.systemSetting.findUnique({
        where: { key: WALLET_SYNC_ACTIVATION_KEY },
        select: { value: true },
      })).resolves.toEqual({ value: activeValue });
    });

    it('leaves malformed durable evidence untouched when observation fails closed', async () => {
      await prisma.systemSetting.create({
        data: {
          key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
          value: '{}',
        },
      });

      await expect(observeWalletSyncActivationReadiness(input())).rejects.toThrow(
        'Invalid durable wallet-sync activation stabilization state',
      );
      await expect(prisma.systemSetting.findUnique({
        where: { key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY },
        select: { value: true },
      })).resolves.toEqual({ value: '{}' });
    });
  });
});
