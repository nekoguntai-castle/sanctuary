import type { AgentApiKeyMetadata, WalletAgentMetadata } from '../../../src/api/admin';
import {
  formatAlertLimit,
  formatDateTime,
  formatLimit,
  formatNumberLimit,
  formatWalletType,
} from '../formatters';

export type InfoBlockViewModel = {
  label: string;
  value: string;
  helper?: string;
};

export type SummaryItem = {
  label: string;
  value: string;
};

export function getActiveAgentKeys(agent: WalletAgentMetadata): AgentApiKeyMetadata[] {
  return (agent.apiKeys ?? []).filter(key => !key.revokedAt);
}

export function isAgentRevoked(agent: WalletAgentMetadata): boolean {
  return agent.status === 'revoked' || Boolean(agent.revokedAt);
}

export function getAgentInfoBlocks(agent: WalletAgentMetadata): InfoBlockViewModel[] {
  return [
    { label: 'User', value: agent.user?.username ?? agent.userId },
    { label: 'Funding wallet', value: agent.fundingWallet?.name ?? agent.fundingWalletId, helper: getWalletTypeLabel(agent.fundingWallet?.type) },
    { label: 'Operational wallet', value: agent.operationalWallet?.name ?? agent.operationalWalletId, helper: getWalletTypeLabel(agent.operationalWallet?.type) },
    { label: 'Signer', value: agent.signerDevice?.label ?? agent.signerDeviceId, helper: agent.signerDevice?.fingerprint },
  ];
}

export function getPolicySummary(agent: WalletAgentMetadata): SummaryItem[] {
  return [
    { label: 'Request cap', value: formatLimit(agent.maxFundingAmountSats) },
    { label: 'Balance cap', value: formatLimit(agent.maxOperationalBalanceSats) },
    { label: 'Daily cap', value: formatLimit(agent.dailyFundingLimitSats) },
    { label: 'Weekly cap', value: formatLimit(agent.weeklyFundingLimitSats) },
    { label: 'Cooldown', value: `${agent.cooldownMinutes ?? 0} min` },
  ];
}

export function getMonitoringSummary(agent: WalletAgentMetadata): SummaryItem[] {
  return [
    { label: 'Refill alert', value: formatAlertLimit(agent.minOperationalBalanceSats) },
    { label: 'Large spend', value: formatAlertLimit(agent.largeOperationalSpendSats) },
    { label: 'Large fee', value: formatAlertLimit(agent.largeOperationalFeeSats) },
    { label: 'Failure alerts', value: formatNumberLimit(agent.repeatedFailureThreshold, 'rejects') },
    { label: 'Dedupe', value: formatDedupeMinutes(agent.alertDedupeMinutes) },
  ];
}

export function getTimelineSummary(agent: WalletAgentMetadata, activeKeyCount: number): SummaryItem[] {
  return [
    { label: formatActiveKeyCount(activeKeyCount), value: '' },
    { label: 'Last draft', value: formatDateTime(agent.lastFundingDraftAt) },
    { label: 'Created', value: formatDateTime(agent.createdAt) },
  ];
}

function formatActiveKeyCount(activeKeyCount: number): string {
  return `${activeKeyCount} active key${activeKeyCount === 1 ? '' : 's'}`;
}

function formatDedupeMinutes(minutes: number | null): string {
  return minutes ? `${minutes} min` : 'Default';
}

function getWalletTypeLabel(type?: string): string | undefined {
  return type ? formatWalletType(type) : undefined;
}
