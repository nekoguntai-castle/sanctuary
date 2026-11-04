import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    transitionAlertStatus: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  userRepository: {},
  walletRepository: {},
  AGENT_ALERT_TRANSITION_TARGETS: { acknowledge: 'acknowledged', resolve: 'resolved' },
}));

import { acknowledgeAgentAlert, resolveAgentAlert } from '../../../src/services/adminAgentService';
import { ConflictError, NotFoundError } from '../../../src/errors';

const alert = (status: string) => ({ id: 'alert-1', agentId: 'agent-1', status });

describe('adminAgentService alert transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acknowledges an open alert', async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: alert('acknowledged'), changed: true });

    await expect(acknowledgeAgentAlert('agent-1', 'alert-1')).resolves.toEqual({
      alert: alert('acknowledged'),
      alreadyInTargetStatus: false,
    });
    expect(mocks.agentRepository.transitionAlertStatus).toHaveBeenCalledWith('agent-1', 'alert-1', 'acknowledge');
  });

  it('resolves an alert', async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: alert('resolved'), changed: true });

    await expect(resolveAgentAlert('agent-1', 'alert-1')).resolves.toEqual({
      alert: alert('resolved'),
      alreadyInTargetStatus: false,
    });
    expect(mocks.agentRepository.transitionAlertStatus).toHaveBeenCalledWith('agent-1', 'alert-1', 'resolve');
  });

  it('treats a lost compare-and-set already in the target status as idempotent', async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: alert('acknowledged'), changed: false });
    await expect(acknowledgeAgentAlert('agent-1', 'alert-1')).resolves.toEqual({
      alert: alert('acknowledged'),
      alreadyInTargetStatus: true,
    });

    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: alert('resolved'), changed: false });
    await expect(resolveAgentAlert('agent-1', 'alert-1')).resolves.toEqual({
      alert: alert('resolved'),
      alreadyInTargetStatus: true,
    });
  });

  it('rejects acknowledging a resolved alert as a conflict', async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: alert('resolved'), changed: false });

    await expect(acknowledgeAgentAlert('agent-1', 'alert-1')).rejects.toThrow(ConflictError);
  });

  it('reports an alert that does not belong to the agent as not found', async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValue({ alert: null, changed: false });

    await expect(resolveAgentAlert('agent-2', 'alert-1')).rejects.toThrow(NotFoundError);
  });
});
