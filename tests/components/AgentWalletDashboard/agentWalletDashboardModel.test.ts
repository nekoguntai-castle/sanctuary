import { describe, expect, it } from 'vitest';
import type { AgentWalletDashboardRow, WalletAgentMetadata } from '../../../src/api/admin';
import {
  buildDashboardTotals,
  canSpendNow,
  findSpendDestinationClassification,
  formatDateTime,
  formatDestinationClassification,
  formatSats,
  formatTxid,
  formatUnknownDestinationHandling,
  formatWalletType,
  getActiveApiKeys,
  getAgentStatusBadgeKind,
  isAgentRevoked,
  isKeyActive,
  metadataString,
  orderAgentWalletRows,
} from '../../../components/AgentWalletDashboard/agentWalletDashboardModel';

function makeAgent(overrides: Partial<WalletAgentMetadata> = {}): WalletAgentMetadata {
  return {
    id: 'agent-1',
    userId: 'user-1',
    name: 'Agent One',
    status: 'active',
    fundingWalletId: 'funding-1',
    operationalWalletId: 'operational-1',
    signerDeviceId: 'device-1',
    maxFundingAmountSats: null,
    maxOperationalBalanceSats: null,
    dailyFundingLimitSats: null,
    weeklyFundingLimitSats: null,
    cooldownMinutes: 0,
    minOperationalBalanceSats: null,
    largeOperationalSpendSats: null,
    largeOperationalFeeSats: null,
    repeatedFailureThreshold: 0,
    repeatedFailureLookbackMinutes: 0,
    alertDedupeMinutes: 0,
    requireHumanApproval: false,
    notifyOnOperationalSpend: false,
    pauseOnUnexpectedSpend: false,
    lastFundingDraftAt: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    revokedAt: null,
    user: { id: 'user-1', username: 'alice', isAdmin: false },
    fundingWallet: null,
    operationalWallet: null,
    signerDevice: null,
    apiKeys: [],
    ...overrides,
  } as WalletAgentMetadata;
}

function makeRow(overrides: Partial<AgentWalletDashboardRow> & { agent?: Partial<WalletAgentMetadata> } = {}): AgentWalletDashboardRow {
  const { agent: agentOverrides, ...rowOverrides } = overrides;

  return {
    agent: makeAgent(agentOverrides),
    operationalBalanceSats: '100',
    pendingFundingDraftCount: 0,
    openAlertCount: 0,
    activeKeyCount: 0,
    lastFundingDraft: null,
    lastOperationalSpend: null,
    recentFundingDrafts: [],
    recentOperationalSpends: [],
    recentAlerts: [],
    ...rowOverrides,
  } as AgentWalletDashboardRow;
}

