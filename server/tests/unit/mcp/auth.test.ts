import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mcpApiKeyRepository: {
    findByKeyHash: vi.fn(),
    updateLastUsedIfStale: vi.fn(),
  },
  walletRepository: {
    hasAccess: vi.fn(),
  },
  requireWalletAccess: vi.fn(),
  getClientInfo: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  mcpApiKeyRepository: mocks.mcpApiKeyRepository,
  walletRepository: mocks.walletRepository,
}));

vi.mock('../../../src/services/accessControl', () => ({
  requireWalletAccess: mocks.requireWalletAccess,
}));

vi.mock('../../../src/services/auditService', () => ({
  getClientInfo: mocks.getClientInfo,
}));

import {
  authenticateMcpRequest,
  buildMcpKeyScope,
  extractBearerToken,
  generateMcpApiKey,
  getMcpApiKeyPrefix,
  hashMcpApiKey,
  parseMcpKeyScope,
  requireMcpAuditAccess,
  requireMcpWalletAccess,
  validateMcpApiKeyFormat,
  validateMcpScopeWallets,
} from '../../../src/mcp/auth';
import { McpForbiddenError, McpUnauthorizedError, type McpRequestContext } from '../../../src/mcp/types';

function reqWithAuth(authorization?: string): Request {
  return {
    headers: { authorization },
  } as Request;
}

describe('MCP auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientInfo.mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'agent' });
  });

  it('generates, prefixes, hashes, and validates MCP API keys', () => {
    const key = generateMcpApiKey();

    expect(key).toMatch(/^mcp_[a-f0-9]{64}$/);
    expect(getMcpApiKeyPrefix(key)).toBe(key.slice(0, 16));
    expect(hashMcpApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(validateMcpApiKeyFormat(key)).toBe(true);
    expect(validateMcpApiKeyFormat('mcp_not-hex')).toBe(false);
  });

  it('extracts a single bearer token only', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Bearer token')).toBe('token');
    expect(extractBearerToken('bearer token')).toBe('token');
    expect(extractBearerToken('Basic token')).toBeNull();
    expect(extractBearerToken('Bearer token extra')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
  });

  it('builds and parses key scopes defensively', () => {
    expect(buildMcpKeyScope({ walletIds: ['w1', 'w1', 'w2'], allowAuditLogs: true })).toEqual({
      walletIds: ['w1', 'w2'],
      allowAuditLogs: true,
    });
    expect(buildMcpKeyScope({ walletIds: [], allowAuditLogs: false })).toEqual({ allowAuditLogs: false });
    expect(parseMcpKeyScope(null)).toEqual({});
    expect(parseMcpKeyScope(['not-object'])).toEqual({});
    expect(parseMcpKeyScope({ walletIds: ['w1', 42, 'w2'], allowAuditLogs: true })).toEqual({
      walletIds: ['w1', 'w2'],
      allowAuditLogs: true,
    });
  });

  it('rejects missing, malformed, unknown, revoked, and expired keys', async () => {
    await expect(authenticateMcpRequest(reqWithAuth())).rejects.toBeInstanceOf(McpUnauthorizedError);
    await expect(authenticateMcpRequest(reqWithAuth('Bearer bad'))).rejects.toBeInstanceOf(McpUnauthorizedError);

    const apiKey = 'mcp_' + 'a'.repeat(64);
    mocks.mcpApiKeyRepository.findByKeyHash.mockResolvedValueOnce(null);
    await expect(authenticateMcpRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('Invalid MCP API key');

    mocks.mcpApiKeyRepository.findByKeyHash.mockResolvedValueOnce({ keyHash: 'b'.repeat(64) });
    await expect(authenticateMcpRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('Invalid MCP API key');

    const keyHash = hashMcpApiKey(apiKey);
    mocks.mcpApiKeyRepository.findByKeyHash.mockResolvedValueOnce({ keyHash, revokedAt: new Date() });
    await expect(authenticateMcpRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('revoked');

    mocks.mcpApiKeyRepository.findByKeyHash.mockResolvedValueOnce({
      keyHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(authenticateMcpRequest(reqWithAuth(`Bearer ${apiKey}`))).rejects.toThrow('expired');
  });

  it('authenticates active keys and throttles last-used updates', async () => {
    const apiKey = 'mcp_' + 'c'.repeat(64);
    const keyHash = hashMcpApiKey(apiKey);
    mocks.mcpApiKeyRepository.findByKeyHash.mockResolvedValue({
      id: 'key-1',
      keyPrefix: 'mcp_ccccccccccc',
      keyHash,
      userId: 'user-1',
      user: { username: 'alice', isAdmin: true },
      scope: { walletIds: ['wallet-1'], allowAuditLogs: true },
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await authenticateMcpRequest(reqWithAuth(`Bearer ${apiKey}`));

    expect(result).toMatchObject({
      keyId: 'key-1',
      keyPrefix: 'mcp_ccccccccccc',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
      scope: { walletIds: ['wallet-1'], allowAuditLogs: true },
    });
    expect(mocks.mcpApiKeyRepository.updateLastUsedIfStale).toHaveBeenCalledWith(
      'key-1',
      expect.any(Date),
      { lastUsedIp: '127.0.0.1', lastUsedAgent: 'agent' }
    );
  });

  it('validates wallet scope with de-duplicated wallet ids', async () => {
    mocks.walletRepository.hasAccess.mockResolvedValue(true);

    await validateMcpScopeWallets('user-1', ['wallet-1', 'wallet-1', 'wallet-2']);

    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledTimes(2);
    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledWith('wallet-2', 'user-1');
  });

  it('rejects wallet scope when access is missing', async () => {
    mocks.walletRepository.hasAccess.mockResolvedValue(false);

    await expect(validateMcpScopeWallets('user-1', ['wallet-1'])).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it('requires wallet and audit access from the MCP context', async () => {
    const context: McpRequestContext = {
      keyId: 'key-1',
      keyPrefix: 'mcp_prefix',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
      scope: { walletIds: ['wallet-1'], allowAuditLogs: true },
    };

    await requireMcpWalletAccess('wallet-1', context);
    expect(mocks.requireWalletAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(() => requireMcpAuditAccess(context)).not.toThrow();

    await expect(requireMcpWalletAccess('wallet-2', context)).rejects.toThrow('not scoped');
    expect(() => requireMcpAuditAccess({ ...context, isAdmin: false })).toThrow(McpForbiddenError);
    expect(() => requireMcpAuditAccess({ ...context, scope: { allowAuditLogs: false } })).toThrow(McpForbiddenError);
  });
});
