import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { assistantReadToolRegistry, type AssistantToolContext } from '../../../src/assistant/tools';

const walletId = '11111111-1111-4111-8111-111111111111';
const secondWalletId = '22222222-2222-4222-8222-222222222222';
const txid = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';

function createContext(walletScopeIds?: string[]): AssistantToolContext & {
  authorizeWalletAccess: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'test',
    actor: { userId: 'user-1', username: 'alice', isAdmin: false },
    walletScopeIds,
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function walletRow(id = walletId) {
  return {
    id,
    name: id === walletId ? 'Treasury' : 'Ops',
    type: 'multi_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    quorum: 2,
    totalSigners: 3,
    groupId: null,
    groupRole: 'viewer',
    syncInProgress: false,
    lastSyncedAt: new Date('2026-04-26T10:00:00.000Z'),
    lastSyncedBlockHeight: 840000,
    lastSyncStatus: 'success',
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

function transactionStats() {
  return {
    typeStats: [
      { type: 'received', _count: { id: 3 }, _sum: { amount: 9000n } },
      { type: 'sent', _count: { id: 2 }, _sum: { amount: -4000n } },
      { type: 'consolidation', _count: { id: 1 }, _sum: { amount: -100n } },
    ],
    feeStats: { _count: { id: 2 }, _sum: { fee: 150n } },
    lastTransaction: { balanceAfter: 4900n },
  };
}

function utxoSummary() {
  return {
    total: { _count: { id: 5 }, _sum: { amount: 12_000n } },
    spendable: { _count: { id: 3 }, _sum: { amount: 9_000n } },
    frozen: { _count: { id: 1 }, _sum: { amount: 1_000n } },
    unconfirmed: { _count: { id: 1 }, _sum: { amount: 2_000n } },
    locked: { _count: { id: 1 }, _sum: { amount: 3_000n } },
    spent: { _count: { id: 4 }, _sum: { amount: 8_000n } },
  };
}

function addressSummary() {
  return {
    totalCount: 8,
    usedCount: 3,
    unusedCount: 5,
    totalBalance: { _sum: { amount: 12_000n } },
    usedBalances: [
      { used: true, balance: 7_000n },
      { used: false, balance: 5_000n },
    ],
  };
}

function pendingTransaction(id: string, createdAt = new Date('2026-04-26T11:59:00.000Z')) {
  return {
    id,
    txid: `${id}`.padEnd(64, 'a'),
    walletId,
    type: 'sent',
    amount: -1000n,
    fee: 25n,
    balanceAfter: 11_000n,
    confirmations: 0,
    blockHeight: null,
    blockTime: null,
    label: null,
    memo: null,
    counterpartyAddress: 'bc1qrecipient',
    rbfStatus: 'active',
    replacedByTxid: null,
    replacementForTxid: null,
    transactionLabels: [{ label: { name: 'queued' } }],
    createdAt,
    updatedAt: createdAt,
  };
}

describe('read-tool parity batch 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds dashboard summaries from scoped accessible wallets', async () => {
    const context = createContext([walletId, secondWalletId]);
    mocks.assistantReadRepository.getDashboardSummary.mockResolvedValue({
      wallets: [
        { ...walletRow(walletId), _count: { addresses: 5, devices: 2, draftTransactions: 1 } },
        { ...walletRow(secondWalletId), _count: { addresses: 4, devices: 1, draftTransactions: 0 } },
      ],
      balances: [
        { walletId, _count: { id: 2 }, _sum: { amount: 7000n } },
        { walletId: secondWalletId, _count: { id: 1 }, _sum: { amount: 3000n } },
      ],
      transactionCounts: [
        { walletId, _count: { id: 8 } },
        { walletId: secondWalletId, _count: { id: 2 } },
      ],
      pendingCounts: [{ walletId, _count: { id: 1 } }],
    });

    const envelope = await assistantReadToolRegistry.execute(
      'get_dashboard_summary',
      { network: 'mainnet', limit: 10 },
      context
    );

    expect(mocks.assistantReadRepository.getDashboardSummary).toHaveBeenCalledWith('user-1', {
      walletIds: [walletId, secondWalletId],
      network: 'mainnet',
      limit: 10,
    });
    expect(envelope.data).toMatchObject({
      walletCount: 2,
      totalBalanceSats: '10000',
      totalTransactions: 10,
      pendingTransactions: 1,
      scoped: true,
      networks: [{ network: 'mainnet', walletCount: 2, balanceSats: '10000' }],
    });
  });

  it('builds unscoped dashboard summaries with zero defaults for missing aggregates', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getDashboardSummary.mockResolvedValue({
      wallets: [
        { ...walletRow(walletId), network: 'mainnet', _count: { addresses: 0, devices: 0, draftTransactions: 0 } },
        { ...walletRow(secondWalletId), network: 'signet', _count: { addresses: 1, devices: 1, draftTransactions: 0 } },
      ],
      balances: [{ walletId: secondWalletId }],
      transactionCounts: [{ walletId, _count: {} }],
      pendingCounts: [{ walletId, _count: {} }, { walletId: secondWalletId }],
    });

    const envelope = await assistantReadToolRegistry.execute('get_dashboard_summary', {}, context);

    expect(mocks.assistantReadRepository.getDashboardSummary).toHaveBeenCalledWith('user-1', {
      walletIds: undefined,
      network: undefined,
      limit: expect.any(Number),
    });
    expect(envelope.data).toMatchObject({
      walletCount: 2,
      totalBalanceSats: '0',
      totalTransactions: 0,
      pendingTransactions: 0,
      scoped: false,
      networks: [
        { network: 'mainnet', walletCount: 1, balanceSats: '0' },
        { network: 'signet', walletCount: 1, balanceSats: '0' },
      ],
    });
    expect(envelope.data.wallets).toEqual([
      expect.objectContaining({
        wallet: expect.objectContaining({ id: walletId }),
        balance: { unspentSats: '0', unspentUtxoCount: 0 },
        counts: expect.objectContaining({ transactions: 0, pendingTransactions: 0 }),
      }),
      expect.objectContaining({
        wallet: expect.objectContaining({ id: secondWalletId }),
        balance: { unspentSats: '0', unspentUtxoCount: 0 },
        counts: expect.objectContaining({ transactions: 0, pendingTransactions: 0 }),
      }),
    ]);
  });

  it('builds wallet detail summaries without exposing device secrets or share identities', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletDetailSummary.mockResolvedValue({
      ...walletRow(),
      devices: [
        {
          id: 'wallet-device-1',
          signerIndex: 0,
          createdAt: new Date('2026-04-25T00:00:00.000Z'),
          device: {
            id: 'device-1',
            type: 'coldcard',
            label: 'do-not-return',
            fingerprint: 'do-not-return',
            xpub: 'do-not-return',
            model: { name: 'Coldcard Mk4', manufacturer: 'Coinkite' },
          },
        },
      ],
      group: { id: 'group-1', name: 'do-not-return' },
      users: [{ role: 'owner' }, { role: 'viewer' }],
      _count: { addresses: 8, transactions: 6, utxos: 9, draftTransactions: 1, vaultPolicies: 2 },
    });
    mocks.assistantReadRepository.getTransactionStats.mockResolvedValue(transactionStats());
    mocks.assistantReadRepository.getUtxoSummary.mockResolvedValue(utxoSummary());
    mocks.assistantReadRepository.getAddressSummary.mockResolvedValue(addressSummary());

    const envelope = await assistantReadToolRegistry.execute('get_wallet_detail_summary', { walletId }, context);

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
    expect(envelope.redactions).toEqual(expect.arrayContaining(['device_xpubs', 'shared_usernames', 'group_names']));
    expect(envelope.data).toMatchObject({
      wallet: { id: walletId, name: 'Treasury' },
      devices: { count: 1, signers: [{ signerIndex: 0, device: { type: 'coldcard', modelName: 'Coldcard Mk4' } }] },
      sharing: { directUserCount: 2, roleCounts: { owner: 1, viewer: 1 }, group: { present: true, role: 'viewer' } },
      transactionStats: { totalCount: 6, totalFeesSats: '150' },
      utxoSummary: { total: { count: 5, amountSats: '12000' } },
      addressSummary: { totalAddresses: 8, usedBalanceSats: '7000' },
    });
    expect(JSON.stringify(envelope.data)).not.toContain('do-not-return');
  });

  it('returns not found for missing wallet detail summaries after wallet authorization', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletDetailSummary.mockResolvedValue(null);
    mocks.assistantReadRepository.getTransactionStats.mockResolvedValue({});
    mocks.assistantReadRepository.getUtxoSummary.mockResolvedValue({});
    mocks.assistantReadRepository.getAddressSummary.mockResolvedValue({});

    await expect(
      assistantReadToolRegistry.execute('get_wallet_detail_summary', { walletId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
  });

  it('summarizes wallet sharing defaults for unknown roles, ungrouped wallets, and missing user lists', async () => {
    const context = createContext();
    const minimalWallet = {
      ...walletRow(),
      devices: [],
      group: null,
      _count: { addresses: 0, transactions: 0, utxos: 0, draftTransactions: 0, vaultPolicies: 0 },
    };
    mocks.assistantReadRepository.getTransactionStats.mockResolvedValue({});
    mocks.assistantReadRepository.getUtxoSummary.mockResolvedValue({});
    mocks.assistantReadRepository.getAddressSummary.mockResolvedValue({});
    mocks.assistantReadRepository.findWalletDetailSummary.mockResolvedValueOnce({
      ...minimalWallet,
      users: [{ role: null }],
    });

    const unknownRole = await assistantReadToolRegistry.execute('get_wallet_detail_summary', { walletId }, context);
    expect(unknownRole.data.sharing).toEqual({
      directUserCount: 1,
      roleCounts: { unknown: 1 },
      group: { present: false, role: null },
    });

    mocks.assistantReadRepository.findWalletDetailSummary.mockResolvedValueOnce(minimalWallet);
    const missingUsers = await assistantReadToolRegistry.execute('get_wallet_detail_summary', { walletId }, context);
    expect(missingUsers.data.sharing).toMatchObject({
      directUserCount: 0,
      roleCounts: {},
      group: { present: false, role: null },
    });
  });

  it('normalizes zero aggregate wallet stats without leaking missing database fields', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getTransactionStats.mockResolvedValue({
      typeStats: [
        { type: 'received', _count: { id: 1 }, _sum: { amount: -500n } },
        { type: 'sent', _count: { id: 1 }, _sum: { amount: 250n } },
        { type: 'other', _count: {}, _sum: {} },
      ],
      feeStats: { _count: {}, _sum: { fee: null } },
      lastTransaction: null,
    });

    const stats = await assistantReadToolRegistry.execute('get_transaction_stats', { walletId }, context);
    expect(stats.data.stats).toMatchObject({
      totalCount: 2,
      receivedCount: 1,
      sentCount: 1,
      totalReceivedSats: '500',
      totalSentSats: '250',
      totalFeesSats: '0',
      feeTransactionCount: 0,
      walletBalanceSats: '0',
    });

    mocks.assistantReadRepository.getUtxoSummary.mockResolvedValue({});
    const utxos = await assistantReadToolRegistry.execute('get_utxo_summary', { walletId }, context);
    expect(utxos.data.summary).toMatchObject({
      total: { count: 0, amountSats: '0' },
      spendable: { count: 0, amountSats: '0' },
      spent: { count: 0, amountSats: '0' },
    });

    mocks.assistantReadRepository.getAddressSummary.mockResolvedValue({});
    const addresses = await assistantReadToolRegistry.execute('get_address_summary', { walletId }, context);
    expect(addresses.data.summary).toEqual({
      totalAddresses: 0,
      usedCount: 0,
      unusedCount: 0,
      totalBalanceSats: '0',
      usedBalanceSats: '0',
      unusedBalanceSats: '0',
    });
  });

  it('reads transaction stats, pending transactions, and one transaction detail', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getTransactionStats.mockResolvedValue(transactionStats());
    const stats = await assistantReadToolRegistry.execute('get_transaction_stats', { walletId }, context);
    expect(stats.data).toMatchObject({
      walletId,
      stats: { totalCount: 6, receivedCount: 3, sentCount: 2, walletBalanceSats: '4900' },
    });

    mocks.assistantReadRepository.findPendingTransactions.mockResolvedValue([
      pendingTransaction('pending-1'),
      pendingTransaction('pending-2'),
    ]);
    const pending = await assistantReadToolRegistry.execute('get_pending_transactions', { walletId, limit: 1 }, context);
    expect(mocks.assistantReadRepository.findPendingTransactions).toHaveBeenCalledWith(walletId, 2);
    expect(pending.truncation).toMatchObject({ truncated: true, rowLimit: 1, returnedRows: 1 });
    expect(pending.data.transactions).toEqual([
      expect.objectContaining({ labels: ['queued'], timeInQueueSeconds: 60 }),
    ]);

    mocks.assistantReadRepository.findWalletTransactionDetail.mockResolvedValue({
      ...pendingTransaction('detail-1'),
      txid,
      wallet: { id: walletId, name: 'Treasury', type: 'multi_sig', network: 'mainnet' },
      address: { id: 'addr-1', address: 'bc1qsource', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: true },
      inputs: [{ id: 'input-1', inputIndex: 0, txid: 'prev', vout: 1, address: 'bc1qsource', amount: 1500n }],
      outputs: [{ id: 'output-1', outputIndex: 0, address: 'bc1qdest', amount: 1000n, outputType: 'recipient', isOurs: false }],
    });

    const detail = await assistantReadToolRegistry.execute(
      'get_transaction_detail',
      { walletId, txid: txid.toUpperCase() },
      context
    );

    expect(mocks.assistantReadRepository.findWalletTransactionDetail).toHaveBeenCalledWith(walletId, txid);
    expect(detail.sensitivity).toBe('high');
    expect(detail.redactions).toContain('raw_transaction_hex');
    expect(detail.data.transaction).toMatchObject({
      txid,
      wallet: { id: walletId, name: 'Treasury' },
      inputs: [{ amount: '1500' }],
      outputs: [{ amount: '1000', outputType: 'recipient' }],
    });
  });

  it('reads UTXO and address summaries plus one high-sensitivity address detail', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getUtxoSummary.mockResolvedValue(utxoSummary());
    const utxos = await assistantReadToolRegistry.execute('get_utxo_summary', { walletId }, context);
    expect(utxos.data).toMatchObject({
      summary: {
        total: { count: 5, amountSats: '12000' },
        spendable: { count: 3, amountSats: '9000' },
        lockedByDraft: { count: 1, amountSats: '3000' },
      },
    });

    mocks.assistantReadRepository.getAddressSummary.mockResolvedValue(addressSummary());
    const addresses = await assistantReadToolRegistry.execute('get_address_summary', { walletId }, context);
    expect(addresses.data).toMatchObject({
      summary: { totalAddresses: 8, usedCount: 3, unusedCount: 5, totalBalanceSats: '12000' },
    });

    mocks.assistantReadRepository.findAddressDetail.mockResolvedValue({
      address: {
        id: 'addr-1',
        walletId,
        address: 'bc1qdetail',
        derivationPath: "m/84'/0'/0'/1/7",
        index: 7,
        used: true,
        addressLabels: [{ label: { name: 'deposit' } }],
        _count: { transactions: 4 },
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
      },
      balance: { _count: { id: 2 }, _sum: { amount: 4000n } },
    });

    const detail = await assistantReadToolRegistry.execute(
      'get_address_detail',
      { walletId, address: 'bc1qdetail' },
      context
    );

    expect(detail.sensitivity).toBe('high');
    expect(detail.data.address).toMatchObject({
      address: 'bc1qdetail',
      labels: ['deposit'],
      isChange: true,
      transactionCount: 4,
      balance: { unspentSats: '4000', unspentUtxoCount: 2 },
    });

    mocks.assistantReadRepository.findAddressDetail.mockResolvedValue({
      address: {
        id: 'addr-2',
        walletId,
        address: 'bc1qreceive',
        derivationPath: "m/84'/0'/0'/0/8",
        index: 8,
        used: false,
        addressLabels: [],
        _count: {},
        createdAt: null,
      },
      balance: { _count: {}, _sum: {} },
    });

    const idLookup = await assistantReadToolRegistry.execute(
      'get_address_detail',
      { walletId, addressId: '33333333-3333-4333-8333-333333333333' },
      context
    );

    expect(mocks.assistantReadRepository.findAddressDetail).toHaveBeenLastCalledWith(walletId, {
      addressId: '33333333-3333-4333-8333-333333333333',
      address: undefined,
    });
    expect(idLookup.data.address).toMatchObject({
      id: 'addr-2',
      isChange: false,
      transactionCount: 0,
      balance: { unspentSats: '0', unspentUtxoCount: 0 },
    });
  });

  it('fails closed for invalid detail lookups and not-found records', async () => {
    const context = createContext();

    await expect(
      assistantReadToolRegistry.execute('get_address_detail', { walletId }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assistantReadToolRegistry.execute('get_address_detail', { walletId, addressId: walletId, address: 'bc1q' }, context)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(context.authorizeWalletAccess).not.toHaveBeenCalled();

    mocks.assistantReadRepository.findAddressDetail.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_address_detail', { walletId, address: 'bc1qmissing' }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.assistantReadRepository.findWalletTransactionDetail.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_transaction_detail', { walletId, txid }, context)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
