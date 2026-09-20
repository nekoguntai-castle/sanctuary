/** Verify notification role filters against real direct and group grants. */

import { buildUserWalletAccessWhere } from '../../../src/repositories/userWalletAccessQuery';
import {
  addUserToGroup,
  createTestGroup,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

describeIfDatabase('Notification wallet audience role precedence', () => {
  setupRepositoryTests();

  it('uses a direct role before a group role for an edit-only audience', async () => {
    await withTestTransaction(async (tx) => {
      const owner = await createTestUser(tx, { username: 'audience-owner' });
      const mixed = await createTestUser(tx, { username: 'audience-mixed' });
      const groupSigner = await createTestUser(tx, { username: 'audience-group-signer' });
      const directSigner = await createTestUser(tx, { username: 'audience-direct-signer' });
      const outsider = await createTestUser(tx, { username: 'audience-outsider' });
      const group = await createTestGroup(tx);
      await addUserToGroup(tx, mixed.id, group.id);
      await addUserToGroup(tx, groupSigner.id, group.id);
      const wallet = await createTestWallet(tx, owner.id, { groupId: group.id });
      await tx.wallet.update({ where: { id: wallet.id }, data: { groupRole: 'signer' } });
      await tx.walletUser.create({ data: { walletId: wallet.id, userId: mixed.id, role: 'viewer' } });
      await tx.walletUser.create({ data: { walletId: wallet.id, userId: directSigner.id, role: 'signer' } });

      const filtered = await tx.user.findMany({
        where: buildUserWalletAccessWhere(wallet.id, ['owner', 'signer']),
        select: { id: true },
      });
      expect(filtered.map(user => user.id).sort()).toEqual(
        [owner.id, groupSigner.id, directSigner.id].sort(),
      );

      const all = await tx.user.findMany({
        where: buildUserWalletAccessWhere(wallet.id),
        select: { id: true },
      });
      expect(all.map(user => user.id).sort()).toEqual(
        [owner.id, mixed.id, groupSigner.id, directSigner.id].sort(),
      );
      expect(all.some(user => user.id === outsider.id)).toBe(false);
    });
  });
});
