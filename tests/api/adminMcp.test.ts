import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import {
  createMcpApiKey,
  getMcpServerStatus,
  listMcpApiKeys,
  revokeMcpApiKey,
} from '../../src/api/admin/mcp';

describe('Admin MCP API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls MCP access endpoints', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await getMcpServerStatus();
    await listMcpApiKeys();
    await createMcpApiKey({
      userId: 'user-1',
      name: 'LAN model',
      walletIds: ['wallet-1'],
      allowAuditLogs: true,
      expiresAt: '2026-05-01T00:00:00.000Z',
    });
    await revokeMcpApiKey('key/1');

    expect(mockGet).toHaveBeenCalledWith('/admin/mcp-keys/status');
    expect(mockGet).toHaveBeenCalledWith('/admin/mcp-keys');
    expect(mockPost).toHaveBeenCalledWith('/admin/mcp-keys', {
      userId: 'user-1',
      name: 'LAN model',
      walletIds: ['wallet-1'],
      allowAuditLogs: true,
      expiresAt: '2026-05-01T00:00:00.000Z',
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/mcp-keys/key%2F1');
  });
});
