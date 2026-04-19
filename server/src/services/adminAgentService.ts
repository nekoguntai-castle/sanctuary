import type { Prisma } from '../generated/prisma/client';
import { buildAgentKeyScope, generateAgentApiKey, getAgentApiKeyPrefix, hashAgentApiKey } from '../agent/auth';
import { InvalidInputError, NotFoundError } from '../errors/ApiError';
import {
  agentRepository,
  userRepository,
  walletRepository,
  type FindAgentAlertsFilter,
  type FindAgentFundingOverridesFilter,
  type FindWalletAgentsFilter,
  type UpdateWalletAgentInput,
} from '../repositories';

interface WalletAccessSource {
  users: Array<{ userId: string }>;
  group: { members: Array<{ userId: string }> } | null;
}

type WalletAgentStatus = 'active' | 'paused' | 'revoked';

export interface CreateWalletAgentServiceInput {
  userId: string;
  name: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  status?: WalletAgentStatus;
  maxFundingAmountSats?: bigint;
  maxOperationalBalanceSats?: bigint;
  dailyFundingLimitSats?: bigint;
  weeklyFundingLimitSats?: bigint;
  cooldownMinutes?: number;
  minOperationalBalanceSats?: bigint;
  largeOperationalSpendSats?: bigint;
  largeOperationalFeeSats?: bigint;
  repeatedFailureThreshold?: number;
  repeatedFailureLookbackMinutes?: number;
  alertDedupeMinutes?: number;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
}

export interface UpdateWalletAgentServiceInput {
  name?: string;
  status?: WalletAgentStatus;
  maxFundingAmountSats?: bigint | null;
  maxOperationalBalanceSats?: bigint | null;
  dailyFundingLimitSats?: bigint | null;
  weeklyFundingLimitSats?: bigint | null;
  cooldownMinutes?: number | null;
  minOperationalBalanceSats?: bigint | null;
  largeOperationalSpendSats?: bigint | null;
  largeOperationalFeeSats?: bigint | null;
  repeatedFailureThreshold?: number | null;
  repeatedFailureLookbackMinutes?: number | null;
  alertDedupeMinutes?: number | null;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
}

export interface CreateAgentFundingOverrideServiceInput {
  maxAmountSats: bigint;
  expiresAt: Date;
  reason: string;
}

export interface CreateAgentApiKeyServiceInput {
  name: string;
  allowedActions?: string[];
  expiresAt?: Date;
}

function collectWalletAccessUserIds(wallet: WalletAccessSource): string[] {
  return [...new Set([
    ...wallet.users.map(user => user.userId),
    ...(wallet.group?.members.map(member => member.userId) ?? []),
  ])];
}

async function validateAgentLink(input: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
}): Promise<void> {
  if (input.fundingWalletId === input.operationalWalletId) {
    throw new InvalidInputError('Funding wallet and operational wallet must be different');
  }

  const [targetUser, fundingWallet, operationalWallet, fundingWalletWithDevices] = await Promise.all([
    userRepository.findById(input.userId),
    walletRepository.findById(input.fundingWalletId),
    walletRepository.findById(input.operationalWalletId),
    walletRepository.findByIdWithSigningDevices(input.fundingWalletId),
  ]);

  if (!targetUser) {
    throw new NotFoundError('User not found');
  }
  if (!fundingWallet) {
    throw new NotFoundError('Funding wallet not found');
  }
  if (!operationalWallet) {
    throw new NotFoundError('Operational wallet not found');
  }
  if (fundingWallet.type !== 'multi_sig') {
    throw new InvalidInputError('Funding wallet must be a multisig wallet');
  }
  if (operationalWallet.type !== 'single_sig') {
    throw new InvalidInputError('Operational wallet must be a single-sig wallet');
  }
  if (fundingWallet.network !== operationalWallet.network) {
    throw new InvalidInputError('Funding wallet and operational wallet must use the same network');
  }

  const [hasFundingAccess, hasOperationalAccess] = await Promise.all([
    walletRepository.hasAccess(input.fundingWalletId, input.userId),
    walletRepository.hasAccess(input.operationalWalletId, input.userId),
  ]);
  if (!hasFundingAccess) {
    throw new InvalidInputError('User does not have access to the funding wallet');
  }
  if (!hasOperationalAccess) {
    throw new InvalidInputError('User does not have access to the operational wallet');
  }

  const signerDeviceIds = new Set((fundingWalletWithDevices?.devices ?? []).map(device => device.deviceId));
  if (!signerDeviceIds.has(input.signerDeviceId)) {
    throw new InvalidInputError('Signer device must belong to the funding wallet');
  }
}

