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
  userRepository: {
    findByIdWithSelect: vi.fn(),
  },
  walletSharingRepository: {
    findWalletIdsByUserRole: vi.fn(),
  },
  utxoRepository: {
    aggregateUnspent: vi.fn(),
    countByWalletId: vi.fn(),
    findWalletIdByUtxoId: vi.fn(),
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
  deviceRepository: {
    findHardwareModels: vi.fn(),
  },
  privacyService: {
    calculateWalletPrivacy: vi.fn(),
    calculateUtxoPrivacy: vi.fn(),
  },
  approvalService: {
    getPendingApprovalsForUser: vi.fn(),
  },
  deviceAccess: {
    getUserAccessibleDevices: vi.fn(),
  },
  priceService: {
    getHistoricalPrice: vi.fn(),
  },
  mempool: {
    getBlocksAndMempool: vi.fn(),
    getRecentBlocks: vi.fn(),
  },
  getBitcoinNetworkStatus: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  assistantReadRepository: mocks.assistantReadRepository,
  walletRepository: mocks.walletRepository,
  userRepository: mocks.userRepository,
  walletSharingRepository: mocks.walletSharingRepository,
  utxoRepository: mocks.utxoRepository,
  transactionRepository: mocks.transactionRepository,
  policyRepository: mocks.policyRepository,
  intelligenceRepository: mocks.intelligenceRepository,
  draftRepository: mocks.draftRepository,
  deviceRepository: mocks.deviceRepository,
}));

vi.mock('../../../src/services/privacyService', () => ({
  calculateWalletPrivacy: mocks.privacyService.calculateWalletPrivacy,
  calculateUtxoPrivacy: mocks.privacyService.calculateUtxoPrivacy,
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: mocks.approvalService,
}));

vi.mock('../../../src/services/price', () => ({
  getPriceService: () => mocks.priceService,
}));

vi.mock('../../../src/services/deviceAccess', () => ({
  getUserAccessibleDevices: mocks.deviceAccess.getUserAccessibleDevices,
}));

vi.mock('../../../src/services/bitcoin/mempool', () => ({
  getBlocksAndMempool: mocks.mempool.getBlocksAndMempool,
  getRecentBlocks: mocks.mempool.getRecentBlocks,
}));

vi.mock('../../../src/services/bitcoin/networkStatusService', () => ({
  getBitcoinNetworkStatus: mocks.getBitcoinNetworkStatus,
}));

import { assistantReadToolRegistry, type AssistantToolContext } from '../../../src/assistant/tools';
import { resetMempoolStatusCacheForTests } from '../../../src/assistant/tools/networkReadTools';
import { registerReadToolScopeTests } from './readToolExecutors.scope.contracts';

const walletId = '11111111-1111-4111-8111-111111111111';
const secondWalletId = '22222222-2222-4222-8222-222222222222';
const utxoId = 'utxo-1';

