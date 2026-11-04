/**
 * Agent advisory locks against a real PostgreSQL database.
 *
 * withAgentFundingTransaction and createAlertIfNotDuplicate take
 * pg_advisory_xact_lock, whose `void` result the Prisma pg adapter cannot
 * deserialize through $queryRaw. The alert status compare-and-set is covered
 * here too, since it shares the alert fixtures.
 */

import { randomUUID } from 'node:crypto';
import {
  describeIfDatabase,
  setupRepositoryTests,
  createTestUser,
  createTestWallet,
  getTestPrisma,
} from './setup';
import {
  createAlert,
  createAlertIfNotDuplicate,
  transitionAlertStatus,
  withAgentFundingTransaction,
} from '../../../src/repositories/agentRepository';

describeIfDatabase('agentRepository advisory locks integration', () => {
  setupRepositoryTests();

  async function createAgentFixture() {
    const client = await getTestPrisma();
    const suffix = randomUUID();
    const user = await createTestUser(client, {
      username: `agent-lock-${suffix}`,
      email: `agent-lock-${suffix}@example.com`,
    });
    const funding = await createTestWallet(client, user.id, { name: `agent-lock-fund-${suffix}` });
    const operational = await createTestWallet(client, user.id, { name: `agent-lock-op-${suffix}` });
    const agent = await client.walletAgent.create({
      data: {
        userId: user.id,
        name: `agent-lock-${suffix}`,
        fundingWalletId: funding.id,
        operationalWalletId: operational.id,
      },
    });
    return { client, agent };
  }

  const alertInput = (agentId: string, dedupeKey: string) => ({
    agentId,
    type: 'funding_cap',
    severity: 'warning' as const,
    message: 'lock test',
    dedupeKey,
  });

  it('runs a callback under the funding lock', async () => {
    const { agent } = await createAgentFixture();

    const found = await withAgentFundingTransaction(agent.id, async tx =>
      tx.walletAgent.findUnique({ where: { id: agent.id } })
    );

    expect(found?.id).toBe(agent.id);
  });

  it('suppresses a duplicate alert for the same dedupe key', async () => {
    const { agent } = await createAgentFixture();
    const key = `k-${randomUUID()}`;
    const since = new Date(Date.now() - 60_000);

    const first = await createAlertIfNotDuplicate(alertInput(agent.id, key), since);
    const second = await createAlertIfNotDuplicate(alertInput(agent.id, key), since);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('inserts exactly one alert for concurrent same-key calls', async () => {
    const { client, agent } = await createAgentFixture();
    const key = `k-${randomUUID()}`;
    const since = new Date(Date.now() - 60_000);

    const results = await Promise.all([
      createAlertIfNotDuplicate(alertInput(agent.id, key), since),
      createAlertIfNotDuplicate(alertInput(agent.id, key), since),
    ]);

    expect(results.filter(r => r !== null)).toHaveLength(1);
    await expect(client.agentAlert.count({ where: { dedupeKey: key } })).resolves.toBe(1);
  });

  it('moves an alert through acknowledge and resolve exactly once', async () => {
    const { agent } = await createAgentFixture();
    const created = await createAlert(alertInput(agent.id, `k-${randomUUID()}`));

    const acknowledged = await transitionAlertStatus(agent.id, created.id, 'acknowledge');
    expect(acknowledged.changed).toBe(true);
    expect(acknowledged.alert?.status).toBe('acknowledged');
    expect(acknowledged.alert?.acknowledgedAt).toBeInstanceOf(Date);

    const repeated = await transitionAlertStatus(agent.id, created.id, 'acknowledge');
    expect(repeated).toEqual({ alert: acknowledged.alert, changed: false });

    const concurrentResolves = await Promise.all([
      transitionAlertStatus(agent.id, created.id, 'resolve'),
      transitionAlertStatus(agent.id, created.id, 'resolve'),
    ]);
    expect(concurrentResolves.filter(result => result.changed)).toHaveLength(1);
    expect(concurrentResolves[0].alert?.status).toBe('resolved');
    expect(concurrentResolves[0].alert?.acknowledgedAt).toEqual(acknowledged.alert?.acknowledgedAt);

    const lateAcknowledge = await transitionAlertStatus(agent.id, created.id, 'acknowledge');
    expect(lateAcknowledge.changed).toBe(false);
    expect(lateAcknowledge.alert?.status).toBe('resolved');
  });

  it('does not transition an alert through another agent', async () => {
    const { client, agent } = await createAgentFixture();
    const { agent: otherAgent } = await createAgentFixture();
    const created = await createAlert(alertInput(agent.id, `k-${randomUUID()}`));

    await expect(transitionAlertStatus(otherAgent.id, created.id, 'resolve')).resolves.toEqual({
      alert: null,
      changed: false,
    });
    await expect(client.agentAlert.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
      status: 'open',
      resolvedAt: null,
    });
  });
});
