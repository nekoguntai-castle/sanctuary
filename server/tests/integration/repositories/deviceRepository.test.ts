/**
 * Device Repository Integration Tests
 *
 * Tests the device repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestDevice,
  createTestWallet,
  createTestGroup,
  addUserToGroup,
  generateFingerprint,
  assertNotExists,
} from './setup';

describeIfDatabase('DeviceRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create a device with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const fingerprint = generateFingerprint();

        const device = await createTestDevice(tx, user.id, {
          type: 'coldcard',
          label: 'My ColdCard',
          fingerprint,
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: "m/84'/1'/0'",
        });

        expect(device.type).toBe('coldcard');
        expect(device.label).toBe('My ColdCard');
        expect(device.fingerprint).toBe(fingerprint);
        expect(device.derivationPath).toBe("m/84'/1'/0'");
        expect(device.userId).toBe(user.id);
      });
    });

    it('should enforce unique fingerprint', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const fingerprint = generateFingerprint();

        await createTestDevice(tx, user.id, { fingerprint });

        await expect(
          createTestDevice(tx, user.id, { fingerprint })
        ).rejects.toThrow();
      });
    });

    it('should allow same fingerprint for different users', async () => {
      // Actually, fingerprint is globally unique in the schema
      // This test verifies that constraint
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'user1' });
        const user2 = await createTestUser(tx, { username: 'user2' });
        const fingerprint = generateFingerprint();

        await createTestDevice(tx, user1.id, { fingerprint });

        // Should fail because fingerprint is globally unique
        await expect(
          createTestDevice(tx, user2.id, { fingerprint })
        ).rejects.toThrow();
      });
    });
  });

  describe('findById', () => {
    it('should find device by ID', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id, { label: 'Test Device' });

        const found = await tx.device.findUnique({
          where: { id: device.id },
        });

        expect(found).not.toBeNull();
        expect(found?.label).toBe('Test Device');
      });
    });

    it('should return null for non-existent ID', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.device.findUnique({
          where: { id: 'non-existent-id' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByFingerprint', () => {
    it('should find device by fingerprint', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const fingerprint = generateFingerprint();
        const device = await createTestDevice(tx, user.id, { fingerprint });

        const found = await tx.device.findUnique({
          where: { fingerprint },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(device.id);
      });
    });

    it('should return null for unknown fingerprint', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.device.findUnique({
          where: { fingerprint: 'unknown-fp' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByUserId', () => {
    it('should find all devices owned by user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestDevice(tx, user.id, { label: 'Device 1' });
        await createTestDevice(tx, user.id, { label: 'Device 2' });
        await createTestDevice(tx, user.id, { label: 'Device 3' });

        const devices = await tx.device.findMany({
          where: { userId: user.id },
        });

        expect(devices).toHaveLength(3);
      });
    });

    it('should not include devices owned by other users', async () => {
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'owner' });
        const user2 = await createTestUser(tx, { username: 'other' });

        await createTestDevice(tx, user1.id, { label: 'User1 Device' });
        await createTestDevice(tx, user2.id, { label: 'User2 Device' });

        const user1Devices = await tx.device.findMany({
          where: { userId: user1.id },
        });

        expect(user1Devices).toHaveLength(1);
        expect(user1Devices[0].label).toBe('User1 Device');
      });
    });
  });

  describe('update', () => {
    it('should update device label', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id, { label: 'Old Label' });

        const updated = await tx.device.update({
          where: { id: device.id },
          data: { label: 'New Label' },
        });

        expect(updated.label).toBe('New Label');
      });
    });

    it('should update updatedAt timestamp', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);
        const originalUpdatedAt = new Date('2024-01-01T00:00:00.000Z');
        await tx.device.update({
          where: { id: device.id },
          data: { updatedAt: originalUpdatedAt },
        });

        const updated = await tx.device.update({
          where: { id: device.id },
          data: { label: 'Updated' },
        });

        expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      });
    });
  });

  describe('delete', () => {
    it('should delete a device', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);

        await tx.device.delete({
          where: { id: device.id },
        });

        await assertNotExists(tx, 'device', { id: device.id });
      });
    });

    it('should cascade delete when user is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);

        await tx.user.delete({
          where: { id: user.id },
        });

        await assertNotExists(tx, 'device', { id: device.id });
      });
    });
  });

  describe('device types', () => {
    it('should support various device types', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const types = ['trezor', 'ledger', 'coldcard', 'bitbox', 'keystone', 'jade'];

        for (const type of types) {
          const device = await createTestDevice(tx, user.id, { type });
          expect(device.type).toBe(type);
        }
      });
    });
  });

  describe('device accounts', () => {
    it('should create device with multiple accounts', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);

        // Create multiple account types for same device
        await tx.deviceAccount.create({
          data: {
            deviceId: device.id,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'zpub...',
          },
        });

        await tx.deviceAccount.create({
          data: {
            deviceId: device.id,
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'Zpub...',
          },
        });

        const accounts = await tx.deviceAccount.findMany({
          where: { deviceId: device.id },
        });

        expect(accounts).toHaveLength(2);
        expect(accounts.map((a) => a.purpose).sort()).toEqual(['multisig', 'single_sig']);
      });
    });

    it('should enforce unique purpose+scriptType per device', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);

        await tx.deviceAccount.create({
          data: {
            deviceId: device.id,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'zpub1...',
          },
        });

        await expect(
          tx.deviceAccount.create({
            data: {
              deviceId: device.id,
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/1'", // Different path
              xpub: 'zpub2...',
            },
          })
        ).rejects.toThrow();
      });
    });

    it('should cascade delete accounts when device is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);

        await tx.deviceAccount.create({
          data: {
            deviceId: device.id,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'zpub...',
          },
        });

        await tx.device.delete({
          where: { id: device.id },
        });

        const accounts = await tx.deviceAccount.findMany({
          where: { deviceId: device.id },
        });

        expect(accounts).toHaveLength(0);
      });
    });
  });

  describe('device sharing', () => {
    it('should share device with another user', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const device = await createTestDevice(tx, owner.id);

        await tx.deviceUser.create({
          data: {
            deviceId: device.id,
            userId: viewer.id,
            role: 'viewer',
          },
        });

        const shares = await tx.deviceUser.findMany({
          where: { deviceId: device.id },
        });

        expect(shares).toHaveLength(1);
        expect(shares[0].userId).toBe(viewer.id);
        expect(shares[0].role).toBe('viewer');
      });
    });

    it('should find devices shared with user', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });

        const device1 = await createTestDevice(tx, owner.id, { label: 'Shared 1' });
        const device2 = await createTestDevice(tx, owner.id, { label: 'Not Shared' });
        const device3 = await createTestDevice(tx, owner.id, { label: 'Shared 2' });

        await tx.deviceUser.create({
          data: { deviceId: device1.id, userId: viewer.id, role: 'viewer' },
        });
        await tx.deviceUser.create({
          data: { deviceId: device3.id, userId: viewer.id, role: 'viewer' },
        });

        // Find all devices viewer has access to (owned or shared)
        const sharedDevices = await tx.device.findMany({
          where: {
            OR: [
              { userId: viewer.id },
              { users: { some: { userId: viewer.id } } },
            ],
          },
        });

        expect(sharedDevices).toHaveLength(2);
        expect(sharedDevices.map((d) => d.label).sort()).toEqual(['Shared 1', 'Shared 2']);
      });
    });
  });

  describe('group sharing', () => {
    it('should share device with group', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const member = await createTestUser(tx, { username: 'member' });
        const group = await createTestGroup(tx, { name: 'Test Group' });

        await addUserToGroup(tx, owner.id, group.id, 'admin');
        await addUserToGroup(tx, member.id, group.id, 'member');

        const device = await tx.device.create({
          data: {
            userId: owner.id,
            type: 'coldcard',
            label: 'Group Device',
            fingerprint: generateFingerprint(),
            xpub: 'tpub...',
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        // Member should see device through group
        const groupDevices = await tx.device.findMany({
          where: {
            groupId: group.id,
            group: { members: { some: { userId: member.id } } },
          },
        });

        expect(groupDevices).toHaveLength(1);
        expect(groupDevices[0].id).toBe(device.id);
      });
    });
  });

  describe('wallet-device associations', () => {
    it('should link device to wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);
        const wallet = await createTestWallet(tx, user.id);

        await tx.walletDevice.create({
          data: {
            walletId: wallet.id,
            deviceId: device.id,
            signerIndex: 0,
          },
        });

        const walletWithDevices = await tx.wallet.findUnique({
          where: { id: wallet.id },
          include: { devices: { include: { device: true } } },
        });

        expect(walletWithDevices?.devices).toHaveLength(1);
        expect(walletWithDevices?.devices[0].device.id).toBe(device.id);
      });
    });

    it('should support multisig with multiple devices', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device1 = await createTestDevice(tx, user.id, { label: 'Signer 1' });
        const device2 = await createTestDevice(tx, user.id, { label: 'Signer 2' });
        const device3 = await createTestDevice(tx, user.id, { label: 'Signer 3' });

        const wallet = await createTestWallet(tx, user.id, {
          type: 'multi_sig',
          quorum: 2,
          totalSigners: 3,
        });

        await tx.walletDevice.createMany({
          data: [
            { walletId: wallet.id, deviceId: device1.id, signerIndex: 0 },
            { walletId: wallet.id, deviceId: device2.id, signerIndex: 1 },
            { walletId: wallet.id, deviceId: device3.id, signerIndex: 2 },
          ],
        });

        const walletWithDevices = await tx.wallet.findUnique({
          where: { id: wallet.id },
          include: {
            devices: {
              include: { device: true },
              orderBy: { signerIndex: 'asc' },
            },
          },
        });

        expect(walletWithDevices?.devices).toHaveLength(3);
        expect(walletWithDevices?.devices.map((d) => d.signerIndex)).toEqual([0, 1, 2]);
      });
    });
  });

  describe('hardware device models', () => {
    it('should link device to hardware model', async () => {
      await withTestTransaction(async (tx) => {
        // Create a hardware model
        const model = await tx.hardwareDeviceModel.create({
          data: {
            name: 'ColdCard Mk4',
            slug: 'coldcard-mk4',
            manufacturer: 'Coinkite',
            connectivity: ['sd_card', 'usb'],
            secureElement: true,
            openSource: true,
            airGapped: true,
            supportsBitcoinOnly: true,
            supportsMultisig: true,
            supportsTaproot: true,
            scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
          },
        });

        const user = await createTestUser(tx);
        const device = await tx.device.create({
          data: {
            userId: user.id,
            modelId: model.id,
            type: 'coldcard',
            label: 'My ColdCard',
            fingerprint: generateFingerprint(),
            xpub: 'tpub...',
          },
        });

        const deviceWithModel = await tx.device.findUnique({
          where: { id: device.id },
          include: { model: true },
        });

        expect(deviceWithModel?.model).not.toBeNull();
        expect(deviceWithModel?.model?.name).toBe('ColdCard Mk4');
        expect(deviceWithModel?.model?.manufacturer).toBe('Coinkite');
      });
    });
  });
});
