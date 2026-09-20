/** Verify wallet edit filters against real direct and group relationships. */

import type { PrismaClient } from '../../../src/generated/prisma/client';
import { buildWalletEditAccessWhere } from '../../../src/repositories/accessControl';
import {
  addUserToGroup,
  createTestGroup,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

async function expectEditAccess(
  tx: PrismaClient,
  walletId: string,
  userId: string,
  allowed: boolean,
): Promise<void> {
  const filter = buildWalletEditAccessWhere(userId);
  const [networkWallets, wallet] = await Promise.all([
    tx.wallet.findMany({ where: { network: 'testnet3', ...filter }, select: { id: true } }),
    tx.wallet.findFirst({ where: { id: walletId, ...filter }, select: { id: true } }),
  ]);

  expect(networkWallets.some(candidate => candidate.id === walletId)).toBe(allowed);
  expect(wallet?.id === walletId).toBe(allowed);
}

describeIfDatabase('Wallet edit access role precedence', () => {
  setupRepositoryTests();

  it('applies a direct role before a group role in both edit query shapes', async () => {
    await withTestTransaction(async (tx) => {
      const owner = await createTestUser(tx, { username: 'edit-filter-owner' });
      const member = await createTestUser(tx, { username: 'edit-filter-member' });
      const outsider = await createTestUser(tx, { username: 'edit-filter-outsider' });
      const group = await createTestGroup(tx);
      await addUserToGroup(tx, member.id, group.id);
      const wallet = await createTestWallet(tx, owner.id, { groupId: group.id });
      await tx.wallet.update({ where: { id: wallet.id }, data: { groupRole: 'signer' } });

      await expectEditAccess(tx, wallet.id, owner.id, true);
      await expectEditAccess(tx, wallet.id, outsider.id, false);
      await expectEditAccess(tx, wallet.id, member.id, true);

      const directGrant = await tx.walletUser.create({
        data: { walletId: wallet.id, userId: member.id, role: 'viewer' },
      });
      await expectEditAccess(tx, wallet.id, member.id, false);
      await tx.walletUser.update({ where: { id: directGrant.id }, data: { role: 'approver' } });
      await expectEditAccess(tx, wallet.id, member.id, false);
      await tx.walletUser.update({ where: { id: directGrant.id }, data: { role: 'signer' } });
      await expectEditAccess(tx, wallet.id, member.id, true);
      await tx.walletUser.update({ where: { id: directGrant.id }, data: { role: 'owner' } });
      await expectEditAccess(tx, wallet.id, member.id, true);

      await tx.walletUser.delete({ where: { id: directGrant.id } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { groupRole: 'viewer' } });
      await expectEditAccess(tx, wallet.id, member.id, false);
      await tx.wallet.update({ where: { id: wallet.id }, data: { groupRole: 'owner' } });
      await expectEditAccess(tx, wallet.id, member.id, true);
    });
  });
});
