import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadIncidentEvidence = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/supportPackage/incident', () => ({
  readIncidentEvidence: (...args: unknown[]) => mockReadIncidentEvidence(...args),
}));

import { generateSerializedIncidentProfile } from '../../../../src/services/supportPackage/incidentProfile';

function role(role: 'sender' | 'receiver') {
  const sender = role === 'sender';
  return {
    role,
    expectedDirection: sender ? 'sent' : 'received',
    transaction: {
      role,
      expectedDirection: sender ? 'sent' : 'received',
      lookupStatus: 'observed',
      transactionRow: {
        present: 'observed_true',
        directionMatches: 'observed_true',
        timing: 'within_window',
      },
    },
    notificationJob: {
      role,
      expectedDirection: sender ? 'sent' : 'received',
      lookupStatus: 'observed',
      present: 'observed_true',
      state: 'completed',
      attempts: 'one',
      enqueue: 'resolved',
      handler: 'started',
      terminal: 'completed',
      telegram: { outcome: 'accepted', failureClass: 'none' },
      ages: {
        created: 'one_to_five_minutes',
        processed: 'one_to_five_minutes',
        finished: 'one_to_five_minutes',
      },
      retention: { record: 'retained', horizon: 'unsupported', saturation: 'unknown' },
    },
    receiverMatch: sender
      ? { ownsSelectedOutput: 'not_applicable', networkMatches: 'not_applicable', addressTiming: 'not_applicable' }
      : { ownsSelectedOutput: 'observed_true', networkMatches: 'observed_true', addressTiming: 'within_window' },
    eligibility: { evidenceSource: 'current_snapshot', coverage: 'all' },
  };
}

describe('incident profile serialization', () => {
  beforeEach(() => {
    mockReadIncidentEvidence.mockReset();
    mockReadIncidentEvidence.mockResolvedValue({ roles: [role('sender'), role('receiver')] });
  });

  it('returns strict categorical bytes with no selector or correlation handle', async () => {
    const selectors = {
      txid: 'ab'.repeat(32),
      senderWalletId: 'sender-wallet-private',
      receiverWalletId: 'receiver-wallet-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    };

    const bytes = await generateSerializedIncidentProfile(selectors);
    const text = bytes.toString('utf8');
    const parsed = JSON.parse(text);

    expect(parsed).toMatchObject({
      version: '1.0.0',
      profile: 'single_incident',
      collectors: {
        incident: {
          status: 'ok',
          data: {
            sender: { role: 'sender', expectedDirection: 'sent' },
            receiver: { role: 'receiver', expectedDirection: 'received' },
            captureCoverage: 'not_observed',
          },
        },
      },
      meta: { privacyValidation: 'passed' },
    });
    for (const selector of [selectors.txid, selectors.senderWalletId, selectors.receiverWalletId]) {
      expect(text).not.toContain(selector);
      expect(text).not.toContain(Buffer.from(selector).toString('base64'));
      expect(text).not.toContain(createHash('sha256').update(selector).digest('hex'));
    }
    expect(text.indexOf('"collectors"')).toBeLessThan(text.indexOf('"generatedAt"'));
  });

  it('marks a missing exact retained job as not_retained without guessing outcomes', async () => {
    const receiver = role('receiver');
    receiver.notificationJob.present = 'not_observed';
    receiver.notificationJob.lookupStatus = 'observed';
    receiver.notificationJob.state = 'not_observed';
    receiver.notificationJob.enqueue = 'not_observed';
    receiver.notificationJob.handler = 'not_observed';
    receiver.notificationJob.terminal = 'not_observed';
    receiver.notificationJob.telegram = { outcome: 'not_observed', failureClass: 'not_observed' };
    receiver.notificationJob.retention.record = 'not_retained';
    mockReadIncidentEvidence.mockResolvedValue({ roles: [role('sender'), receiver] });

    const bytes = await generateSerializedIncidentProfile({
      txid: 'cd'.repeat(32),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    });
    const notificationJob = JSON.parse(bytes.toString('utf8'))
      .collectors.incident.data.receiver.notificationJob;

    expect(notificationJob).toMatchObject({
      presence: 'not_retained',
      enqueue: 'not_observed',
      handler: 'not_observed',
      terminal: 'not_observed',
      telegram: { outcome: 'not_observed', failureClass: 'not_observed' },
    });
  });

  it('overlays categorical controlled-capture evidence without serializing session metadata', async () => {
    const capture = {
      status: { state: 'ready' as const, expiresIn: '10_to_15_minutes' as const },
      evidence: [{
        session: { sessionId: 'internal-session-id', generation: 7 },
        roles: {
          sender: [
            { stage: 'enqueue' as const, outcome: 'rejected' as const, failureClass: 'queue_add_failed' as const, path: 'queued' as const },
            { stage: 'handler' as const, outcome: 'not_observed' as const },
            {
              stage: 'terminal' as const,
              path: 'inline' as const,
              outcome: 'accepted' as const,
              failureClass: 'none' as const,
              telegramOutcome: 'accepted' as const,
              telegramFailureClass: 'none' as const,
              terminalState: 'completed' as const,
            },
          ],
          receiver: [
            { stage: 'enqueue' as const, outcome: 'accepted' as const, failureClass: 'none' as const, path: 'queued' as const },
            { stage: 'handler' as const, outcome: 'started' as const },
            { stage: 'terminal' as const, outcome: 'not_observed' as const },
          ],
        },
      }],
    };

    const bytes = await generateSerializedIncidentProfile({
      txid: '12'.repeat(32),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    }, capture);
    const text = bytes.toString('utf8');
    const data = JSON.parse(text).collectors.incident.data;

    expect(data.captureCoverage).toBe('complete');
    expect(data.sender.notificationJob).toMatchObject({
      enqueue: 'failed',
      terminal: 'completed',
      telegram: { outcome: 'accepted', failureClass: 'none' },
    });
    expect(data.receiver.notificationJob).toMatchObject({ enqueue: 'resolved', handler: 'started' });
    expect(text).not.toContain('internal-session-id');
    expect(text).not.toContain('generation');
  });

  it('fails closed when evidence does not satisfy the strict public schema', async () => {
    const sender = role('sender');
    sender.notificationJob.state = 'private-provider-error' as typeof sender.notificationJob.state;
    mockReadIncidentEvidence.mockResolvedValue({ roles: [sender, role('receiver')] });

    await expect(generateSerializedIncidentProfile({
      txid: 'ef'.repeat(32),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    })).rejects.toThrow('incident_profile_contract_failed');
  });

  it.each([
    ['invalid', 'invalid'],
    ['partial', 'partial'],
  ] as const)('reports %s controlled-capture coverage categorically', async (state, expected) => {
    const sender = role('sender');
    sender.notificationJob.present = 'not_observed';
    sender.notificationJob.retention.record = 'not_observed';
    mockReadIncidentEvidence.mockResolvedValue({ roles: [sender, role('receiver')] });
    const bytes = await generateSerializedIncidentProfile({
      txid: '34'.repeat(32),
      senderWalletId: 'sender-private',
      receiverWalletId: 'receiver-private',
      approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
    }, { status: { state } });
    const data = JSON.parse(bytes.toString('utf8')).collectors.incident.data;
    expect(data.captureCoverage).toBe(expected);
    expect(data.sender.notificationJob.presence).toBe('not_observed');
  });
});