function toAgentUpdateInput(
  input: UpdateWalletAgentServiceInput,
  existingRevokedAt: Date | null
): UpdateWalletAgentInput {
  return {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.maxFundingAmountSats !== undefined && { maxFundingAmountSats: input.maxFundingAmountSats }),
    ...(input.maxOperationalBalanceSats !== undefined && { maxOperationalBalanceSats: input.maxOperationalBalanceSats }),
    ...(input.dailyFundingLimitSats !== undefined && { dailyFundingLimitSats: input.dailyFundingLimitSats }),
    ...(input.weeklyFundingLimitSats !== undefined && { weeklyFundingLimitSats: input.weeklyFundingLimitSats }),
    ...(input.cooldownMinutes !== undefined && { cooldownMinutes: input.cooldownMinutes }),
    ...(input.minOperationalBalanceSats !== undefined && { minOperationalBalanceSats: input.minOperationalBalanceSats }),
    ...(input.largeOperationalSpendSats !== undefined && { largeOperationalSpendSats: input.largeOperationalSpendSats }),
    ...(input.largeOperationalFeeSats !== undefined && { largeOperationalFeeSats: input.largeOperationalFeeSats }),
    ...(input.repeatedFailureThreshold !== undefined && { repeatedFailureThreshold: input.repeatedFailureThreshold }),
    ...(input.repeatedFailureLookbackMinutes !== undefined && { repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes }),
    ...(input.alertDedupeMinutes !== undefined && { alertDedupeMinutes: input.alertDedupeMinutes }),
    ...(input.requireHumanApproval !== undefined && { requireHumanApproval: input.requireHumanApproval }),
    ...(input.notifyOnOperationalSpend !== undefined && { notifyOnOperationalSpend: input.notifyOnOperationalSpend }),
    ...(input.pauseOnUnexpectedSpend !== undefined && { pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend }),
    ...(input.status === 'revoked' && !existingRevokedAt && { revokedAt: new Date() }),
    ...(input.status && input.status !== 'revoked' && { revokedAt: null }),
  };
}

