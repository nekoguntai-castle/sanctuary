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
    findWalletLabelsForAssistant: vi.fn(),
    findWalletLabelDetailForAssistant: vi.fn(),
    findWalletPoliciesForAssistant: vi.fn(),
    findWalletPolicyDetailForAssistant: vi.fn(),
    findWalletPolicyEventsForAssistant: vi.fn(),
    findDraftDetailForAssistant: vi.fn(),
    findWalletInsightsForAssistant: vi.fn(),
    findWalletInsightDetailForAssistant: vi.fn(),
    findAdminAgentDashboardRowsForAssistant: vi.fn(),
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
const labelId = '33333333-3333-4333-8333-333333333333';
const policyId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const insightId = '66666666-6666-4666-8666-666666666666';

function createContext(isAdmin = false): AssistantToolContext & {
  authorizeWalletAccess: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'test',
    actor: { userId: 'user-1', username: 'alice', isAdmin },
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function labelRow(id = labelId) {
  return {
    id,
    walletId,
    name: id === labelId ? 'Treasury' : 'Travel',
    color: '#00aa88',
    description: null,
    _count: { transactionLabels: 2, addressLabels: 1 },
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: policyId,
    walletId,
    groupId: null,
    name: 'Large spend',
    description: null,
    type: 'approval_required',
    config: {
      trigger: { amountAbove: 1_000_000 },
      requiredApprovals: 2,
      quorumType: 'specific',
      allowSelfApproval: false,
      expirationHours: 24,
      specificApprovers: ['user-a', 'user-b'],
    },
    priority: 1,
    enforcement: 'enforce',
    enabled: true,
    sourceType: 'wallet',
    sourceId: null,
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    ...overrides,
  };
}

function draftRow() {
  return {
    id: draftId,
    walletId,
    userId: 'user-1',
    recipient: 'bc1qrecipient',
    amount: 1000n,
    feeRate: 12.5,
    selectedUtxoIds: ['txid:0'],
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    outputs: [{ address: 'bc1qrecipient', amount: 1000 }],
    inputs: [{ txid: 'secret', vout: 0 }],
    decoyOutputs: null,
    payjoinUrl: 'https://example.invalid',
    isRBF: false,
    label: 'Payment',
    memo: 'memo',
    psbtBase64: 'do-not-return',
    signedPsbtBase64: 'do-not-return-signed',
    fee: 120n,
    totalInput: 1200n,
    totalOutput: 1000n,
    changeAmount: 80n,
    changeAddress: 'bc1qchange',
    effectiveAmount: 1000n,
    inputPaths: ['m/84h/0h/0h/0/0'],
    status: 'partial',
    approvalStatus: 'pending',
    signedDeviceIds: ['device-1'],
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    approvalRequests: [
      {
        id: 'approval-1',
        policyId,
        status: 'pending',
        requiredApprovals: 2,
        quorumType: 'any_n',
        allowSelfApproval: false,
        expiresAt: null,
        resolvedAt: null,
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        votes: [{ userId: 'do-not-return', reason: 'do-not-return' }],
      },
    ],
    utxoLocks: [{ id: 'lock-1', createdAt: new Date('2026-04-25T00:00:00.000Z'), utxo: { id: 'utxo-1' } }],
  };
}

function insightRow(id = insightId) {
  return {
    id,
    walletId,
    type: 'utxo_health',
    severity: 'warning',
    title: id === insightId ? 'Fragmented UTXOs' : 'Fee timing',
    summary: 'Wallet has many small UTXOs.',
    analysis: 'Detailed analysis visible in detail view.',
    data: { raw: 'do-not-return' },
    status: 'active',
    expiresAt: null,
    notifiedAt: null,
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

describe('read-tool parity batch 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists labels with wallet authorization and row-limit truncation', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletLabelsForAssistant.mockResolvedValue([
      labelRow(labelId),
      labelRow('77777777-7777-4777-8777-777777777777'),
      labelRow('88888888-8888-4888-8888-888888888888'),
    ]);

    const envelope = await assistantReadToolRegistry.execute('list_labels', { walletId, limit: 2 }, context);

    expect(context.authorizeWalletAccess).toHaveBeenCalledWith(walletId);
    expect(mocks.assistantReadRepository.findWalletLabelsForAssistant).toHaveBeenCalledWith(walletId, {
      query: undefined,
      limit: 3,
    });
    expect(envelope.data).toMatchObject({ walletId, count: 2 });
    expect(envelope.truncation).toMatchObject({ truncated: true, returnedRows: 2 });
  });

  it('returns label detail while omitting address derivation paths', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletLabelDetailForAssistant.mockResolvedValue({
      ...labelRow(),
      _count: { transactionLabels: 1, addressLabels: 1 },
      transactionLabels: [{
        transaction: {
          id: 'tx-1',
          txid: 'a'.repeat(64),
          type: 'sent',
          amount: -1000n,
          confirmations: 0,
          blockTime: null,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
        },
      }],
      addressLabels: [{
        address: {
          id: 'addr-1',
          address: 'bc1qraw',
          derivationPath: 'm/84h/0h/0h/0/0',
          index: 0,
          used: true,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
        },
      }],
    });

    const envelope = await assistantReadToolRegistry.execute('get_label_detail', { walletId, labelId }, context);
    const label = (envelope.data as any).label;

    expect(label.addresses[0]).toMatchObject({ address: 'bc1qraw', used: true });
    expect(label.addresses[0]).not.toHaveProperty('derivationPath');
    expect(envelope.redactions).toContain('address_derivation_paths');

    mocks.assistantReadRepository.findWalletLabelDetailForAssistant.mockResolvedValueOnce({
      ...labelRow(),
      _count: { transactionLabels: 2, addressLabels: 1 },
      transactionLabels: [{
        transaction: {
          id: 'tx-1',
          txid: 'a'.repeat(64),
          type: 'sent',
          amount: -1000n,
          confirmations: 0,
          blockTime: null,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
        },
      }],
      addressLabels: [{
        address: {
          id: 'addr-1',
          address: 'bc1qraw',
          index: 0,
          used: true,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
        },
      }],
    });

    const truncated = await assistantReadToolRegistry.execute('get_label_detail', { walletId, labelId }, context);
    expect(truncated.truncation).toMatchObject({
      truncated: true,
      reason: 'row_limit',
      rowLimit: 100,
      returnedRows: 2,
    });
  });

  it('sanitizes policy configs and policy event details', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletPoliciesForAssistant.mockResolvedValue({
      wallet: { id: walletId },
      policies: [policyRow()],
    });
    mocks.assistantReadRepository.findWalletPolicyDetailForAssistant.mockResolvedValue({
      policy: policyRow(),
      addresses: [{
        id: 'policy-address-1',
        policyId,
        address: 'bc1qallow',
        label: 'Vendor',
        listType: 'allow',
        addedBy: 'do-not-return',
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
      }],
      recentEvents: [{
        id: 'event-1',
        policyId,
        walletId,
        draftTransactionId: draftId,
        userId: 'do-not-return',
        eventType: 'triggered',
        details: { reason: 'amount', recipient: 'bc1qraw' },
        createdAt: new Date('2026-04-26T00:00:00.000Z'),
      }],
      eventTotal: 1,
    });

    const list = await assistantReadToolRegistry.execute('list_policies', { walletId }, context);
    const policy = (list.data as any).policies[0];
    expect(policy.config).toMatchObject({ specificApproverCount: 2 });
    expect(JSON.stringify(policy.config)).not.toContain('user-a');

    const detail = await assistantReadToolRegistry.execute(
      'get_policy_detail',
      { walletId, policyId, listType: 'allow' },
      context
    );
    const event = (detail.data as any).recentEvents[0];
    expect(detail.truncation.truncated).toBe(false);
    expect(mocks.assistantReadRepository.findWalletPolicyDetailForAssistant).toHaveBeenCalledWith(
      walletId,
      policyId,
      'allow'
    );
    expect(event).toMatchObject({ detailKeys: ['reason', 'recipient'] });
    expect(event).not.toHaveProperty('details');
    expect((detail.data as any).addresses[0]).not.toHaveProperty('addedBy');
    expect(detail.redactions).toEqual(expect.arrayContaining(['policy_user_id_lists', 'policy_event_details']));
  });

  it('handles policy, label, draft, and insight not-found paths plus policy event pagination', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletPoliciesForAssistant.mockResolvedValue({ wallet: null, policies: [] });
    await expect(
      assistantReadToolRegistry.execute('list_policies', { walletId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.assistantReadRepository.findWalletPolicyDetailForAssistant.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_policy_detail', { walletId, policyId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.assistantReadRepository.findWalletPolicyEventsForAssistant.mockResolvedValue({
      total: 2,
      events: [
        { id: 'event-1', walletId, policyId, eventType: 'triggered', details: {}, createdAt: new Date('2026-04-26T00:00:00.000Z') },
        { id: 'event-2', walletId, policyId, eventType: 'approved', details: {}, createdAt: new Date('2026-04-26T01:00:00.000Z') },
      ],
    });
    const events = await assistantReadToolRegistry.execute(
      'get_policy_events',
      {
        walletId,
        policyId,
        eventType: 'triggered',
        dateFrom: '2026-04-25T00:00:00.000Z',
        dateTo: '2026-04-27T00:00:00.000Z',
        limit: 1,
      },
      context
    );
    expect(events.truncation.truncated).toBe(true);

    mocks.assistantReadRepository.findWalletLabelDetailForAssistant.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_label_detail', { walletId, labelId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.assistantReadRepository.findDraftDetailForAssistant.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_draft_detail', { walletId, draftId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.assistantReadRepository.findWalletInsightDetailForAssistant.mockResolvedValue(null);
    await expect(
      assistantReadToolRegistry.execute('get_insight_detail', { walletId, insightId }, context)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns draft detail without PSBTs, input paths, or vote identities', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findDraftDetailForAssistant.mockResolvedValue(draftRow());

    const envelope = await assistantReadToolRegistry.execute('get_draft_detail', { walletId, draftId }, context);
    const draft = (envelope.data as any).draft;

    expect(draft).toMatchObject({
      id: draftId,
      recipient: 'bc1qrecipient',
      signedDeviceCount: 1,
      selectedUtxoCount: 1,
      lockedUtxoCount: 1,
      approvalRequests: [expect.objectContaining({ voteCount: 1 })],
    });
    expect(draft).not.toHaveProperty('psbtBase64');
    expect(draft).not.toHaveProperty('signedPsbtBase64');
    expect(draft).not.toHaveProperty('inputPaths');
    expect(JSON.stringify(draft)).not.toContain('do-not-return');
    expect(envelope.redactions).toContain('draft_psbt_material');
  });

  it('lists insight summaries separately from detailed analysis', async () => {
    const context = createContext();
    mocks.assistantReadRepository.findWalletInsightsForAssistant.mockResolvedValue([
      insightRow(insightId),
      insightRow('99999999-9999-4999-8999-999999999999'),
    ]);
    mocks.assistantReadRepository.findWalletInsightDetailForAssistant.mockResolvedValue(insightRow());

    const list = await assistantReadToolRegistry.execute('list_insights', { walletId, limit: 1 }, context);
    const listed = (list.data as any).insights[0];
    expect(listed).toMatchObject({ title: 'Fragmented UTXOs', severity: 'warning' });
    expect(listed).not.toHaveProperty('analysis');
    expect(listed).not.toHaveProperty('data');
    expect(list.truncation.truncated).toBe(true);

    const detail = await assistantReadToolRegistry.execute('get_insight_detail', { walletId, insightId }, context);
    expect((detail.data as any).insight).toMatchObject({
      analysis: 'Detailed analysis visible in detail view.',
    });
    expect((detail.data as any).insight).not.toHaveProperty('data');
  });

  it('returns cached market status without external fetches', async () => {
    const context = createContext();
    mocks.assistantReadRepository.getLatestFeeEstimate.mockResolvedValue({
      fastest: 10,
      halfHour: 8,
      hour: 5,
      createdAt: new Date('2026-04-26T11:59:00.000Z'),
    });
    mocks.assistantReadRepository.getLatestPrice
      .mockResolvedValueOnce({ currency: 'USD', price: 65000, source: 'test', createdAt: new Date('2026-04-26T11:59:00.000Z') })
      .mockResolvedValueOnce({ currency: 'EUR', price: 60000, source: 'test', createdAt: new Date('2026-04-26T11:00:00.000Z') });

    const envelope = await assistantReadToolRegistry.execute(
      'get_market_status',
      { currencies: ['usd', 'EUR', 'USD'] },
      context
    );

    expect(mocks.assistantReadRepository.getLatestPrice).toHaveBeenCalledTimes(2);
    expect(envelope.data).toMatchObject({
      currencies: ['USD', 'EUR'],
      fees: expect.objectContaining({ available: true, stale: false }),
      prices: [
        expect.objectContaining({ currency: 'USD', stale: false }),
        expect.objectContaining({ currency: 'EUR', stale: true }),
      ],
    });

    mocks.assistantReadRepository.getLatestPrice.mockResolvedValueOnce(null);
    const noFees = await assistantReadToolRegistry.execute(
      'get_market_status',
      { currencies: ['GBP'], includeFees: false },
      context
    );
    expect(noFees.data).toMatchObject({
      currencies: ['GBP'],
      fees: null,
      prices: [expect.objectContaining({ available: false, currency: 'GBP' })],
    });
    expect(mocks.assistantReadRepository.getLatestFeeEstimate).toHaveBeenCalledTimes(1);
  });

  it('requires admin access and redacts agent secrets from admin summaries', async () => {
    const nonAdmin = createContext(false);
    await expect(
      assistantReadToolRegistry.execute('get_admin_operational_summary', {}, nonAdmin)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.assistantReadRepository.findAdminAgentDashboardRowsForAssistant).not.toHaveBeenCalled();

    const admin = createContext(true);
    mocks.assistantReadRepository.findAdminAgentDashboardRowsForAssistant.mockResolvedValue([{
      agent: {
        id: 'agent-1',
        userId: 'do-not-return',
        name: 'Ops agent',
        status: 'active',
        fundingWallet: { id: walletId, name: 'Funding', type: 'multisig', network: 'mainnet' },
        operationalWallet: { id: '22222222-2222-4222-8222-222222222222', name: 'Ops', type: 'single_sig', network: 'mainnet' },
        signerDevice: { id: 'device-1', fingerprint: 'do-not-return' },
        apiKeys: [{ keyHash: 'do-not-return' }],
        requireHumanApproval: true,
        notifyOnOperationalSpend: true,
        pauseOnUnexpectedSpend: false,
        lastFundingDraftAt: null,
        revokedAt: null,
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: '2026-04-26T00:00:00.000Z',
      },
      operationalBalanceSats: 1234n,
      pendingFundingDraftCount: 1,
      openAlertCount: 2,
      activeKeyCount: 1,
      recentFundingDrafts: [{}],
      recentOperationalSpends: [{}],
      recentAlerts: [{ severity: 'warning' }, { severity: 'critical' }],
    }, {
      agent: {
        id: 'agent-2',
        name: 'No wallet agent',
        status: 'revoked',
        fundingWallet: null,
        operationalWallet: null,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
        lastFundingDraftAt: '2026-04-25T00:00:00.000Z',
        revokedAt: new Date('2026-04-26T00:00:00.000Z'),
        createdAt: null,
        updatedAt: null,
      },
      operationalBalanceSats: 0n,
      pendingFundingDraftCount: 0,
      openAlertCount: 0,
      activeKeyCount: 0,
      recentFundingDrafts: [],
      recentOperationalSpends: [],
      recentAlerts: [],
    }]);

    const envelope = await assistantReadToolRegistry.execute('get_admin_operational_summary', {}, admin);
    const serialized = JSON.stringify(envelope.data);
    expect(mocks.assistantReadRepository.findAdminAgentDashboardRowsForAssistant).toHaveBeenCalledWith(101);
    expect(envelope.data).toMatchObject({
      agentCount: 2,
      totalOperationalBalanceSats: '1234',
      pendingFundingDraftCount: 1,
      openAlertCount: 2,
    });
    expect(serialized).not.toContain('do-not-return');
    expect(envelope.redactions).toEqual(expect.arrayContaining(['agent_api_key_material', 'signer_device_fingerprints']));
  });
});