function createContext(): AssistantToolContext & {
  authorizeWalletAccess: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'test',
    actor: { userId: 'user-1', username: 'alice', isAdmin: false },
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function priceRow(price: number | null, currency = 'USD', createdAt = new Date('2026-04-26T00:00:00.000Z')) {
  return {
    currency,
    price,
    source: 'test',
    createdAt,
  };
}

describe('assistant read-tool executors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMempoolStatusCacheForTests();
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

  it('returns market status availability from cached price and fee rows', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getLatestFeeEstimate.mockResolvedValue({
      fastest: 8,
      halfHour: 4,
      hour: 2,
      createdAt: new Date('2026-04-26T11:55:00.000Z'),
    });
    mocks.assistantReadRepository.getLatestPrice
      .mockResolvedValueOnce(priceRow(65_000, 'USD', new Date('2026-04-26T11:55:00.000Z')))
      .mockResolvedValueOnce(null);

    const available = await assistantReadToolRegistry.execute(
      'get_market_status',
      { currencies: ['usd'], includeFees: true },
      context
    );
    const unavailable = await assistantReadToolRegistry.execute(
      'get_market_status',
      { currencies: ['usd'], includeFees: false },
      context
    );

    expect(available.data.prices).toEqual([
      expect.objectContaining({
        available: true,
        currency: 'USD',
        price: 65_000,
        stale: false,
      }),
    ]);
    expect(available.data.fees).toMatchObject({
      available: true,
      fastest: 8,
      stale: false,
    });
    expect(unavailable.data.prices).toEqual([
      expect.objectContaining({
        available: false,
        currency: 'USD',
        price: null,
        stale: true,
      }),
    ]);
    expect(unavailable.data.fees).toBeNull();
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

  it('summarizes network status without block height when the backend omits height data', async () => {
    const context = createContext();
    mocks.getBitcoinNetworkStatus.mockResolvedValueOnce({
      connected: true,
      server: 'electrum.example',
      protocol: '1.4',
      blockHeight: undefined,
      network: 'mainnet',
      explorerUrl: 'https://mempool.space',
      confirmationThreshold: 6,
      deepConfirmationThreshold: 100,
      pool: null,
    });

    const network = await assistantReadToolRegistry.execute('get_bitcoin_network_status', {}, context);

    expect(network.facts.summary).toBe(
      'Bitcoin network status returned without a block height.'
    );
    expect(network.facts.items).toEqual(expect.arrayContaining([
      { label: 'block_height', value: null },
    ]));
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('returns wallet privacy scores without raw address or outpoint material', async () => {
    const context = createContext();
    mocks.privacyService.calculateWalletPrivacy.mockResolvedValue({
      utxos: [
        {
          utxoId: 'utxo-1',
          txid: 'secret-txid',
          vout: 1,
          address: 'bc1qsecret',
          amount: 25_000n,
          score: {
            score: 80,
            grade: 'good',
            factors: [{ factor: 'Address reuse', impact: -20, description: 'reused' }],
            warnings: ['address reuse'],
          },
        },
      ],
      summary: {
        averageScore: 80,
        grade: 'good',
        utxoCount: 1,
        addressReuseCount: 1,
        roundAmountCount: 0,
        clusterCount: 0,
        recommendations: ['Avoid address reuse'],
      },
    });

    const envelope = await assistantReadToolRegistry.execute('get_wallet_privacy', { walletId }, context);

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
    expect(mocks.privacyService.calculateWalletPrivacy).toHaveBeenCalledWith(walletId);
    expect(envelope.data).toMatchObject({
      walletId,
      count: 1,
      utxos: [{ utxoId: 'utxo-1', amount: 25000, score: expect.objectContaining({ grade: 'good' }) }],
    });
    expect(JSON.stringify(envelope.data)).not.toContain('secret-txid');
    expect(JSON.stringify(envelope.data)).not.toContain('bc1qsecret');
    expect(envelope.redactions).toEqual(expect.arrayContaining([
      'wallet_privacy_utxo_addresses',
      'wallet_privacy_utxo_txids',
      'wallet_privacy_utxo_outpoints',
    ]));
  });

  it('does not calculate wallet privacy after authorization denial', async () => {
    const context = createContext();
    context.authorizeWalletAccess.mockRejectedValue(new Error('denied'));

    await expect(
      assistantReadToolRegistry.execute('get_wallet_privacy', { walletId }, context)
    ).rejects.toThrow('denied');

    expect(mocks.privacyService.calculateWalletPrivacy).not.toHaveBeenCalled();
  });

  it('lists supported device models with route-equivalent discontinued defaults', async () => {
    const context = createContext();
    mocks.deviceRepository.findHardwareModels
      .mockResolvedValueOnce([
        {
          id: 'model-1',
          name: 'Coldcard Mk4',
          slug: 'coldcard-mk4',
          manufacturer: 'Coinkite',
          connectivity: ['usb', 'sd_card'],
          airGapped: true,
          discontinued: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'model-2',
          name: 'Legacy Device',
          slug: 'legacy-device',
          manufacturer: 'Example',
          connectivity: ['usb'],
          airGapped: false,
          discontinued: true,
        },
      ]);

    const defaultList = await assistantReadToolRegistry.execute(
      'list_supported_device_models',
      { manufacturer: 'Coinkite', airGapped: false, connectivity: 'usb' },
      context
    );
    const withDiscontinued = await assistantReadToolRegistry.execute(
      'list_supported_device_models',
      { includeDiscontinued: true },
      context
    );

    expect(mocks.deviceRepository.findHardwareModels).toHaveBeenNthCalledWith(1, {
      manufacturer: 'Coinkite',
      airGapped: false,
      connectivity: 'usb',
      discontinued: false,
    });
    expect(mocks.deviceRepository.findHardwareModels).toHaveBeenNthCalledWith(2, {});
    expect(defaultList.data).toMatchObject({ count: 1, includeDiscontinued: false });
    expect(withDiscontinued.data).toMatchObject({ count: 1, includeDiscontinued: true });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('returns historical prices and rejects invalid or future dates', async () => {
    const context = createContext();
    mocks.priceService.getHistoricalPrice.mockResolvedValue(42_000);

    const envelope = await assistantReadToolRegistry.execute(
      'get_historical_price',
      { date: '2026-04-25', currency: 'usd' },
      context
    );

    expect(mocks.priceService.getHistoricalPrice).toHaveBeenCalledWith('USD', new Date('2026-04-25'));
    expect(envelope.data).toMatchObject({
      date: new Date('2026-04-25').toISOString(),
      currency: 'USD',
      price: 42_000,
      provider: 'coingecko',
    });
    await expect(
      assistantReadToolRegistry.execute('get_historical_price', { date: 'not-a-date' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assistantReadToolRegistry.execute('get_historical_price', { date: '2026-04-27T00:00:00.000Z' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('returns mainnet mempool status with fresh cache and stale fallback', async () => {
    const context = createContext();
    const mempoolData = {
      mempool: [{ height: 'Next', medianFee: 4, feeRange: '2-4 sat/vB', size: 1, time: '~10m', status: 'pending', txCount: 12, totalFees: 0.01 }],
      blocks: [{ height: 840123, medianFee: 2 }],
      mempoolInfo: { count: 12, size: 1.2, totalFees: 0.02 },
      queuedBlocksSummary: null,
    };
    mocks.mempool.getBlocksAndMempool.mockResolvedValueOnce(mempoolData);

    const fetched = await assistantReadToolRegistry.execute('get_mempool_status', {}, context);
    const cached = await assistantReadToolRegistry.execute('get_mempool_status', {}, context);
    vi.setSystemTime(new Date('2026-04-26T12:00:16.000Z'));
    mocks.mempool.getBlocksAndMempool.mockRejectedValueOnce(new Error('mempool down'));
    const stale = await assistantReadToolRegistry.execute('get_mempool_status', {}, context);
    vi.setSystemTime(new Date('2026-04-26T12:05:01.000Z'));
    mocks.mempool.getBlocksAndMempool.mockRejectedValueOnce(new Error('mempool still down'));

    await expect(assistantReadToolRegistry.execute('get_mempool_status', {}, context)).rejects.toMatchObject({
      statusCode: 502,
    });

    expect(mocks.mempool.getBlocksAndMempool).toHaveBeenCalledTimes(3);
    expect(mocks.mempool.getBlocksAndMempool).toHaveBeenCalledWith('mainnet');
    expect(fetched.data).toMatchObject({ network: 'mainnet', status: mempoolData });
    expect(cached.provenance.sources[0]).toMatchObject({ type: 'sanctuary_cache' });
    expect(stale.data.status).toMatchObject({ stale: true });
    expect(stale.warnings).toContain('mempool_status_stale');
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('returns recent mainnet blocks with defaults and count capping', async () => {
    const context = createContext();
    const block = { id: 'block-1', height: 840123 };
    mocks.mempool.getRecentBlocks
      .mockResolvedValueOnce([block])
      .mockResolvedValueOnce([block, { id: 'block-2', height: 840122 }]);

    const defaults = await assistantReadToolRegistry.execute('get_recent_blocks', {}, context);
    const capped = await assistantReadToolRegistry.execute('get_recent_blocks', { count: 200 }, context);

    expect(mocks.mempool.getRecentBlocks).toHaveBeenNthCalledWith(1, 10, 'mainnet');
    expect(mocks.mempool.getRecentBlocks).toHaveBeenNthCalledWith(2, 100, 'mainnet');
    expect(defaults.data).toMatchObject({ network: 'mainnet', requestedCount: 10, count: 1 });
    expect(capped.data).toMatchObject({ network: 'mainnet', requestedCount: 100, count: 2 });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('resolves UTXO wallet access before returning redacted UTXO privacy', async () => {
    const context = createContext();
    mocks.utxoRepository.findWalletIdByUtxoId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(walletId)
      .mockResolvedValueOnce(walletId);
    mocks.privacyService.calculateUtxoPrivacy.mockResolvedValue({
      score: 70,
      grade: 'good',
      factors: [{ factor: 'Round Amount', impact: -10, description: 'round' }],
      warnings: ['round amount'],
    });

    await expect(
      assistantReadToolRegistry.execute('get_utxo_privacy', { utxoId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();

    context.authorizeWalletAccess.mockRejectedValueOnce(new Error('wallet denied'));
    await expect(
      assistantReadToolRegistry.execute('get_utxo_privacy', { utxoId }, context)
    ).rejects.toThrow('wallet denied');
    expect(mocks.privacyService.calculateUtxoPrivacy).not.toHaveBeenCalled();

    const envelope = await assistantReadToolRegistry.execute('get_utxo_privacy', { utxoId }, context);

    expect(mocks.utxoRepository.findWalletIdByUtxoId).toHaveBeenCalledWith(utxoId);
    expect(context.authorizeWalletAccess).toHaveBeenLastCalledWith(walletId);
    expect(mocks.privacyService.calculateUtxoPrivacy).toHaveBeenCalledWith(utxoId);
    expect(envelope.data).toMatchObject({
      walletId,
      utxoId,
      score: { grade: 'good', score: 70 },
    });
    expect(envelope.redactions).toEqual(expect.arrayContaining([
      'utxo_addresses',
      'utxo_txids',
      'utxo_outpoints',
    ]));
  });

  it('lists pending approvals for approve-capable wallets without recipient addresses', async () => {
    const context = createContext();
    mocks.walletSharingRepository.findWalletIdsByUserRole.mockResolvedValue([walletId, secondWalletId]);
    mocks.approvalService.getPendingApprovalsForUser.mockResolvedValue([
      {
        id: 'approval-1',
        draftTransactionId: 'draft-1',
        status: 'pending',
        requiredApprovals: 2,
        expiresAt: null,
        createdAt: new Date('2026-04-26T11:00:00.000Z'),
        votes: [
          { decision: 'approve', userId: 'do-not-return' },
          { decision: 'reject', userId: 'do-not-return-2' },
        ],
        draftTransaction: {
          walletId,
          recipient: 'bc1qrecipient',
          amount: 1234n,
        },
      },
    ]);

    const envelope = await assistantReadToolRegistry.execute('get_pending_approvals', {}, context);

    expect(mocks.walletSharingRepository.findWalletIdsByUserRole).toHaveBeenCalledWith('user-1', expect.any(Array));
    expect(mocks.approvalService.getPendingApprovalsForUser).toHaveBeenCalledWith([walletId, secondWalletId]);
    expect(envelope.data).toMatchObject({
      total: 1,
      approvals: [{
        id: 'approval-1',
        walletId,
        currentApprovals: 1,
        totalVotes: 2,
        amount: '1234',
      }],
    });
    expect(JSON.stringify(envelope.data)).not.toContain('bc1qrecipient');
    expect(JSON.stringify(envelope.data)).not.toContain('do-not-return');
    expect(envelope.redactions).toEqual(expect.arrayContaining([
      'approval_recipient_addresses',
      'approval_vote_user_details',
    ]));
  });

  it('returns the caller fiat currency preference with safe defaults only', async () => {
    const context = createContext();
    mocks.userRepository.findByIdWithSelect
      .mockResolvedValueOnce({ preferences: { fiatCurrency: 'eur' } })
      .mockResolvedValueOnce({ preferences: { fiatCurrency: '   ' } })
      .mockResolvedValueOnce({ preferences: [] })
      .mockResolvedValueOnce(null);

    const explicit = await assistantReadToolRegistry.execute('get_user_preferences', {}, context);
    const blankDefault = await assistantReadToolRegistry.execute('get_user_preferences', {}, context);
    const arrayDefault = await assistantReadToolRegistry.execute('get_user_preferences', {}, context);

    await expect(
      assistantReadToolRegistry.execute('get_user_preferences', {}, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.userRepository.findByIdWithSelect).toHaveBeenCalledWith('user-1', { preferences: true });
    expect(explicit.data).toEqual({ userId: 'user-1', fiatCurrency: 'EUR' });
    expect(blankDefault.data).toEqual({ userId: 'user-1', fiatCurrency: 'USD' });
    expect(arrayDefault.data).toEqual({ userId: 'user-1', fiatCurrency: 'USD' });
    expect(JSON.stringify(explicit.data)).not.toContain('password');
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();
  });

  it('lists devices through an allow-list projection without signer secrets or wallet details', async () => {
    const context = createContext();
    mocks.deviceAccess.getUserAccessibleDevices.mockResolvedValue([
      {
        id: 'device-1',
        userId: 'owner-1',
        modelId: 'model-1',
        type: 'coldcard',
        label: 'Treasury signer',
        fingerprint: 'secret-fingerprint',
        derivationPath: 'm/48h/0h/0h/2h',
        xpub: 'xpub-secret',
        groupId: 'group-1',
        groupRole: 'viewer',
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: new Date('2026-04-26T00:00:00.000Z'),
        isOwner: false,
        userRole: 'viewer',
        sharedBy: 'do-not-return',
        model: { id: 'model-1', slug: 'coldcard-mk4', name: 'Coldcard Mk4' },
        walletCount: 2,
        wallets: [{ wallet: { id: walletId, name: 'Treasury', type: 'multisig', scriptType: 'p2wsh', network: 'mainnet' } }],
        accounts: [{ id: 'account-1', purpose: '84', scriptType: 'p2wpkh', derivationPath: 'm/84h', xpub: 'account-xpub-secret' }],
      },
    ]);

    const envelope = await assistantReadToolRegistry.execute('list_devices', {}, context);

    expect(mocks.deviceAccess.getUserAccessibleDevices).toHaveBeenCalledWith('user-1');
    expect(envelope.data).toMatchObject({
      count: 1,
      devices: [{
        id: 'device-1',
        label: 'Treasury signer',
        type: 'coldcard',
        model: { slug: 'coldcard-mk4' },
        isOwner: false,
        userRole: 'viewer',
        walletCount: 2,
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-26T00:00:00.000Z',
      }],
    });
    const serialized = JSON.stringify(envelope.data);
    expect(serialized).not.toContain('secret-fingerprint');
    expect(serialized).not.toContain('xpub-secret');
    expect(serialized).not.toContain('account-xpub-secret');
    expect(serialized).not.toContain('do-not-return');
    expect(serialized).not.toContain(walletId);
    expect(envelope.redactions).toEqual(expect.arrayContaining([
      'device_xpubs',
      'device_fingerprints',
      'device_wallet_associations',
      'device_account_details',
    ]));
  });

  registerReadToolScopeTests({
    mocks,
    createContext,
    walletId,
    secondWalletId,
  });
});
