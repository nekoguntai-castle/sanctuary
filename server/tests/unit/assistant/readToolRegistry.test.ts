import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assistantReadRepository: {
    getDashboardSummary: vi.fn(),
    findWalletDetailSummary: vi.fn(),
    getTransactionStats: vi.fn(),
    findPendingTransactions: vi.fn(),
    findWalletTransactionDetail: vi.fn(),
    getUtxoSummary: vi.fn(),
    getAddressSummary: vi.fn(),
    findAddressDetail: vi.fn(),
    queryTransactions: vi.fn(),
    queryUtxos: vi.fn(),
    searchAddresses: vi.fn(),
    countDrafts: vi.fn(),
    aggregateFees: vi.fn(),
    getLatestFeeEstimate: vi.fn(),
    getLatestPrice: vi.fn(),
  },
  walletRepository: {
    findByIdWithAccess: vi.fn(),
  },
  utxoRepository: {
    aggregateUnspent: vi.fn(),
    countByWalletId: vi.fn(),
  },
  transactionRepository: {
    countByWalletId: vi.fn(),
    groupByType: vi.fn(),
    getBucketedBalanceDeltas: vi.fn(),
  },
  policyRepository: {
    findAllPoliciesForWallet: vi.fn(),
  },
  intelligenceRepository: {
    countActiveInsights: vi.fn(),
    getTransactionVelocity: vi.fn(),
    getUtxoAgeDistribution: vi.fn(),
  },
  draftRepository: {
    findByWalletId: vi.fn(),
  },
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

import {
  AssistantToolError,
  AssistantReadToolRegistry,
  assistantReadToolRegistry,
  type AssistantToolContext,
} from '../../../src/assistant/tools';

const walletId = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';

function createContext(): AssistantToolContext & {
  authorizeWalletAccess: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'test',
    actor: { userId, username: 'alice', isAdmin: false },
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function transactionRow(id: string) {
  return {
    id,
    txid: `tx-${id}`,
    walletId,
    type: 'received',
    amount: BigInt(1000),
    fee: BigInt(10),
    balanceAfter: BigInt(1000),
    confirmations: 3,
    blockHeight: 840000,
    blockTime: new Date('2026-04-26T00:00:00.000Z'),
    transactionLabels: [],
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

describe('assistant read-tool registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes stable read-tool metadata for adapters', () => {
    const tools = assistantReadToolRegistry.list();

    expect(tools.map(tool => tool.name)).toEqual([
      'get_dashboard_summary',
      'query_transactions',
      'query_utxos',
      'search_addresses',
      'get_wallet_overview',
      'get_wallet_detail_summary',
      'get_transaction_stats',
      'get_pending_transactions',
      'get_transaction_detail',
      'get_utxo_summary',
      'get_address_summary',
      'get_address_detail',
      'get_wallet_analytics',
      'get_balance_history',
      'get_draft_statuses',
      'get_fee_estimates',
      'convert_price',
    ]);
    expect(tools.every(tool => tool.budgets.maxBytes && tool.requiredScope.description)).toBe(true);
    expect(assistantReadToolRegistry.get('search_addresses')).toMatchObject({
      sensitivity: 'high',
      requiredScope: { kind: 'wallet' },
    });
  });

  it('rejects invalid input before wallet authorization or repository calls', async () => {
    const context = createContext();

    await expect(
      assistantReadToolRegistry.execute('get_wallet_overview', { walletId: 'not-a-uuid' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
    expect(mocks.walletRepository.findByIdWithAccess).not.toHaveBeenCalled();
  });

  it('rejects duplicate and unknown tool registrations', async () => {
    const tool = assistantReadToolRegistry.get('query_transactions');
    expect(tool).not.toBeNull();

    const registry = new AssistantReadToolRegistry([tool!]);
    expect(() => registry.register(tool!)).toThrow('Duplicate assistant read tool');
    await expect(registry.execute('missing_tool', {}, createContext())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('defaults null raw input to an empty tool input object', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getLatestFeeEstimate.mockResolvedValue(null);

    const envelope = await assistantReadToolRegistry.execute('get_fee_estimates', null, context);

    expect(envelope.data.fees).toMatchObject({ available: false, stale: true });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('returns an envelope for empty transaction results', async () => {
    const context = createContext();
    mocks.assistantReadRepository.queryTransactions.mockResolvedValue([]);

    const envelope = await assistantReadToolRegistry.execute(
      'query_transactions',
      { walletId, limit: 5 },
      context
    );

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
    expect(envelope).toMatchObject({
      data: { walletId, count: 0, transactions: [] },
      facts: { summary: 'Found 0 transactions.' },
      sensitivity: 'wallet',
      truncation: { truncated: false },
      audit: {
        operation: 'query_transactions',
        source: 'test',
        walletCount: 1,
        rowCount: 0,
      },
    });
    expect(envelope.audit.durationMs).toEqual(expect.any(Number));
    expect(envelope.audit).not.toHaveProperty('actorId');
  });

  it('fetches one extra row and reports row-limit truncation', async () => {
    const context = createContext();
    mocks.assistantReadRepository.queryTransactions.mockResolvedValue([
      transactionRow('1'),
      transactionRow('2'),
      transactionRow('3'),
    ]);

    const envelope = await assistantReadToolRegistry.execute(
      'query_transactions',
      { walletId, limit: 2 },
      context
    );

    expect(mocks.assistantReadRepository.queryTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ walletId }),
      3
    );
    expect(envelope.data.count).toBe(2);
    expect(envelope.truncation).toMatchObject({
      truncated: true,
      reason: 'row_limit',
      rowLimit: 2,
      returnedRows: 2,
    });
  });

  it('does not query wallet data after authorization denial', async () => {
    const context = createContext();
    context.authorizeWalletAccess.mockRejectedValue(new AssistantToolError(403, 'denied'));

    await expect(
      assistantReadToolRegistry.execute('query_utxos', { walletId }, context)
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.assistantReadRepository.queryUtxos).not.toHaveBeenCalled();
  });

  it('reports not found wallets after scoped access is accepted', async () => {
    const context = createContext();
    mocks.walletRepository.findByIdWithAccess.mockResolvedValue(null);
    mocks.utxoRepository.aggregateUnspent.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
    mocks.transactionRepository.countByWalletId.mockResolvedValue(0);
    mocks.utxoRepository.countByWalletId.mockResolvedValue(0);
    mocks.assistantReadRepository.countDrafts.mockResolvedValue(0);
    mocks.policyRepository.findAllPoliciesForWallet.mockResolvedValue([]);
    mocks.intelligenceRepository.countActiveInsights.mockResolvedValue(0);

    await expect(
      assistantReadToolRegistry.execute('get_wallet_overview', { walletId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
  });

  it('rejects unsafe fiat-to-sats conversion boundaries', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getLatestPrice.mockResolvedValue({
      currency: 'USD',
      price: 65000,
      source: 'test',
      createdAt: new Date('2026-04-26T00:00:00.000Z'),
    });

    await expect(
      assistantReadToolRegistry.execute(
        'convert_price',
        { fiatAmount: Number.MAX_VALUE, currency: 'USD' },
        context
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });
});
