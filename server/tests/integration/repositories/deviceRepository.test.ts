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
  getTestPrisma,
} from './setup';
import { randomUUID } from 'node:crypto';
import { deleteAccountPreservingOne, deleteDeviceIfUnused } from '../../../src/repositories/deviceRepository';
import type { PrismaClient } from '../../../src/generated/prisma/client';

async function waitForBlockedSessions(client: PrismaClient, blockerPid: number, count: number) {
  // The guarded runner gives this file its own database; count direct and queued lock waiters there.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [row] = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> ${blockerPid}
        AND cardinality(pg_blocking_pids(pid)) > 0
    `;
    if (Number(row.count) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${count} blocked database sessions while PID ${blockerPid} holds the device`);
}

function holdDeviceLock(client: PrismaClient, deviceId: string) {
  let announce!: (pid: number) => void;
  let release!: () => void;
  const pid = new Promise<number>((resolve) => { announce = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const finished = client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM devices WHERE id = ${deviceId} FOR UPDATE`;
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    announce(row.pid);
    await released;
  }, { timeout: 15000 });
  return { pid, release, finished };
}

function holdWalletLink(client: PrismaClient, walletId: string, deviceId: string, accountId?: string) {
  let announce!: (pid: number) => void;
  let release!: () => void;
  const pid = new Promise<number>((resolve) => { announce = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const finished = client.$transaction(async (tx) => {
    await tx.walletDevice.create({ data: {
      walletId, deviceId,
      ...(accountId ? {
        deviceAccountId: accountId,
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: 'a1b2c3d4',
        signerXpub: 'bound-account',
        signerDerivationPath: "m/84'/0'/0'",
        signerPurpose: 'single_sig',
        signerScriptType: 'native_segwit',
      } : {}),
    } });
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    announce(row.pid);
    await released;
  }, { timeout: 15000 });
  return { pid, release, finished };
}

async function createCommittedDeviceFixture(withWallet: boolean) {
  const client = await getTestPrisma();
  const suffix = randomUUID();
  const user = await createTestUser(client, {
    username: `device-race-${suffix}`,
    email: `device-race-${suffix}@example.com`,
  });
  const device = await createTestDevice(client, user.id);
  const wallet = withWallet
    ? await createTestWallet(client, user.id, { name: `device-race-${suffix}` })
    : null;
  return {
    client,
    device,
    wallet,
    async cleanup() {
      await client.walletDevice.deleteMany({ where: { deviceId: device.id } });
      if (wallet) await client.wallet.delete({ where: { id: wallet.id } });
      await client.device.deleteMany({ where: { id: device.id } });
      await client.user.delete({ where: { id: user.id } });
    },
  };
}

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
    it('serializes deletes of the final two accounts', async () => {
      const fixture = await createCommittedDeviceFixture(false);
      const { client, device } = fixture;
      try {
        const accounts = await Promise.all([
          client.deviceAccount.create({ data: {
            deviceId: device.id, purpose: 'single_sig', scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'", xpub: 'account-one',
          } }),
          client.deviceAccount.create({ data: {
            deviceId: device.id, purpose: 'single_sig', scriptType: 'nested_segwit',
            derivationPath: "m/49'/0'/0'", xpub: 'account-two',
          } }),
        ]);
        const holder = holdDeviceLock(client, device.id);
        const blockerPid = await holder.pid;
        let attempts: ReturnType<typeof deleteAccountPreservingOne>[] = [];
        try {
          attempts = accounts.map((account) =>
            deleteAccountPreservingOne(device.id, account.id, () => undefined)
          );
          await waitForBlockedSessions(client, blockerPid, 2);
        } finally {
          holder.release();
          await holder.finished;
        }
        const results = await Promise.all(attempts);
        expect(results.map((result) => result.kind).sort()).toEqual(['deleted', 'last-account']);
        expect(await client.deviceAccount.count({ where: { deviceId: device.id } })).toBe(1);
      } finally {
        await fixture.cleanup();
      }
    }, 30000);

    it('preserves an account when a wallet link commits before deletion', async () => {
      const fixture = await createCommittedDeviceFixture(true);
      const { client, device, wallet } = fixture;
      if (!wallet) throw new Error('Expected wallet fixture');
      try {
        const account = await client.deviceAccount.create({ data: {
          deviceId: device.id, purpose: 'single_sig', scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'", xpub: 'bound-account',
        } });
        await client.deviceAccount.create({ data: {
          deviceId: device.id, purpose: 'multisig', scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'", xpub: 'other-account',
        } });
        const link = holdWalletLink(client, wallet.id, device.id, account.id);
        const blockerPid = await link.pid;
        const deletion = deleteAccountPreservingOne(device.id, account.id, () => undefined);
        try {
          await waitForBlockedSessions(client, blockerPid, 1);
        } finally {
          link.release();
          await link.finished;
        }
        expect(await deletion).toEqual({ kind: 'account-linked' });
        expect(await client.deviceAccount.findUnique({ where: { id: account.id } })).not.toBeNull();
        expect(await client.walletDevice.count({ where: { deviceAccountId: account.id } })).toBe(1);
      } finally {
        await fixture.cleanup();
      }
    }, 30000);

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

    it('should allow same purpose and script type when coin-type paths differ', async () => {
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

        await tx.deviceAccount.create({
          data: {
            deviceId: device.id,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/1'/0'",
            xpub: 'tpub2...',
          },
        });

        const accounts = await tx.deviceAccount.findMany({
          where: {
            deviceId: device.id,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
          },
        });

        expect(accounts).toHaveLength(2);
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
    it('keeps a wallet link that commits before device deletion', async () => {
      const fixture = await createCommittedDeviceFixture(true);
      const { client, device, wallet } = fixture;
      if (!wallet) throw new Error('Expected wallet fixture');
      const link = holdWalletLink(client, wallet.id, device.id);
      let deletion: ReturnType<typeof deleteDeviceIfUnused> | undefined;
      try {
        const blockerPid = await link.pid;
        deletion = deleteDeviceIfUnused(device.id);
        try {
          await waitForBlockedSessions(client, blockerPid, 1);
        } finally {
          link.release();
          await link.finished;
        }
        expect(await deletion).toEqual({ kind: 'linked', walletNames: [wallet.name] });
        expect(await client.walletDevice.count({ where: { deviceId: device.id } })).toBe(1);
        expect(await client.device.findUnique({ where: { id: device.id } })).not.toBeNull();
      } finally {
        link.release();
        await Promise.allSettled([link.finished, ...(deletion ? [deletion] : [])]);
        await fixture.cleanup();
      }
    }, 30000);

    it('rejects a wallet link queued after device deletion', async () => {
      const fixture = await createCommittedDeviceFixture(true);
      const { client, device, wallet } = fixture;
      if (!wallet) throw new Error('Expected wallet fixture');
      const holder = holdDeviceLock(client, device.id);
      let deletion: ReturnType<typeof deleteDeviceIfUnused> | undefined;
      let link: Promise<{ succeeded: boolean }> | undefined;
      try {
        const blockerPid = await holder.pid;
        deletion = deleteDeviceIfUnused(device.id);
        try {
          await waitForBlockedSessions(client, blockerPid, 1);
          link = Promise.resolve(client.walletDevice.create({ data: { walletId: wallet.id, deviceId: device.id } }))
            .then(() => ({ succeeded: true }), () => ({ succeeded: false }));
          await waitForBlockedSessions(client, blockerPid, 2);
        } finally {
          holder.release();
          await holder.finished;
        }
        expect(await deletion).toEqual({ kind: 'deleted' });
        expect(await link).toEqual({ succeeded: false });
        expect(await client.device.findUnique({ where: { id: device.id } })).toBeNull();
        expect(await client.walletDevice.count({ where: { deviceId: device.id } })).toBe(0);
      } finally {
        holder.release();
        await Promise.allSettled([holder.finished, ...(deletion ? [deletion] : []), ...(link ? [link] : [])]);
        await fixture.cleanup();
      }
    }, 30000);

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
