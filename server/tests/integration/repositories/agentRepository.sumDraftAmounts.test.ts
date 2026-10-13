/**
 * Agent funding cap accounting against a real PostgreSQL database.
 *
 * sumAgentDraftAmountsSince backs the daily/weekly funding caps, so drafts
 * that were already broadcast must keep counting inside the window.
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
import {
  BROADCASTED_DRAFT_STATUS,
  type DraftLifecycleStatus,
} from '@sanctuary/shared/constants/drafts';
import { sumAgentDraftAmountsSince } from '../../../src/repositories/agentRepository';

describeIfDatabase('agentRepository.sumAgentDraftAmountsSince integration', () => {
  setupRepositoryTests();

  it('counts actionable and broadcast drafts inside the window only', async () => {
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
      const make = async (status: DraftLifecycleStatus, amount: bigint, createdAt: Date) => {
        const draft = await createTestDraft(client, funding.id, user.id, { amount, createdAt });
        await client.draftTransaction.update({ where: { id: draft.id }, data: { agentId: agent.id, status } });
      };

      await make('unsigned', 10_000n, new Date(now - 60 * 60 * 1000));
      await make(BROADCASTED_DRAFT_STATUS, 20_000n, new Date(now - 30 * 60 * 1000));
      await make(BROADCASTED_DRAFT_STATUS, 40_000n, new Date(now - 48 * 60 * 60 * 1000));

      await expect(sumAgentDraftAmountsSince(agent.id, since)).resolves.toBe(30_000n);
    } finally {
      await client.draftTransaction.deleteMany({ where: { agentId: agent.id } });
      await client.walletAgent.delete({ where: { id: agent.id } });
      await client.wallet.deleteMany({ where: { id: { in: [funding.id, operational.id] } } });
      await client.user.delete({ where: { id: user.id } });
    }
  });
});
