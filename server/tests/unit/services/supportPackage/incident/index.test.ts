import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactions: vi.fn(),
  jobs: vi.fn(),
  eligibility: vi.fn(),
}));

vi.mock('../../../../../src/services/supportPackage/incident/transactionEvidence', () => ({
  readIncidentTransactionEvidence: mocks.transactions,
}));

vi.mock('../../../../../src/services/supportPackage/incident/jobEvidence', () => ({
  readIncidentJobEvidence: mocks.jobs,
}));

vi.mock('../../../../../src/repositories/supportNotificationDiagnosticsRepository', () => ({
  getIncidentTelegramEligibilityCoverage: mocks.eligibility,
}));

import { readIncidentEvidence } from '../../../../../src/services/supportPackage/incident';

describe('incident evidence assembly', () => {
  it('returns exactly sender and receiver with truthful unsupported defaults', async () => {
    const transaction = (role: 'sender' | 'receiver') => ({
      role,
      expectedDirection: role === 'sender' ? 'sent' as const : 'received' as const,
      lookupStatus: 'observed' as const,
      transactionRow: {
        present: 'observed_true' as const,
        directionMatches: 'observed_true' as const,
        timing: 'within_window' as const,
      },
    });
    const notificationJob = (role: 'sender' | 'receiver') => ({
      role,
      expectedDirection: role === 'sender' ? 'sent' as const : 'received' as const,
      lookupStatus: 'observed' as const,
      present: 'not_observed' as const,
      state: 'not_observed' as const,
      attempts: 'unknown' as const,
      enqueue: 'not_observed' as const,
      handler: 'not_observed' as const,
      terminal: 'not_observed' as const,
      telegram: { outcome: 'not_observed' as const, failureClass: 'not_observed' as const },
      ages: {
        created: 'not_observed' as const,
        processed: 'not_observed' as const,
        finished: 'not_observed' as const,
      },
      retention: {
        record: 'not_retained' as const,
        horizon: 'unsupported' as const,
        saturation: 'unknown' as const,
      },
    });
    mocks.transactions.mockResolvedValue({
      roles: [transaction('sender'), transaction('receiver')],
      receiverMatch: {
        ownsSelectedOutput: 'observed_true',
        networkMatches: 'observed_true',
        addressTiming: 'within_window',
      },
    });
    mocks.jobs.mockResolvedValue([
      notificationJob('sender'),
      notificationJob('receiver'),
    ]);
    mocks.eligibility.mockResolvedValueOnce('all').mockResolvedValueOnce('some');
    const selectors = {
      txid: 'c'.repeat(64),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    };

    const result = await readIncidentEvidence(selectors);

    expect(result.roles).toHaveLength(2);
    expect(result.roles[0]).toMatchObject({
      role: 'sender',
      receiverMatch: {
        ownsSelectedOutput: 'not_applicable',
        networkMatches: 'not_applicable',
        addressTiming: 'not_applicable',
      },
      eligibility: { evidenceSource: 'current_snapshot', coverage: 'all' },
    });
    expect(result.roles[1]).toMatchObject({
      role: 'receiver',
      receiverMatch: {
        ownsSelectedOutput: 'observed_true',
        networkMatches: 'observed_true',
        addressTiming: 'within_window',
      },
      eligibility: { evidenceSource: 'current_snapshot', coverage: 'some' },
    });
    expect(JSON.stringify(result)).not.toContain(selectors.txid);
    expect(JSON.stringify(result)).not.toContain(selectors.senderWalletId);
    expect(JSON.stringify(result)).not.toContain(selectors.receiverWalletId);
  });

  it('keeps eligibility explicitly unknown when the exact current query fails', async () => {
    mocks.transactions.mockResolvedValue({
      roles: [
        { role: 'sender', expectedDirection: 'sent', lookupStatus: 'unavailable', transactionRow: { present: 'not_observed', directionMatches: 'not_observed', timing: 'unknown' } },
        { role: 'receiver', expectedDirection: 'received', lookupStatus: 'unavailable', transactionRow: { present: 'not_observed', directionMatches: 'not_observed', timing: 'unknown' } },
      ],
      receiverMatch: { ownsSelectedOutput: 'not_observed', networkMatches: 'not_observed', addressTiming: 'unknown' },
    });
    const missingJob = (role: 'sender' | 'receiver') => ({
      role,
      expectedDirection: role === 'sender' ? 'sent' : 'received',
      lookupStatus: 'unavailable',
      present: 'not_observed',
      state: 'not_observed',
      attempts: 'unknown',
      enqueue: 'not_observed',
      handler: 'not_observed',
      terminal: 'not_observed',
      telegram: { outcome: 'not_observed', failureClass: 'not_observed' },
      ages: { created: 'not_observed', processed: 'not_observed', finished: 'not_observed' },
      retention: { record: 'not_observed', horizon: 'unsupported', saturation: 'unknown' },
    });
    mocks.jobs.mockResolvedValue([missingJob('sender'), missingJob('receiver')]);
    mocks.eligibility.mockRejectedValue(new Error('private selector query failed'));

    const result = await readIncidentEvidence({
      txid: 'd'.repeat(64),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(result.roles.map(role => role.eligibility)).toEqual([
      { evidenceSource: 'not_observed', coverage: 'unknown' },
      { evidenceSource: 'not_observed', coverage: 'unknown' },
    ]);
  });
});
