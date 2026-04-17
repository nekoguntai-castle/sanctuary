import { describe, expect, it } from 'vitest';
import { toAgentAlertMetadata } from '../../../src/agent/dto';

describe('agent dto helpers', () => {
  it('serializes agent alert metadata without losing bigint or nullable fields', () => {
    const now = new Date('2026-04-16T00:00:00.000Z');

    expect(toAgentAlertMetadata({
      id: 'alert-1',
      agentId: 'agent-1',
      walletId: 'wallet-1',
      type: 'large_operational_spend',
      severity: 'critical',
      status: 'open',
      txid: 'a'.repeat(64),
      amountSats: 100000n,
      feeSats: 5000n,
      thresholdSats: 75000n,
      observedCount: null,
      reasonCode: null,
      message: 'Large operational spend',
      dedupeKey: 'agent:agent-1:large_spend:tx',
      metadata: { thresholdSats: '75000' },
      createdAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
    } as any)).toEqual({
      id: 'alert-1',
      agentId: 'agent-1',
      walletId: 'wallet-1',
      type: 'large_operational_spend',
      severity: 'critical',
      status: 'open',
      txid: 'a'.repeat(64),
      amountSats: '100000',
      feeSats: '5000',
      thresholdSats: '75000',
      observedCount: null,
      reasonCode: null,
      message: 'Large operational spend',
      dedupeKey: 'agent:agent-1:large_spend:tx',
      metadata: { thresholdSats: '75000' },
      createdAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
    });
  });
});
