import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentRepository,
  prisma,
  resetAgentRepositoryMocks,
} from './agentRepository.testHarness';

const NOW = new Date('2026-11-03T00:00:00.000Z');

describe('agentRepository alert status transitions', () => {
  beforeEach(() => {
    resetAgentRepositoryMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acknowledges only an open alert of the same agent and re-reads the row', async () => {
    prisma.agentAlert.updateMany.mockResolvedValue({ count: 1 });
    const stored = { id: 'alert-1', agentId: 'agent-1', status: 'acknowledged' };
    prisma.agentAlert.findFirst.mockResolvedValue(stored);

    const result = await agentRepository.transitionAlertStatus('agent-1', 'alert-1', 'acknowledge');

    expect(prisma.agentAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'alert-1', agentId: 'agent-1', status: { in: ['open'] } },
      data: { status: 'acknowledged', acknowledgedAt: NOW },
    });
    expect(prisma.agentAlert.findFirst).toHaveBeenCalledWith({
      where: { id: 'alert-1', agentId: 'agent-1' },
    });
    expect(result).toEqual({ alert: stored, changed: true });
  });

  it('resolves an open or acknowledged alert and leaves acknowledgedAt untouched', async () => {
    prisma.agentAlert.updateMany.mockResolvedValue({ count: 1 });
    const stored = { id: 'alert-1', agentId: 'agent-1', status: 'resolved' };
    prisma.agentAlert.findFirst.mockResolvedValue(stored);

    const result = await agentRepository.transitionAlertStatus('agent-1', 'alert-1', 'resolve');

    expect(prisma.agentAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'alert-1', agentId: 'agent-1', status: { in: ['open', 'acknowledged'] } },
      data: { status: 'resolved', resolvedAt: NOW },
    });
    expect(result).toEqual({ alert: stored, changed: true });
  });

  it('reports a lost compare-and-set without changing the row', async () => {
    prisma.agentAlert.updateMany.mockResolvedValue({ count: 0 });
    const stored = { id: 'alert-1', agentId: 'agent-1', status: 'resolved' };
    prisma.agentAlert.findFirst.mockResolvedValue(stored);

    await expect(
      agentRepository.transitionAlertStatus('agent-1', 'alert-1', 'acknowledge'),
    ).resolves.toEqual({ alert: stored, changed: false });
  });

  it('returns a null alert when no row belongs to the agent', async () => {
    prisma.agentAlert.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentAlert.findFirst.mockResolvedValue(null);

    await expect(
      agentRepository.agentRepository.transitionAlertStatus('agent-2', 'alert-1', 'resolve'),
    ).resolves.toEqual({ alert: null, changed: false });
  });

  it('exposes the target status of each transition', () => {
    expect(agentRepository.AGENT_ALERT_TRANSITION_TARGETS).toEqual({
      acknowledge: 'acknowledged',
      resolve: 'resolved',
    });
  });
});
