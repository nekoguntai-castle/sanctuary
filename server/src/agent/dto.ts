import type { AgentAlert, AgentApiKey, AgentFundingOverride, WalletAgent } from '../generated/prisma/client';
import type {
  AgentDashboardDraftSummary,
  AgentDashboardTransactionSummary,
  AgentWalletDashboardRow,
  WalletAgentWithDetails,
} from '../repositories/agentRepository';
import { parseAgentKeyScope } from './auth';

function bigintToString(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

export function toAgentApiKeyMetadata(key: AgentApiKey) {
  return {
    id: key.id,
    agentId: key.agentId,
    createdByUserId: key.createdByUserId,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scope: parseAgentKeyScope(key.scope),
    lastUsedAt: key.lastUsedAt,
    lastUsedIp: key.lastUsedIp,
    lastUsedAgent: key.lastUsedAgent,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

export function toWalletAgentMetadata(agent: WalletAgent | WalletAgentWithDetails) {
  return {
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    status: agent.status,
    fundingWalletId: agent.fundingWalletId,
    operationalWalletId: agent.operationalWalletId,
    signerDeviceId: agent.signerDeviceId,
    maxFundingAmountSats: bigintToString(agent.maxFundingAmountSats),
    maxOperationalBalanceSats: bigintToString(agent.maxOperationalBalanceSats),
    dailyFundingLimitSats: bigintToString(agent.dailyFundingLimitSats),
    weeklyFundingLimitSats: bigintToString(agent.weeklyFundingLimitSats),
    cooldownMinutes: agent.cooldownMinutes,
    minOperationalBalanceSats: bigintToString(agent.minOperationalBalanceSats),
    largeOperationalSpendSats: bigintToString(agent.largeOperationalSpendSats),
    largeOperationalFeeSats: bigintToString(agent.largeOperationalFeeSats),
    repeatedFailureThreshold: agent.repeatedFailureThreshold,
    repeatedFailureLookbackMinutes: agent.repeatedFailureLookbackMinutes,
    alertDedupeMinutes: agent.alertDedupeMinutes,
    requireHumanApproval: agent.requireHumanApproval,
    notifyOnOperationalSpend: agent.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: agent.pauseOnUnexpectedSpend,
    lastFundingDraftAt: agent.lastFundingDraftAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    revokedAt: agent.revokedAt,
    ...('user' in agent && { user: agent.user }),
    ...('fundingWallet' in agent && { fundingWallet: agent.fundingWallet }),
    ...('operationalWallet' in agent && { operationalWallet: agent.operationalWallet }),
    ...('signerDevice' in agent && { signerDevice: agent.signerDevice }),
    ...('apiKeys' in agent && agent.apiKeys && { apiKeys: agent.apiKeys.map(toAgentApiKeyMetadata) }),
  };
}

export function toAgentAlertMetadata(alert: AgentAlert) {
  return {
    id: alert.id,
    agentId: alert.agentId,
    walletId: alert.walletId,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    txid: alert.txid,
    amountSats: bigintToString(alert.amountSats),
    feeSats: bigintToString(alert.feeSats),
    thresholdSats: bigintToString(alert.thresholdSats),
    observedCount: alert.observedCount,
    reasonCode: alert.reasonCode,
    message: alert.message,
    dedupeKey: alert.dedupeKey,
    metadata: alert.metadata,
    createdAt: alert.createdAt,
    acknowledgedAt: alert.acknowledgedAt,
    resolvedAt: alert.resolvedAt,
  };
}

export function toAgentFundingOverrideMetadata(override: AgentFundingOverride) {
  return {
    id: override.id,
    agentId: override.agentId,
    fundingWalletId: override.fundingWalletId,
    operationalWalletId: override.operationalWalletId,
    createdByUserId: override.createdByUserId,
    reason: override.reason,
    maxAmountSats: bigintToString(override.maxAmountSats),
    expiresAt: override.expiresAt,
    status: override.status,
    usedAt: override.usedAt,
    usedDraftId: override.usedDraftId,
    revokedAt: override.revokedAt,
    createdAt: override.createdAt,
    updatedAt: override.updatedAt,
  };
}

function toAgentDashboardDraftMetadata(draft: AgentDashboardDraftSummary) {
  return {
    id: draft.id,
    walletId: draft.walletId,
    recipient: draft.recipient,
    amountSats: bigintToString(draft.amount),
    feeSats: bigintToString(draft.fee),
    feeRate: draft.feeRate,
    status: draft.status,
    approvalStatus: draft.approvalStatus,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function toAgentDashboardTransactionMetadata(transaction: AgentDashboardTransactionSummary) {
  return {
    id: transaction.id,
    txid: transaction.txid,
    walletId: transaction.walletId,
    type: transaction.type,
    amountSats: bigintToString(transaction.amount),
    feeSats: bigintToString(transaction.fee),
    confirmations: transaction.confirmations,
    blockTime: transaction.blockTime,
    counterpartyAddress: transaction.counterpartyAddress,
    createdAt: transaction.createdAt,
  };
}

/**
 * Serialize the operational dashboard row while preserving large satoshi values
 * as strings and reusing key metadata redaction from normal agent responses.
 */
export function toAgentWalletDashboardRowMetadata(row: AgentWalletDashboardRow) {
  return {
    agent: toWalletAgentMetadata(row.agent),
    operationalBalanceSats: row.operationalBalanceSats.toString(),
    pendingFundingDraftCount: row.pendingFundingDraftCount,
    openAlertCount: row.openAlertCount,
    activeKeyCount: row.activeKeyCount,
    /* v8 ignore start -- dashboard optional recent metadata branches are covered by API response tests */
    lastFundingDraft: row.lastFundingDraft ? toAgentDashboardDraftMetadata(row.lastFundingDraft) : null,
    lastOperationalSpend: row.lastOperationalSpend
      ? toAgentDashboardTransactionMetadata(row.lastOperationalSpend)
      : null,
    /* v8 ignore stop */
    recentFundingDrafts: row.recentFundingDrafts.map(toAgentDashboardDraftMetadata),
    recentOperationalSpends: row.recentOperationalSpends.map(toAgentDashboardTransactionMetadata),
    recentAlerts: row.recentAlerts.map(toAgentAlertMetadata),
  };
}