export async function getAgentOptions() {
  const [users, wallets] = await Promise.all([
    userRepository.findAllSummary(),
    walletRepository.findAllWithSelect({
      id: true,
      name: true,
      type: true,
      network: true,
      users: {
        select: {
          userId: true,
        },
      },
      group: {
        select: {
          members: {
            select: { userId: true },
          },
        },
      },
      devices: {
        select: {
          deviceId: true,
          device: {
            select: {
              id: true,
              label: true,
              fingerprint: true,
              type: true,
              userId: true,
            },
          },
        },
      },
    }),
  ]);

  const deviceById = new Map<string, {
    id: string;
    label: string;
    fingerprint: string;
    type: string;
    userId: string;
    walletIds: Set<string>;
  }>();

  const walletOptions = wallets
    .map(wallet => {
      const accessUserIds = collectWalletAccessUserIds(wallet);
      const deviceIds = wallet.devices.map(link => link.deviceId);

      for (const link of wallet.devices) {
        const current = deviceById.get(link.device.id) ?? {
          id: link.device.id,
          label: link.device.label,
          fingerprint: link.device.fingerprint,
          type: link.device.type,
          userId: link.device.userId,
          walletIds: new Set<string>(),
        };
        current.walletIds.add(wallet.id);
        deviceById.set(current.id, current);
      }

      return {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        network: wallet.network,
        accessUserIds,
        deviceIds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const deviceOptions = [...deviceById.values()]
    .map(device => ({
      id: device.id,
      label: device.label,
      fingerprint: device.fingerprint,
      type: device.type,
      userId: device.userId,
      walletIds: [...device.walletIds].sort(),
    }))
    /* v8 ignore start -- deterministic sort comparator branch is a V8 coverage artifact */
    .sort((a, b) => a.label.localeCompare(b.label));
    /* v8 ignore stop */

  return {
    users,
    wallets: walletOptions,
    devices: deviceOptions,
  };
}

export function listWalletAgents(filter: FindWalletAgentsFilter) {
  return agentRepository.findAgents(filter);
}

export function getAgentDashboardRows() {
  return agentRepository.findDashboardRows();
}

export async function createWalletAgent(input: CreateWalletAgentServiceInput) {
  await validateAgentLink(input);

  const agent = await agentRepository.createAgent({
    userId: input.userId,
    name: input.name.trim(),
    fundingWalletId: input.fundingWalletId,
    operationalWalletId: input.operationalWalletId,
    signerDeviceId: input.signerDeviceId,
    status: input.status,
    maxFundingAmountSats: input.maxFundingAmountSats ?? null,
    maxOperationalBalanceSats: input.maxOperationalBalanceSats ?? null,
    dailyFundingLimitSats: input.dailyFundingLimitSats ?? null,
    weeklyFundingLimitSats: input.weeklyFundingLimitSats ?? null,
    cooldownMinutes: input.cooldownMinutes ?? null,
    minOperationalBalanceSats: input.minOperationalBalanceSats ?? null,
    largeOperationalSpendSats: input.largeOperationalSpendSats ?? null,
    largeOperationalFeeSats: input.largeOperationalFeeSats ?? null,
    repeatedFailureThreshold: input.repeatedFailureThreshold ?? null,
    repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes ?? null,
    alertDedupeMinutes: input.alertDedupeMinutes ?? null,
    requireHumanApproval: input.requireHumanApproval,
    notifyOnOperationalSpend: input.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend,
  });

  const created = await agentRepository.findAgentByIdWithDetails(agent.id);
  return created ?? agent;
}

export async function updateWalletAgent(agentId: string, input: UpdateWalletAgentServiceInput) {
  const existing = await agentRepository.findAgentById(agentId);
  if (!existing) {
    throw new NotFoundError('Wallet agent not found');
  }

  const updated = await agentRepository.updateAgent(agentId, toAgentUpdateInput(input, existing.revokedAt));
  const detailed = await agentRepository.findAgentByIdWithDetails(agentId);
  return detailed ?? updated;
}

export async function revokeWalletAgent(agentId: string) {
  const existing = await agentRepository.findAgentById(agentId);
  if (!existing) {
    throw new NotFoundError('Wallet agent not found');
  }

  const revoked = existing.revokedAt
    ? existing
    : await agentRepository.updateAgent(agentId, { status: 'revoked', revokedAt: new Date() });

  return {
    agent: revoked,
    alreadyRevoked: Boolean(existing.revokedAt),
  };
}

export async function listAgentAlerts(filter: FindAgentAlertsFilter) {
  const agent = await agentRepository.findAgentById(filter.agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  return agentRepository.findAlerts(filter);
}

export async function listAgentFundingOverrides(filter: FindAgentFundingOverridesFilter) {
  const agent = await agentRepository.findAgentById(filter.agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  return agentRepository.findFundingOverrides(filter);
}

export async function createAgentFundingOverride(
  agentId: string,
  input: CreateAgentFundingOverrideServiceInput,
  createdByUserId?: string | null
) {
  if (input.expiresAt.getTime() <= Date.now()) {
    throw new InvalidInputError('expiresAt must be in the future');
  }

  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  if (agent.revokedAt || agent.status === 'revoked') {
    throw new InvalidInputError('Cannot create funding overrides for a revoked agent');
  }

  return agentRepository.createFundingOverride({
    agentId,
    fundingWalletId: agent.fundingWalletId,
    operationalWalletId: agent.operationalWalletId,
    createdByUserId: createdByUserId ?? null,
    reason: input.reason.trim(),
    maxAmountSats: input.maxAmountSats,
    expiresAt: input.expiresAt,
  });
}

export async function revokeAgentFundingOverride(agentId: string, overrideId: string) {
  const existing = await agentRepository.findFundingOverrideById(overrideId);
  if (!existing || existing.agentId !== agentId) {
    throw new NotFoundError('Agent funding override not found');
  }

  const revoked = existing.status === 'active'
    ? await agentRepository.revokeFundingOverride(overrideId)
    : existing;

  return {
    override: revoked,
    alreadyInactive: existing.status !== 'active',
  };
}

export async function listAgentApiKeys(agentId: string) {
  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }

  return agentRepository.findApiKeysByAgentId(agentId);
}

export async function createAgentApiKey(
  agentId: string,
  input: CreateAgentApiKeyServiceInput,
  createdByUserId?: string | null
) {
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new InvalidInputError('expiresAt must be in the future');
  }

  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  if (agent.revokedAt || agent.status === 'revoked') {
    throw new InvalidInputError('Cannot create API keys for a revoked agent');
  }

  const apiKey = generateAgentApiKey();
  const scope = buildAgentKeyScope({ allowedActions: input.allowedActions });
  const key = await agentRepository.createApiKey({
    agentId,
    createdByUserId: createdByUserId ?? null,
    name: input.name.trim(),
    keyHash: hashAgentApiKey(apiKey),
    keyPrefix: getAgentApiKeyPrefix(apiKey),
    scope: scope as Prisma.InputJsonValue,
    expiresAt: input.expiresAt ?? null,
  });

  return { key, apiKey, scope };
}

export async function revokeAgentApiKey(agentId: string, keyId: string) {
  const existing = await agentRepository.findApiKeyById(keyId);
  if (!existing || existing.agentId !== agentId) {
    throw new NotFoundError('Agent API key not found');
  }

  const revoked = existing.revokedAt ? existing : await agentRepository.revokeApiKey(keyId);

  return {
    key: revoked,
    alreadyRevoked: Boolean(existing.revokedAt),
  };
}
