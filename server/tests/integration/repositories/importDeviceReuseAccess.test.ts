/** Verify import's transaction-scoped device role guard against PostgreSQL. */

import { assertDeviceReuseAccess } from '../../../src/services/walletImport/deviceReuseAccess';
import type { PrismaTxClient } from '../../../src/models/prisma';
import {
  addUserToGroup,
  createTestDevice,
  createTestGroup,
  createTestUser,
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

describeIfDatabase('wallet import current device access', () => {
  setupRepositoryTests();

  it('requires owner for a new path and current access for exact reuse', async () => {
    await withTestTransaction(async (tx) => {
      // The repository fixture types this runtime transaction client as PrismaClient.
      const txClient = tx as unknown as PrismaTxClient;
      const owner = await createTestUser(tx, { username: 'import-access-owner' });
      const viewer = await createTestUser(tx, { username: 'import-access-viewer' });
      const mixed = await createTestUser(tx, { username: 'import-access-mixed' });
      const groupOwner = await createTestUser(tx, { username: 'import-access-group-owner' });
      const outsider = await createTestUser(tx, { username: 'import-access-outsider' });
      const group = await createTestGroup(tx);
      await addUserToGroup(tx, mixed.id, group.id);
      await addUserToGroup(tx, groupOwner.id, group.id);
      const device = await createTestDevice(tx, owner.id);
      await tx.device.update({ where: { id: device.id }, data: { groupId: group.id, groupRole: 'owner' } });
      await tx.deviceUser.createMany({ data: [
        { deviceId: device.id, userId: owner.id, role: 'owner' },
        { deviceId: device.id, userId: viewer.id, role: 'viewer' },
        { deviceId: device.id, userId: mixed.id, role: 'viewer' },
      ] });

      await expect(assertDeviceReuseAccess(txClient, device.id, owner.id, true)).resolves.toBeUndefined();
      await expect(assertDeviceReuseAccess(txClient, device.id, viewer.id, false)).resolves.toBeUndefined();
      await expect(assertDeviceReuseAccess(txClient, device.id, viewer.id, true))
        .rejects.toMatchObject({ statusCode: 403 });
      await expect(assertDeviceReuseAccess(txClient, device.id, groupOwner.id, true)).resolves.toBeUndefined();
      await expect(assertDeviceReuseAccess(txClient, device.id, mixed.id, true))
        .rejects.toMatchObject({ statusCode: 403 });
      await expect(assertDeviceReuseAccess(txClient, device.id, outsider.id, false))
        .rejects.toMatchObject({ statusCode: 403 });

      await tx.deviceUser.delete({ where: { deviceId_userId: { deviceId: device.id, userId: viewer.id } } });
      await expect(assertDeviceReuseAccess(txClient, device.id, viewer.id, false))
        .rejects.toMatchObject({ statusCode: 403 });
      await tx.groupMember.delete({ where: { userId_groupId: { userId: groupOwner.id, groupId: group.id } } });
      await expect(assertDeviceReuseAccess(txClient, device.id, groupOwner.id, false))
        .rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
