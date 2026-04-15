/**
 * Push Device Repository Integration Tests
 *
 * Tests the push device repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestPushDevice,
  assertNotExists,
} from './setup';

describeIfDatabase('PushDeviceRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create a push device with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const device = await createTestPushDevice(tx, user.id, {
          token: 'push-token-abc123',
          platform: 'ios',
          deviceName: 'iPhone 15 Pro',
        });

        expect(device.token).toBe('push-token-abc123');
        expect(device.platform).toBe('ios');
        expect(device.deviceName).toBe('iPhone 15 Pro');
        expect(device.userId).toBe(user.id);
      });
    });

    it('should enforce unique token', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestPushDevice(tx, user.id, { token: 'unique-token' });

        await expect(
          createTestPushDevice(tx, user.id, { token: 'unique-token' })
        ).rejects.toThrow();
      });
    });
  });

  describe('findById', () => {
    it('should find device by ID', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestPushDevice(tx, user.id);

        const found = await tx.pushDevice.findUnique({
          where: { id: device.id },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(device.id);
      });
    });
  });

  describe('findByToken', () => {
    it('should find device by token', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        await createTestPushDevice(tx, user.id, { token: 'find-by-token' });

        const found = await tx.pushDevice.findUnique({
          where: { token: 'find-by-token' },
        });

        expect(found).not.toBeNull();
      });
    });

    it('should return null for unknown token', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.pushDevice.findUnique({
          where: { token: 'unknown-token' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByUserId', () => {
    it('should find all devices for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestPushDevice(tx, user.id, { token: 'token-1', platform: 'ios' });
        await createTestPushDevice(tx, user.id, { token: 'token-2', platform: 'android' });
        await createTestPushDevice(tx, user.id, { token: 'token-3', platform: 'ios' });

        const devices = await tx.pushDevice.findMany({
          where: { userId: user.id },
        });

        expect(devices).toHaveLength(3);
      });
    });

    it('should order by creation date descending', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const firstCreatedAt = new Date('2024-01-01T00:00:00.000Z');
        const secondCreatedAt = new Date('2024-01-01T00:00:01.000Z');

        await createTestPushDevice(tx, user.id, { token: 'first', createdAt: firstCreatedAt });
        await createTestPushDevice(tx, user.id, { token: 'second', createdAt: secondCreatedAt });

        const devices = await tx.pushDevice.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });

        expect(devices[0].token).toBe('second');
        expect(devices[1].token).toBe('first');
      });
    });
  });

  describe('findByUserIdAndPlatform', () => {
    it('should filter devices by platform', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestPushDevice(tx, user.id, { token: 'ios-1', platform: 'ios' });
        await createTestPushDevice(tx, user.id, { token: 'ios-2', platform: 'ios' });
        await createTestPushDevice(tx, user.id, { token: 'android-1', platform: 'android' });

        const iosDevices = await tx.pushDevice.findMany({
          where: { userId: user.id, platform: 'ios' },
        });

        expect(iosDevices).toHaveLength(2);
        expect(iosDevices.every((d) => d.platform === 'ios')).toBe(true);
      });
    });
  });

  describe('countByUserId', () => {
    it('should count devices for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestPushDevice(tx, user.id, { token: 'token-a' });
        await createTestPushDevice(tx, user.id, { token: 'token-b' });

        const count = await tx.pushDevice.count({
          where: { userId: user.id },
        });

        expect(count).toBe(2);
      });
    });
  });

  describe('upsert', () => {
    it('should create new device if token does not exist', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await tx.pushDevice.upsert({
          where: { token: 'new-upsert-token' },
          update: {
            userId: user.id,
            platform: 'ios',
          },
          create: {
            userId: user.id,
            token: 'new-upsert-token',
            platform: 'ios',
          },
        });

        const device = await tx.pushDevice.findUnique({
          where: { token: 'new-upsert-token' },
        });

        expect(device).not.toBeNull();
      });
    });

    it('should update existing device if token exists', async () => {
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'user1' });
        const user2 = await createTestUser(tx, { username: 'user2' });

        // Create with user1
        await createTestPushDevice(tx, user1.id, {
          token: 'transfer-token',
          deviceName: 'Old Name',
        });

        // Upsert with user2 (simulating device transfer)
        await tx.pushDevice.upsert({
          where: { token: 'transfer-token' },
          update: {
            userId: user2.id,
            deviceName: 'New Name',
            lastUsedAt: new Date(),
          },
          create: {
            userId: user2.id,
            token: 'transfer-token',
            platform: 'ios',
          },
        });

        const device = await tx.pushDevice.findUnique({
          where: { token: 'transfer-token' },
        });

        expect(device?.userId).toBe(user2.id);
        expect(device?.deviceName).toBe('New Name');
      });
    });
  });

  describe('updateLastUsed', () => {
    it('should update last used timestamp', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const originalLastUsed = new Date('2024-01-01T00:00:00.000Z');
        const nextLastUsed = new Date('2024-01-01T00:00:01.000Z');
        const device = await createTestPushDevice(tx, user.id, { lastUsedAt: originalLastUsed });

        expect(device.lastUsedAt.getTime()).toBe(originalLastUsed.getTime());

        await tx.pushDevice.update({
          where: { id: device.id },
          data: { lastUsedAt: nextLastUsed },
        });

        const updated = await tx.pushDevice.findUnique({
          where: { id: device.id },
        });

        expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(originalLastUsed.getTime());
      });
    });
  });

  describe('deleteById', () => {
    it('should delete device by ID', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestPushDevice(tx, user.id);

        await tx.pushDevice.delete({
          where: { id: device.id },
        });

        await assertNotExists(tx, 'pushDevice', { id: device.id });
      });
    });
  });

  describe('deleteByToken', () => {
    it('should delete device by token', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        await createTestPushDevice(tx, user.id, { token: 'delete-me-token' });

        await tx.pushDevice.delete({
          where: { token: 'delete-me-token' },
        });

        const device = await tx.pushDevice.findUnique({
          where: { token: 'delete-me-token' },
        });

        expect(device).toBeNull();
      });
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all devices for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestPushDevice(tx, user.id, { token: 'user-device-1' });
        await createTestPushDevice(tx, user.id, { token: 'user-device-2' });
        await createTestPushDevice(tx, user.id, { token: 'user-device-3' });

        const result = await tx.pushDevice.deleteMany({
          where: { userId: user.id },
        });

        expect(result.count).toBe(3);

        const remaining = await tx.pushDevice.count({
          where: { userId: user.id },
        });
        expect(remaining).toBe(0);
      });
    });
  });

  describe('deleteStale', () => {
    it('should delete devices not used recently', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const now = new Date();

        // Create stale device
        await tx.pushDevice.create({
          data: {
            userId: user.id,
            token: 'stale-device',
            platform: 'ios',
            lastUsedAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
          },
        });

        // Create active device
        await createTestPushDevice(tx, user.id, { token: 'active-device' });

        const cutoffDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

        const result = await tx.pushDevice.deleteMany({
          where: {
            lastUsedAt: { lt: cutoffDate },
          },
        });

        expect(result.count).toBe(1);

        const remaining = await tx.pushDevice.count({
          where: { userId: user.id },
        });
        expect(remaining).toBe(1);
      });
    });
  });

  describe('cascade delete', () => {
    it('should cascade delete when user is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestPushDevice(tx, user.id);

        await tx.user.delete({
          where: { id: user.id },
        });

        await assertNotExists(tx, 'pushDevice', { id: device.id });
      });
    });
  });

  describe('platform statistics', () => {
    it('should count devices by platform', async () => {
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'user1' });
        const user2 = await createTestUser(tx, { username: 'user2' });

        await createTestPushDevice(tx, user1.id, { token: 't1', platform: 'ios' });
        await createTestPushDevice(tx, user1.id, { token: 't2', platform: 'ios' });
        await createTestPushDevice(tx, user2.id, { token: 't3', platform: 'android' });
        await createTestPushDevice(tx, user2.id, { token: 't4', platform: 'android' });
        await createTestPushDevice(tx, user2.id, { token: 't5', platform: 'android' });

        const platformCounts = await tx.pushDevice.groupBy({
          by: ['platform'],
          _count: { platform: true },
        });

        const iosCount = platformCounts.find((p) => p.platform === 'ios');
        const androidCount = platformCounts.find((p) => p.platform === 'android');

        expect(iosCount?._count.platform).toBe(2);
        expect(androidCount?._count.platform).toBe(3);
      });
    });
  });
});
