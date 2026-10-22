/**
 * Agent funding cap accounting against a real PostgreSQL database.
 *
 * sumAcceptedFundingAmountsSince backs the daily/weekly funding caps. It sums
 * accepted funding attempts, which outlive their drafts, so deleting the draft
 * (or broadcasting its intent without one) never lowers the total.
 */

import { randomUUID } from 'node:crypto';
import {
  describeIfDatabase,
  setupRepositoryTests,
  createTestUser,
  createTestWallet,
  createTestDraft,
  getTestPrisma,
} from './setup';
import { sumAcceptedFundingAmountsSince } from '../../../src/repositories/agentRepository';
import { deleteDraft } from '../../../src/services/draftService';

describeIfDatabase('agentRepository.sumAcceptedFundingAmountsSince integration', () => {
  setupRepositoryTests();

  it('counts accepted attempts inside the window, also after their drafts are deleted', async () => {
    const client = await getTestPrisma();
    const suffix = randomUUID();
    const user = await createTestUser(client, {
      username: `agent-sum-${suffix}`,
      email: `agent-sum-${suffix}@example.com`,
    });
    const funding = await createTestWallet(client, user.id, { name: `agent-sum-fund-${suffix}` });
    const operational = await createTestWallet(client, user.id, { name: `agent-sum-op-${suffix}` });
    const agent = await client.walletAgent.create({
      data: {
        userId: user.id,
        name: `agent-sum-${suffix}`,
        fundingWalletId: funding.id,
        operationalWalletId: operational.id,
      },
    });

    try {
      const now = Date.now();
      const since = new Date(now - 24 * 60 * 60 * 1000);
      const attempt = async (status: 'accepted' | 'rejected', amount: bigint, createdAt: Date) => {
        const draft = await createTestDraft(client, funding.id, user.id, { amount, createdAt });
        await client.draftTransaction.update({ where: { id: draft.id }, data: { agentId: agent.id } });
        await client.agentFundingAttempt.create({
          data: { agentId: agent.id, fundingWalletId: funding.id, draftId: draft.id, status, amount, createdAt },
        });
        return draft;
      };

      const deleted = await attempt('accepted', 10_000n, new Date(now - 60 * 60 * 1000));
      await attempt('accepted', 20_000n, new Date(now - 30 * 60 * 1000));
      await attempt('rejected', 70_000n, new Date(now - 20 * 60 * 1000));
      await attempt('accepted', 40_000n, new Date(now - 48 * 60 * 60 * 1000));
      await expect(sumAcceptedFundingAmountsSince(agent.id, since)).resolves.toBe(30_000n);

      // The linked user deletes the still-actionable funding draft (allowed).
      await deleteDraft(funding.id, deleted.id, user.id, 'signer');
      await expect(client.draftTransaction.findUnique({ where: { id: deleted.id } })).resolves.toBeNull();
      await expect(sumAcceptedFundingAmountsSince(agent.id, since)).resolves.toBe(30_000n);
    } finally {
      await client.agentFundingAttempt.deleteMany({ where: { agentId: agent.id } });
      await client.draftTransaction.deleteMany({ where: { agentId: agent.id } });
      await client.walletAgent.delete({ where: { id: agent.id } });
      await client.wallet.deleteMany({ where: { id: { in: [funding.id, operational.id] } } });
      await client.user.delete({ where: { id: user.id } });
    }
  });
});
