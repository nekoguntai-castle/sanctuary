import type {
  AgentApiKeyMetadata,
  AgentWalletDashboardRow,
  AgentWalletDashboardTransaction,
  WalletAgentMetadata,
} from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { createLogger } from '../../utils/logger';

const log = createLogger('AgentWalletDashboard');

const DESTINATION_CLASSIFICATION_LABELS: Record<string, string> = {
  external_spend: 'External spend',
  known_self_transfer: 'Known self-transfer',
  change_like_movement: 'Change-like movement',
  unknown_destination: 'Unknown destination',
};

const UNKNOWN_DESTINATION_HANDLING_LABELS: Record<string, string> = {
  notify_only: 'Notify only',
  pause_agent: 'Pause agent',
  notify_and_pause: 'Notify and pause',
  record_only: 'Record only',
};

export interface AgentWalletDashboardTotals {
  spendReady: number;
  pendingDrafts: number;
  openAlerts: number;
  operationalBalance: bigint;
}

export type AgentStatusBadgeKind = 'active' | 'paused' | 'revoked';

export function formatSats(value: string | null | undefined): string {
  if (!value) return '0 sats';
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

export function formatWalletType(type: string | undefined): string {
  if (type === 'multi_sig') return 'Multisig';
  if (type === 'single_sig') return 'Single sig';
  return type ?? 'Wallet';
}

export function formatTxid(txid: string): string {
  return txid.length > 16 ? `${txid.slice(0, 8)}...${txid.slice(-8)}` : txid;
}

export function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function formatDestinationClassification(metadata: Record<string, unknown> | null): string | null {
  const classification = metadataString(metadata, 'destinationClassification');
  if (!classification) return null;
  return DESTINATION_CLASSIFICATION_LABELS[classification] ?? classification.replace(/_/g, ' ');
}

export function formatUnknownDestinationHandling(metadata: Record<string, unknown> | null): string | null {
  const mode = metadataString(metadata, 'unknownDestinationHandlingMode');
  if (!mode) return null;
  return UNKNOWN_DESTINATION_HANDLING_LABELS[mode] ?? mode.replace(/_/g, ' ');
}

export function findSpendDestinationClassification(
  spend: AgentWalletDashboardTransaction,
  alerts: AgentWalletDashboardRow['recentAlerts']
): string | null {
  const matchingAlert = alerts.find(alert => alert.txid === spend.txid && formatDestinationClassification(alert.metadata));
  return matchingAlert ? formatDestinationClassification(matchingAlert.metadata) : null;
}

export function isKeyActive(key: AgentApiKeyMetadata, now = Date.now()): boolean {
  if (key.revokedAt) return false;
  if (!key.expiresAt) return true;
  return new Date(key.expiresAt).getTime() > now;
}

export function getActiveApiKeys(agent: WalletAgentMetadata): AgentApiKeyMetadata[] {
  return (agent.apiKeys ?? []).filter(key => isKeyActive(key));
}

export function isAgentRevoked(agent: WalletAgentMetadata): boolean {
  return agent.status === 'revoked' || Boolean(agent.revokedAt);
}

export function canSpendNow(row: AgentWalletDashboardRow): boolean {
  if (row.agent.status !== 'active' || isAgentRevoked(row.agent)) return false;
  try {
    return BigInt(row.operationalBalanceSats) > 0n;
  } catch {
    return false;
  }
}

export function getAgentStatusBadgeKind(agent: WalletAgentMetadata): AgentStatusBadgeKind {
  if (agent.status === 'active' && !agent.revokedAt) return 'active';
  if (agent.status === 'paused') return 'paused';
  return 'revoked';
}

export function getAgentAttentionCount(row: AgentWalletDashboardRow): number {
  return row.openAlertCount + row.pendingFundingDraftCount;
}

export function orderAgentWalletRows(rows: AgentWalletDashboardRow[]): AgentWalletDashboardRow[] {
  return [...rows].sort((a, b) => {
    const attentionDelta = getAgentAttentionCount(b) - getAgentAttentionCount(a);
    if (attentionDelta !== 0) return attentionDelta;
    return a.agent.name.localeCompare(b.agent.name);
  });
}

export function buildDashboardTotals(rows: AgentWalletDashboardRow[]): AgentWalletDashboardTotals {
  return rows.reduce<AgentWalletDashboardTotals>((totals, row) => {
    totals.spendReady += canSpendNow(row) ? 1 : 0;
    totals.pendingDrafts += row.pendingFundingDraftCount;
    totals.openAlerts += row.openAlertCount;
    totals.operationalBalance += parseOperationalBalance(row);
    return totals;
  }, {
    spendReady: 0,
    pendingDrafts: 0,
    openAlerts: 0,
    operationalBalance: 0n,
  });
}

function parseOperationalBalance(row: AgentWalletDashboardRow): bigint {
  try {
    return BigInt(row.operationalBalanceSats);
  } catch (error) {
    log.debug('Ignoring malformed operational balance in agent dashboard totals', {
      agentId: row.agent.id,
      operationalBalanceSats: row.operationalBalanceSats,
      error: extractErrorMessage(error, 'Invalid operational balance'),
    });
    return 0n;
  }
}
