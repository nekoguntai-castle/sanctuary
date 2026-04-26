import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assistantReadRepository: {
    queryTransactions: vi.fn(),
    queryUtxos: vi.fn(),
    searchAddresses: vi.fn(),
    countDrafts: vi.fn(),
    aggregateFees: vi.fn(),
    getLatestFeeEstimate: vi.fn(),
    getLatestPrice: vi.fn(),
  },
  walletRepository: { findByIdWithAccess: vi.fn() },
  utxoRepository: { aggregateUnspent: vi.fn(), countByWalletId: vi.fn() },
  transactionRepository: {
    countByWalletId: vi.fn(),
    groupByType: vi.fn(),
    getBucketedBalanceDeltas: vi.fn(),
  },
  policyRepository: { findAllPoliciesForWallet: vi.fn() },
  intelligenceRepository: {
    countActiveInsights: vi.fn(),
    getTransactionVelocity: vi.fn(),
    getUtxoAgeDistribution: vi.fn(),
  },
  draftRepository: { findByWalletId: vi.fn() },
  requireMcpWalletAccess: vi.fn(),
  requireMcpAuditAccess: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  assistantReadRepository: mocks.assistantReadRepository,
  walletRepository: mocks.walletRepository,
  utxoRepository: mocks.utxoRepository,
  transactionRepository: mocks.transactionRepository,
  policyRepository: mocks.policyRepository,
  intelligenceRepository: mocks.intelligenceRepository,
  draftRepository: mocks.draftRepository,
}));

vi.mock('../../../src/mcp/auth', () => ({
  requireMcpWalletAccess: mocks.requireMcpWalletAccess,
  requireMcpAuditAccess: mocks.requireMcpAuditAccess,
}));

import { registerMcpTools } from '../../../src/mcp/tools';
import type { McpHandlerExtra, McpRequestContext } from '../../../src/mcp/types';

const walletId = '11111111-1111-4111-8111-111111111111';

type RegisteredTool = {
  config: Record<string, unknown>;
  handler: (args: unknown, extra: McpHandlerExtra) => Promise<unknown>;
};

function createServer() {
  const registered = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: RegisteredTool['handler']) => {
      registered.set(name, { config, handler });
    }),
  } as unknown as McpServer;
  return { server, registered };
}

function extraWithContext(context: McpRequestContext): McpHandlerExtra {
  return {
    authInfo: {
      extra: { mcp: context },
    },
  } as McpHandlerExtra;
}

describe('MCP read-tool adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMcpWalletAccess.mockResolvedValue(undefined);
  });

  it('registers shared assistant read tools with read-only MCP annotations', () => {
    const { server, registered } = createServer();

    registerMcpTools(server);

    expect(registered.has('query_transactions')).toBe(true);
    expect(registered.has('convert_price')).toBe(true);
    expect(registered.get('query_transactions')?.config).toMatchObject({
      title: 'Query Transactions',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
  });

  it('executes a shared read tool and preserves top-level MCP data with envelope metadata', async () => {
    const { server, registered } = createServer();
    registerMcpTools(server);
    mocks.assistantReadRepository.queryTransactions.mockResolvedValue([]);

    const result = await registered.get('query_transactions')?.handler(
      { walletId, limit: 1 },
      extraWithContext({
        keyId: 'key-1',
        keyPrefix: 'mcp_prefix',
        userId: 'user-1',
        username: 'alice',
        isAdmin: false,
        scope: { walletIds: [walletId] },
      })
    );

    expect(mocks.requireMcpWalletAccess).toHaveBeenCalledWith(walletId, expect.objectContaining({ keyId: 'key-1' }));
    expect(result).toMatchObject({
      structuredContent: {
        walletId,
        count: 0,
        transactions: [],
        _sanctuary: {
          facts: { summary: 'Found 0 transactions.' },
          sensitivity: 'wallet',
          truncation: { truncated: false },
          audit: {
            operation: 'query_transactions',
            source: 'mcp',
          },
        },
      },
      content: [{ type: 'text', text: 'Found 0 transactions.' }],
    });
  });

  it('maps shared registry validation errors to MCP HTTP errors', async () => {
    const { server, registered } = createServer();
    registerMcpTools(server);

    await expect(
      registered.get('query_transactions')?.handler(
        { walletId: 'not-a-uuid' },
        extraWithContext({
          keyId: 'key-1',
          keyPrefix: 'mcp_prefix',
          userId: 'user-1',
          username: 'alice',
          isAdmin: false,
          scope: {},
        })
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mocks.requireMcpWalletAccess).not.toHaveBeenCalled();
  });
});