describe('agentWalletDashboardModel', () => {
  it('formats values and fallback labels', () => {
    expect(formatSats(undefined)).toBe('0 sats');
    expect(formatSats('1234567')).toBe('1,234,567 sats');
    expect(formatSats('not-a-number')).toBe('not-a-number sats');

    expect(formatDateTime(null)).toBe('Never');
    expect(formatDateTime('not-a-date')).toBe('Unknown');
    expect(formatDateTime('2026-04-16T00:00:00.000Z')).not.toMatch(/Never|Unknown/);

    expect(formatWalletType('multi_sig')).toBe('Multisig');
    expect(formatWalletType('single_sig')).toBe('Single sig');
    expect(formatWalletType('taproot')).toBe('taproot');
    expect(formatWalletType(undefined)).toBe('Wallet');

    expect(formatTxid('shorttx')).toBe('shorttx');
    expect(formatTxid('a'.repeat(64))).toBe('aaaaaaaa...aaaaaaaa');
  });

  it('formats metadata labels and finds spend classifications', () => {
    expect(metadataString(null, 'destinationClassification')).toBeNull();
    expect(metadataString({ destinationClassification: 123 }, 'destinationClassification')).toBeNull();
    expect(metadataString({ destinationClassification: '   ' }, 'destinationClassification')).toBeNull();
    expect(metadataString({ destinationClassification: 'external_spend' }, 'destinationClassification')).toBe('external_spend');

    expect(formatDestinationClassification(null)).toBeNull();
    expect(formatDestinationClassification({ destinationClassification: 'unknown_destination' })).toBe('Unknown destination');
    expect(formatDestinationClassification({ destinationClassification: 'custom_mode' })).toBe('custom mode');

    expect(formatUnknownDestinationHandling(null)).toBeNull();
    expect(formatUnknownDestinationHandling({ unknownDestinationHandlingMode: 'notify_and_pause' })).toBe('Notify and pause');
    expect(formatUnknownDestinationHandling({ unknownDestinationHandlingMode: 'custom_mode' })).toBe('custom mode');

    const spend = { id: 'tx-1', txid: 'txid-1' };
    const matchingAlerts = [
      { txid: 'different', metadata: { destinationClassification: 'external_spend' } },
      { txid: 'txid-1', metadata: { destinationClassification: 'known_self_transfer' } },
    ];
    const unmatchedAlerts = [{ txid: 'txid-1', metadata: {} }];

    expect(findSpendDestinationClassification(spend as any, matchingAlerts as any)).toBe('Known self-transfer');
    expect(findSpendDestinationClassification(spend as any, unmatchedAlerts as any)).toBeNull();
  });

  it('derives key, status, and spend readiness state', () => {
    const now = new Date('2026-04-16T00:00:00.000Z').getTime();

    expect(isKeyActive({ revokedAt: '2026-04-15T00:00:00.000Z' } as any, now)).toBe(false);
    expect(isKeyActive({ expiresAt: null, revokedAt: null } as any, now)).toBe(true);
    expect(isKeyActive({ expiresAt: '2026-04-17T00:00:00.000Z', revokedAt: null } as any, now)).toBe(true);
    expect(isKeyActive({ expiresAt: '2026-04-15T00:00:00.000Z', revokedAt: null } as any, now)).toBe(false);
    expect(isKeyActive({ expiresAt: 'not-a-date', revokedAt: null } as any, now)).toBe(false);

    expect(getActiveApiKeys(makeAgent({ apiKeys: undefined as any }))).toEqual([]);
    expect(isAgentRevoked(makeAgent({ status: 'revoked' }))).toBe(true);
    expect(isAgentRevoked(makeAgent({ revokedAt: '2026-04-16T00:00:00.000Z' }))).toBe(true);
    expect(isAgentRevoked(makeAgent())).toBe(false);

    expect(getAgentStatusBadgeKind(makeAgent())).toBe('active');
    expect(getAgentStatusBadgeKind(makeAgent({ status: 'paused' }))).toBe('paused');
    expect(getAgentStatusBadgeKind(makeAgent({ revokedAt: '2026-04-16T00:00:00.000Z' }))).toBe('revoked');

    expect(canSpendNow(makeRow({ operationalBalanceSats: '1' }))).toBe(true);
    expect(canSpendNow(makeRow({ agent: { status: 'paused' } }))).toBe(false);
    expect(canSpendNow(makeRow({ agent: { revokedAt: '2026-04-16T00:00:00.000Z' } }))).toBe(false);
    expect(canSpendNow(makeRow({ operationalBalanceSats: '0' }))).toBe(false);
    expect(canSpendNow(makeRow({ operationalBalanceSats: 'bad-balance' }))).toBe(false);
  });

  it('orders rows and totals dashboard state', () => {
    const alpha = makeRow({
      agent: { id: 'agent-alpha', name: 'Alpha' },
      operationalBalanceSats: '200',
      pendingFundingDraftCount: 1,
      openAlertCount: 0,
    });
    const beta = makeRow({
      agent: { id: 'agent-beta', name: 'Beta' },
      operationalBalanceSats: 'bad-balance',
      pendingFundingDraftCount: 0,
      openAlertCount: 2,
    });
    const gamma = makeRow({
      agent: { id: 'agent-gamma', name: 'Gamma', status: 'paused' },
      operationalBalanceSats: '300',
      pendingFundingDraftCount: 1,
      openAlertCount: 1,
    });

    expect(orderAgentWalletRows([alpha, beta, gamma]).map(row => row.agent.name)).toEqual(['Beta', 'Gamma', 'Alpha']);

    expect(buildDashboardTotals([alpha, beta, gamma])).toEqual({
      spendReady: 1,
      pendingDrafts: 2,
      openAlerts: 3,
      operationalBalance: 500n,
    });
  });
});
