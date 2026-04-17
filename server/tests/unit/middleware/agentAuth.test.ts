import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../../../src/errors/ApiError';

const mockAuthenticateAgentRequest = vi.hoisted(() => vi.fn());

vi.mock('../../../src/agent/auth', () => ({
  authenticateAgentRequest: mockAuthenticateAgentRequest,
}));

import { authenticateAgent, requireAgentContext } from '../../../src/middleware/agentAuth';

describe('agent auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the authenticated agent context and advances the middleware chain', async () => {
    const context = {
      agentId: 'agent-1',
      agentName: 'Treasury Agent',
      fundingWalletId: 'wallet-1',
      operationalWalletId: 'wallet-2',
    };
    const req = {} as any;
    const next = vi.fn();
    mockAuthenticateAgentRequest.mockResolvedValueOnce(context);

    await authenticateAgent(req, {} as any, next);

    expect(req.agentContext).toBe(context);
    expect(next).toHaveBeenCalledWith();
    expect(requireAgentContext(req)).toBe(context);
  });

  it('passes authentication failures to Express and rejects missing contexts', async () => {
    const error = new UnauthorizedError('bad agent token');
    const next = vi.fn();
    mockAuthenticateAgentRequest.mockRejectedValueOnce(error);

    await authenticateAgent({} as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(() => requireAgentContext({} as any)).toThrow(UnauthorizedError);
  });
});
