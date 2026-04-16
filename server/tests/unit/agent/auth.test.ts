import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findApiKeyByHash: vi.fn(),
    updateApiKeyLastUsedIfStale: vi.fn(),
  },
  getClientInfo: vi.fn(),
}));

vi.mock('../../../src/repositories/agentRepository', () => ({
  AGENT_ACTION_CREATE_FUNDING_DRAFT: 'create_funding_draft',
  agentRepository: mocks.agentRepository,
}));

vi.mock('../../../src/services/auditService', () => ({
  getClientInfo: mocks.getClientInfo,
}));

import {
  authenticateAgentRequest,
  buildAgentKeyScope,
  extractBearerToken,
  generateAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
  parseAgentKeyScope,
  requireAgentFundingDraftAccess,
  validateAgentApiKeyFormat,
  type AgentRequestContext,
} from '../../../src/agent/auth';
import { ForbiddenError, UnauthorizedError } from '../../../src/errors/ApiError';

function reqWithAuth(authorization?: string): Request {
  return {
    headers: { authorization },
  } as Request;
}

describe('agent auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientInfo.mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'agent-runtime' });
  });

  it('generates, prefixes, hashes, and validates agent API keys', () => {
    const key = generateAgentApiKey();

    expect(key).toMatch(/^agt_[a-f0-9]{64}$/);
    expect(getAgentApiKeyPrefix(key)).toBe(key.slice(0, 16));
    expect(hashAgentApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(validateAgentApiKeyFormat(key)).toBe(true);
    expect(validateAgentApiKeyFormat('mcp_' + 'a'.repeat(64))).toBe(false);
  });

  it('extracts a single bearer token only', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Bearer token')).toBe('token');
    expect(extractBearerToken('bearer token')).toBe('token');
    expect(extractBearerToken('Basic token')).toBeNull();
    expect(extractBearerToken('Bearer token extra')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
  });

  it('builds and parses scopes defensively', () => {
    expect(buildAgentKeyScope()).toEqual({ allowedActions: ['create_funding_draft'] });
    expect(buildAgentKeyScope({ allowedActions: ['create_funding_draft', 'create_funding_draft'] })).toEqual({
      allowedActions: ['create_funding_draft'],
    });
    expect(parseAgentKeyScope(null)).toEqual({ allowedActions: ['create_funding_draft'] });
    expect(parseAgentKeyScope(['not-object'])).toEqual({ allowedActions: ['create_funding_draft'] });
    expect(parseAgentKeyScope({ allowedActions: ['create_funding_draft', 42] })).toEqual({
      allowedActions: ['create_funding_draft'],
    });
  });

  it('rejects missing, malformed, unknown, revoked, and expired keys', async () => {
    await expect(authenticateAgentRequest(reqWithAuth())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(authenticateAgentRequest(reqWithAuth('Bearer bad'))).rejects.toBeInstanceOf(UnauthorizedError);

    const apiKey = 'agt_' + 'a'.repeat(64);
    mocks.agentRepository.findApiKeyByHash.mockResolvedValueOnce(null);
    await expect(authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('Invalid agent API key');

    mocks.agentRepository.findApiKeyByHash.mockResolvedValueOnce({ keyHash: 'b'.repeat(64) });
    await expect(authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('Invalid agent API key');

    const keyHash = hashAgentApiKey(apiKey);
    mocks.agentRepository.findApiKeyByHash.mockResolvedValueOnce({ keyHash, revokedAt: new Date() });
    await expect(authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('revoked');

    mocks.agentRepository.findApiKeyByHash.mockResolvedValueOnce({
      keyHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('expired');
  });

  it('authenticates active keys and throttles last-used updates', async () => {
    const apiKey = 'agt_' + 'c'.repeat(64);
    const keyHash = hashAgentApiKey(apiKey);
    mocks.agentRepository.findApiKeyByHash.mockResolvedValue({
      id: 'key-1',
      keyPrefix: 'agt_ccccccccccc',
      keyHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      scope: { allowedActions: ['create_funding_draft'] },
      agent: {
        id: 'agent-1',
        name: 'Treasury Agent',
        status: 'active',
        revokedAt: null,
        userId: 'user-1',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'agent-device',
        user: { id: 'user-1', username: 'alice', isAdmin: false },
      },
    });

    const result = await authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`));

    expect(result).toMatchObject({
      keyId: 'key-1',
      keyPrefix: 'agt_ccccccccccc',
      userId: 'user-1',
      username: 'alice',
      agentId: 'agent-1',
      agentName: 'Treasury Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      scope: { allowedActions: ['create_funding_draft'] },
    });
    expect(mocks.agentRepository.updateApiKeyLastUsedIfStale).toHaveBeenCalledWith(
      'key-1',
      expect.any(Date),
      { lastUsedIp: '127.0.0.1', lastUsedAgent: 'agent-runtime' }
    );
  });

  it('rejects inactive agents and unscoped funding draft requests', async () => {
    const context: AgentRequestContext = {
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      userId: 'user-1',
      username: 'alice',
      agentId: 'agent-1',
      agentName: 'Treasury Agent',
      agentStatus: 'active',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      scope: { allowedActions: ['create_funding_draft'] },
    };

    expect(() => requireAgentFundingDraftAccess(context, 'funding-wallet', 'operational-wallet')).not.toThrow();
    expect(() => requireAgentFundingDraftAccess(context, 'other-wallet', 'operational-wallet')).toThrow(ForbiddenError);
    expect(() => requireAgentFundingDraftAccess(context, 'funding-wallet', 'other-operational-wallet')).toThrow(ForbiddenError);
    expect(() => requireAgentFundingDraftAccess({
      ...context,
      scope: { allowedActions: [] },
    }, 'funding-wallet', 'operational-wallet')).toThrow(ForbiddenError);

    const apiKey = 'agt_' + 'd'.repeat(64);
    mocks.agentRepository.findApiKeyByHash.mockResolvedValueOnce({
      id: 'key-2',
      keyPrefix: 'agt_ddddddddddd',
      keyHash: hashAgentApiKey(apiKey),
      revokedAt: null,
      expiresAt: null,
      agent: {
        ...context,
        id: context.agentId,
        name: context.agentName,
        status: 'paused',
        revokedAt: null,
        user: { id: 'user-1', username: 'alice', isAdmin: false },
      },
    });

    await expect(authenticateAgentRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow(ForbiddenError);
  });
});
