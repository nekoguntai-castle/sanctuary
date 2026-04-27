import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getBitcoinNetworkStatus: vi.fn(),
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

vi.mock('../../../src/services/bitcoin/networkStatusService', () => ({
  getBitcoinNetworkStatus: mocks.getBitcoinNetworkStatus,
}));

import { assistantReadToolRegistry, type AssistantToolContext } from '../../../src/assistant/tools';

const walletId = '11111111-1111-4111-8111-111111111111';
const secondWalletId = '22222222-2222-4222-8222-222222222222';

function createContext(): AssistantToolContext & {
  authorizeWalletAccess: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'test',
    actor: { userId: 'user-1', username: 'alice', isAdmin: false },
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function priceRow(price: number | null, currency = 'USD') {
  return {
    currency,
    price,
    source: 'test',
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

describe('assistant read-tool executors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies transaction, UTXO, and address filters before shaping list DTOs', async () => {
    const context = createContext();
    mocks.assistantReadRepository.queryTransactions.mockResolvedValueOnce([
      {
        id: 'tx-1',
        txid: 'abc',
        walletId,
        type: 'sent',
        amount: 1500n,
        fee: 10n,
        balanceAfter: 9000n,
        confirmations: 5,
        blockHeight: 840000,
        blockTime: new Date('2026-04-25T00:00:00.000Z'),
        transactionLabels: [{ label: { name: 'rent' } }],
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: new Date('2026-04-25T00:00:00.000Z'),
      },
    ]);

    const transactions = await assistantReadToolRegistry.execute(
      'query_transactions',
      {
        walletId,
        type: 'sent',
        dateFrom: '2026-04-24T00:00:00.000Z',
        dateTo: '2026-04-26T00:00:00.000Z',
        minAmount: '1000',
        maxAmount: 2000,
        limit: 5,
      },
      context
    );

    expect(mocks.assistantReadRepository.queryTransactions).toHaveBeenCalledWith(
      {
        walletId,
        type: 'sent',
        blockTime: {
          gte: new Date('2026-04-24T00:00:00.000Z'),
          lte: new Date('2026-04-26T00:00:00.000Z'),
        },
        amount: { gte: 1000n, lte: 2000n },
      },
      6
    );
    expect(transactions.data.transactions).toEqual([
      expect.objectContaining({ txid: 'abc', labels: ['rent'] }),
    ]);

    mocks.assistantReadRepository.queryUtxos
      .mockResolvedValueOnce([
        {
          id: 'utxo-1',
          walletId,
          txid: 'abc',
          vout: 0,
          address: 'bc1qone',
          amount: 2500n,
          confirmations: 4,
          blockHeight: 840001,
          spent: false,
          spentTxid: null,
          frozen: true,
          draftLock: { draft: { id: 'draft-1', label: 'rebalance' } },
          createdAt: new Date('2026-04-25T00:00:00.000Z'),
          updatedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const utxos = await assistantReadToolRegistry.execute(
      'query_utxos',
      { walletId, spent: false, frozen: true, minAmount: '2000', maxAmount: 3000, limit: 10 },
      context
    );
    await assistantReadToolRegistry.execute('query_utxos', { walletId }, context);

    expect(mocks.assistantReadRepository.queryUtxos).toHaveBeenNthCalledWith(
      1,
      { walletId, spent: false, frozen: true, amount: { gte: 2000n, lte: 3000n } },
      11
    );
    expect(utxos.data.utxos).toEqual([
      expect.objectContaining({ amount: '2500', lockedByDraft: { id: 'draft-1', label: 'rebalance' } }),
    ]);

    mocks.assistantReadRepository.searchAddresses
      .mockResolvedValueOnce([
        {
          id: 'addr-1',
          walletId,
          address: 'bc1qone',
          index: 0,
          used: true,
          addressLabels: [{ label: { name: 'deposit' } }],
          createdAt: new Date('2026-04-25T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    const addresses = await assistantReadToolRegistry.execute(
      'search_addresses',
      { walletId, query: 'bc1q', used: true, hasLabels: true, limit: 10 },
      context
    );
    await assistantReadToolRegistry.execute('search_addresses', { walletId, hasLabels: false }, context);

    expect(mocks.assistantReadRepository.searchAddresses).toHaveBeenNthCalledWith(
      1,
      { walletId, address: { contains: 'bc1q' }, used: true, addressLabels: { some: {} } },
      11
    );
    expect(mocks.assistantReadRepository.searchAddresses).toHaveBeenNthCalledWith(
      2,
      { walletId, addressLabels: { none: {} } },
      expect.any(Number)
    );
    expect(addresses.sensitivity).toBe('high');
    expect(addresses.data.addresses).toEqual([
      expect.objectContaining({ address: 'bc1qone', labels: ['deposit'] }),
    ]);
  });

  it('builds wallet overview from shared repositories after scoped access', async () => {
    const context = createContext();
    mocks.walletRepository.findByIdWithAccess.mockResolvedValue({
      id: walletId,
      name: 'Treasury',
      type: 'multisig',
      scriptType: 'p2wsh',
      network: 'mainnet',
      quorum: 2,
      totalSigners: 3,
      groupId: null,
      groupRole: null,
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncedBlockHeight: 840000,
      lastSyncStatus: 'ok',
      createdAt: new Date('2026-04-25T00:00:00.000Z'),
      updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    });
    mocks.utxoRepository.aggregateUnspent.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
    mocks.transactionRepository.countByWalletId.mockResolvedValue(2);
    mocks.utxoRepository.countByWalletId.mockResolvedValue(0);
    mocks.assistantReadRepository.countDrafts.mockResolvedValue(1);
    mocks.policyRepository.findAllPoliciesForWallet.mockResolvedValue([
      {
        id: 'policy-1',
        walletId,
        groupId: null,
        name: 'Large spend',
        description: null,
        type: 'spending_limit',
        config: { amount: '100000' },
        priority: 1,
        enforcement: 'approval_required',
        enabled: true,
        sourceType: 'manual',
        sourceId: null,
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: new Date('2026-04-26T00:00:00.000Z'),
      },
    ]);
    mocks.intelligenceRepository.countActiveInsights.mockResolvedValue(3);

    const envelope = await assistantReadToolRegistry.execute('get_wallet_overview', { walletId }, context);

    expect(mocks.walletRepository.findByIdWithAccess).toHaveBeenCalledWith(walletId, 'user-1');
    expect(envelope.data).toMatchObject({
      wallet: { id: walletId, name: 'Treasury' },
      balance: { totalSats: '0', utxoCount: 0 },
      counts: { transactions: 2, drafts: 1, policies: 1, activeInsights: 3 },
      policies: [expect.objectContaining({ id: 'policy-1' })],
    });
  });

  it('executes wallet analytics metrics, bounded periods, balance history, and draft statuses', async () => {
    const context = createContext();
    mocks.intelligenceRepository.getTransactionVelocity.mockResolvedValue({ perDay: 2 });
    mocks.intelligenceRepository.getUtxoAgeDistribution.mockResolvedValue([{ bucket: 'new', count: 1 }]);
    mocks.transactionRepository.groupByType.mockResolvedValue([{ type: 'received', count: 3 }]);
    mocks.assistantReadRepository.aggregateFees
      .mockResolvedValueOnce({ _count: { id: 2 }, _sum: { fee: 12n }, _avg: { fee: 6n } })
      .mockResolvedValue({ _count: { id: 0 }, _sum: { fee: null }, _avg: { fee: null } });

    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'velocity' }, context);
    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'utxo_age', period: '2d' }, context);
    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'tx_types', period: '3w' }, context);
    const fees = await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'fees', period: '4m' }, context);
    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'fees', period: '1y' }, context);
    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'fees', period: 'bad' }, context);
    await assistantReadToolRegistry.execute('get_wallet_analytics', { walletId, metric: 'fees', period: '0d' }, context);
    await assistantReadToolRegistry.execute(
      'get_wallet_analytics',
      { walletId, metric: 'fees', period: `${Number.MAX_SAFE_INTEGER}y` },
      context
    );

    expect(mocks.intelligenceRepository.getTransactionVelocity).toHaveBeenCalledWith(walletId, 30);
    expect(mocks.assistantReadRepository.aggregateFees).toHaveBeenCalledTimes(5);
    expect(fees.data).toMatchObject({
      periodDays: 120,
      fees: { count: 2, sumFee: '12', averageFee: '6' },
    });

    mocks.transactionRepository.getBucketedBalanceDeltas.mockResolvedValue([
      { bucket: '2026-04-25', amount: 100n },
      { bucket: '2026-04-26', amount: -25n },
    ]);

    const history = await assistantReadToolRegistry.execute(
      'get_balance_history',
      { walletIds: [walletId, walletId, secondWalletId], startDate: '2026-04-25T00:00:00.000Z' },
      context
    );

    expect(mocks.transactionRepository.getBucketedBalanceDeltas).toHaveBeenCalledWith(
      [walletId, secondWalletId],
      new Date('2026-04-25T00:00:00.000Z'),
      'day'
    );
    expect(history.data.history).toEqual([
      { bucket: '2026-04-25', deltaSats: '100', cumulativeDeltaSats: '100' },
      { bucket: '2026-04-26', deltaSats: '-25', cumulativeDeltaSats: '75' },
    ]);

    await expect(
      assistantReadToolRegistry.execute(
        'get_balance_history',
        { walletIds: [walletId], startDate: 'bad-date' },
        context
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.draftRepository.findByWalletId.mockResolvedValue([
      {
        id: 'draft-1',
        walletId,
        label: 'payment',
        status: 'pending',
        approvalStatus: 'pending',
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: null,
        expiresAt: '2026-04-27T00:00:00.000Z',
        totalOutput: 5000n,
        fee: 10n,
        outputs: [{ address: 'bc1qone' }],
        psbt: 'must-not-leak',
      },
    ]);

    const drafts = await assistantReadToolRegistry.execute('get_draft_statuses', { walletId }, context);

    expect(drafts.redactions).toContain('draft_psbt_material');
    expect(drafts.data.drafts).toEqual([
      expect.objectContaining({ id: 'draft-1', totalAmount: '5000', recipientCount: 1 }),
    ]);
    expect(JSON.stringify(drafts.data)).not.toContain('must-not-leak');
  });

  it('returns public network data and fails closed on unsafe price conversions', async () => {
    const context = createContext();
    mocks.getBitcoinNetworkStatus.mockResolvedValueOnce({
      connected: true,
      server: 'electrum.example',
      protocol: '1.4',
      blockHeight: 840123,
      network: 'mainnet',
      explorerUrl: 'https://mempool.space',
      confirmationThreshold: 6,
      deepConfirmationThreshold: 100,
      pool: null,
    });
    mocks.assistantReadRepository.getLatestFeeEstimate.mockResolvedValue({
      fastest: 8,
      halfHour: 4,
      hour: 2,
      createdAt: new Date('2026-04-26T11:55:00.000Z'),
    });

    const network = await assistantReadToolRegistry.execute('get_bitcoin_network_status', {}, context);
    expect(network.data.status).toMatchObject({
      connected: true,
      blockHeight: 840123,
      network: 'mainnet',
    });
    expect(network.facts.items).toEqual(expect.arrayContaining([
      { label: 'block_height', value: 840123 },
    ]));
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();

    const fees = await assistantReadToolRegistry.execute('get_fee_estimates', {}, context);
    expect(fees.data.fees).toMatchObject({ available: true, fastest: 8, stale: false });

    mocks.assistantReadRepository.getLatestPrice
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(priceRow(65000))
      .mockResolvedValueOnce(priceRow(65000))
      .mockResolvedValueOnce(priceRow(null))
      .mockResolvedValueOnce(priceRow(0))
      .mockResolvedValueOnce(priceRow(Number.POSITIVE_INFINITY))
      .mockResolvedValueOnce(priceRow(65000))
      .mockResolvedValueOnce(priceRow(65000));

    const unavailable = await assistantReadToolRegistry.execute(
      'convert_price',
      { sats: '1000', currency: 'USD' },
      context
    );
    const satsToFiat = await assistantReadToolRegistry.execute(
      'convert_price',
      { sats: '100000000', currency: 'USD' },
      context
    );
    const fiatToSats = await assistantReadToolRegistry.execute(
      'convert_price',
      { fiatAmount: 65, currency: 'USD' },
      context
    );
    const nullPrice = await assistantReadToolRegistry.execute(
      'convert_price',
      { fiatAmount: 65, currency: 'USD' },
      context
    );

    expect(unavailable.data.conversion).toBeNull();
    expect(satsToFiat.data.conversion).toMatchObject({
      direction: 'sats_to_fiat',
      sats: '100000000',
      fiatAmount: 65000,
    });
    expect(fiatToSats.data.conversion).toMatchObject({
      direction: 'fiat_to_sats',
      sats: '100000',
    });
    expect(nullPrice.data.conversion).toBeNull();

    await expect(
      assistantReadToolRegistry.execute('convert_price', { fiatAmount: 65, currency: 'USD' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assistantReadToolRegistry.execute('convert_price', { fiatAmount: 65, currency: 'USD' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assistantReadToolRegistry.execute(
        'convert_price',
        { sats: `${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`, currency: 'USD' },
        context
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assistantReadToolRegistry.execute(
        'convert_price',
        { sats: `${BigInt(Number.MIN_SAFE_INTEGER) - 1n}`, currency: 'USD' },
        context
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(assistantReadToolRegistry.execute('convert_price', { currency: 'USD' }, context)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      assistantReadToolRegistry.execute(
        'convert_price',
        { sats: '1', fiatAmount: 1, currency: 'USD' },
        context
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns a closed network-status envelope when the Bitcoin status read fails', async () => {
    const context = createContext();
    mocks.getBitcoinNetworkStatus.mockRejectedValueOnce(new Error('electrum unavailable'));

    const network = await assistantReadToolRegistry.execute('get_bitcoin_network_status', {}, context);

    expect(network.data.status).toEqual({
      connected: false,
      error: 'electrum unavailable',
    });
    expect(network.warnings).toContain('bitcoin_network_status_unavailable');
    expect(network.facts.items).toEqual(expect.arrayContaining([
      { label: 'connected', value: false },
      { label: 'block_height', value: null },
    ]));
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });
});
