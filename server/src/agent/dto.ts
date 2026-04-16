import type { AgentApiKey, WalletAgent } from '../generated/prisma/client';
import type { WalletAgentWithDetails } from '../repositories/agentRepository';
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
