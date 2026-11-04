import type { Prisma } from '../generated/prisma/client';
import type { WalletAgentStatus } from '@sanctuary/shared/constants/adminAgents';
import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import { buildAgentKeyScope, generateAgentApiKey, getAgentApiKeyPrefix, hashAgentApiKey } from '../agent/auth';
import { ConflictError, InvalidInputError, NotFoundError } from '../errors/ApiError';
import { isRecordNotFoundError } from '../utils/errors';
import {
  AGENT_ALERT_TRANSITION_TARGETS,
  agentRepository,
  userRepository,
  type AgentAlertTransition,
  walletRepository,
  type FindAgentAlertsFilter,
  type FindAgentFundingOverridesFilter,
  type FindWalletAgentsFilter,
  type UpdateWalletAgentInput,
} from '../repositories';
import { findAgentWalletAccessProblem } from './agentWalletAccess';

interface WalletAccessSource {
  users: Array<{ userId: string }>;
  group: { members: Array<{ userId: string }> } | null;
}

export interface CreateWalletAgentServiceInput {
  userId: string;
  name: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId?: string | null;
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
  return [
    ...new Set([
      ...wallet.users.map(user => user.userId),
      ...(wallet.group?.members.map(member => member.userId) ?? []),
    ]),
  ];
}

function requireAgentLinkRecord<T>(record: T | null, message: string): T {
  if (!record) {
    throw new NotFoundError(message);
  }
  return record;
}

function assertAgentWalletTypes(
  fundingWallet: { type: string; network: string },
  operationalWallet: { type: string; network: string }
): void {
  if (fundingWallet.type !== WalletType.MULTI_SIG && fundingWallet.type !== WalletType.SINGLE_SIG) {
    throw new InvalidInputError('Funding wallet must be a single-sig or multisig wallet');
  }
  if (operationalWallet.type !== WalletType.SINGLE_SIG) {
    throw new InvalidInputError('Operational wallet must be a single-sig wallet');
  }
  if (fundingWallet.network !== operationalWallet.network) {
    throw new InvalidInputError('Funding wallet and operational wallet must use the same network');
  }
}

/** Same roles the agent key needs at runtime (agent/auth.ts assertAgentUserWalletAccess). */
async function assertTargetUserWalletAccess(input: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
}): Promise<void> {
  const problem = await findAgentWalletAccessProblem(input);
  if (problem === 'funding_access') {
    throw new InvalidInputError('User does not have access to the funding wallet');
  }
  if (problem === 'operational_access') {
    throw new InvalidInputError('User does not have access to the operational wallet');
  }
  if (problem === 'funding_role') {
    throw new InvalidInputError('User must be an owner or signer of the funding wallet');
  }
}

function assertOptionalSignerBelongsToFundingWallet(
  signerDeviceId: string | null | undefined,
  fundingWalletWithDevices: { devices: Array<{ deviceId: string }> } | null
): void {
  if (!signerDeviceId) {
    return;
  }

  const signerDeviceIds = new Set((fundingWalletWithDevices?.devices ?? []).map(device => device.deviceId));
  if (!signerDeviceIds.has(signerDeviceId)) {
    throw new InvalidInputError('Signer device must belong to the funding wallet');
  }
}

async function validateAgentLink(input: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId?: string | null;
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

  requireAgentLinkRecord(targetUser, 'User not found');
  const loadedFundingWallet = requireAgentLinkRecord(fundingWallet, 'Funding wallet not found');
  const loadedOperationalWallet = requireAgentLinkRecord(operationalWallet, 'Operational wallet not found');

  assertAgentWalletTypes(loadedFundingWallet, loadedOperationalWallet);
  await assertTargetUserWalletAccess(input);
  assertOptionalSignerBelongsToFundingWallet(input.signerDeviceId, fundingWalletWithDevices);
}

function toAgentUpdateInput(
  input: UpdateWalletAgentServiceInput,
  status: UpdateWalletAgentInput['status']
): UpdateWalletAgentInput {
  return {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(status !== undefined && { status }),
    ...(input.maxFundingAmountSats !== undefined && {
      maxFundingAmountSats: input.maxFundingAmountSats,
    }),
    ...(input.maxOperationalBalanceSats !== undefined && {
      maxOperationalBalanceSats: input.maxOperationalBalanceSats,
    }),
    ...(input.dailyFundingLimitSats !== undefined && {
      dailyFundingLimitSats: input.dailyFundingLimitSats,
    }),
    ...(input.weeklyFundingLimitSats !== undefined && {
      weeklyFundingLimitSats: input.weeklyFundingLimitSats,
    }),
    ...(input.cooldownMinutes !== undefined && {
      cooldownMinutes: input.cooldownMinutes,
    }),
    ...(input.minOperationalBalanceSats !== undefined && {
      minOperationalBalanceSats: input.minOperationalBalanceSats,
    }),
    ...(input.largeOperationalSpendSats !== undefined && {
      largeOperationalSpendSats: input.largeOperationalSpendSats,
    }),
    ...(input.largeOperationalFeeSats !== undefined && {
      largeOperationalFeeSats: input.largeOperationalFeeSats,
    }),
    ...(input.repeatedFailureThreshold !== undefined && {
      repeatedFailureThreshold: input.repeatedFailureThreshold,
    }),
    ...(input.repeatedFailureLookbackMinutes !== undefined && {
      repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes,
    }),
    ...(input.alertDedupeMinutes !== undefined && {
      alertDedupeMinutes: input.alertDedupeMinutes,
    }),
    ...(input.requireHumanApproval !== undefined && {
      requireHumanApproval: input.requireHumanApproval,
    }),
    ...(input.notifyOnOperationalSpend !== undefined && {
      notifyOnOperationalSpend: input.notifyOnOperationalSpend,
    }),
    ...(input.pauseOnUnexpectedSpend !== undefined && {
      pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend,
    }),
  };
}

function toCreateAgentPolicyInput(input: CreateWalletAgentServiceInput) {
  return {
    maxFundingAmountSats: input.maxFundingAmountSats ?? null,
    maxOperationalBalanceSats: input.maxOperationalBalanceSats ?? null,
    dailyFundingLimitSats: input.dailyFundingLimitSats ?? null,
    weeklyFundingLimitSats: input.weeklyFundingLimitSats ?? null,
    cooldownMinutes: input.cooldownMinutes ?? null,
    minOperationalBalanceSats: input.minOperationalBalanceSats ?? null,
  };
}

function toCreateAgentAlertInput(input: CreateWalletAgentServiceInput) {
  return {
    largeOperationalSpendSats: input.largeOperationalSpendSats ?? null,
    largeOperationalFeeSats: input.largeOperationalFeeSats ?? null,
    repeatedFailureThreshold: input.repeatedFailureThreshold ?? null,
    repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes ?? null,
    alertDedupeMinutes: input.alertDedupeMinutes ?? null,
  };
}

function toCreateAgentBehaviorInput(input: CreateWalletAgentServiceInput) {
  return {
    requireHumanApproval: input.requireHumanApproval,
    notifyOnOperationalSpend: input.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend,
  };
}

function toCreateAgentInput(input: CreateWalletAgentServiceInput): Parameters<typeof agentRepository.createAgent>[0] {
  return {
    userId: input.userId,
    name: input.name.trim(),
    fundingWalletId: input.fundingWalletId,
    operationalWalletId: input.operationalWalletId,
    signerDeviceId: input.signerDeviceId ?? null,
    status: input.status,
    ...toCreateAgentPolicyInput(input),
    ...toCreateAgentAlertInput(input),
    ...toCreateAgentBehaviorInput(input),
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

  const deviceById = new Map<
    string,
    {
      id: string;
      label: string;
      fingerprint: string;
      type: string;
      userId: string;
      walletIds: Set<string>;
    }
  >();

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

  const agent = await agentRepository.createAgent(toCreateAgentInput(input));

  const created = await agentRepository.findAgentByIdWithDetails(agent.id);
  return created ?? agent;
}

const REVOKED_AGENT_CONFLICT = 'A revoked agent cannot be changed or reactivated; link a new agent instead';

const isRevoked = (agent: { revokedAt: Date | null; status: string }): boolean =>
  agent.revokedAt !== null || agent.status === 'revoked';

async function applyAgentUpdate(agentId: string, update: UpdateWalletAgentInput) {
  try {
    return await agentRepository.updateAgent(agentId, update);
  } catch (error) {
    // The update only matches an unrevoked agent; P2025 means it was revoked or deleted first.
    if (!isRecordNotFoundError(error)) throw error;
    if (await agentRepository.findAgentById(agentId)) throw new ConflictError(REVOKED_AGENT_CONFLICT);
    throw new NotFoundError('Wallet agent not found');
  }
}

/**
 * Revocation is terminal. A revoked agent accepts no further changes; a status of
 * 'revoked' goes through revokeAgentWithApiKeys, after any other field changes.
 */
export async function updateWalletAgent(agentId: string, input: UpdateWalletAgentServiceInput) {
  const existing = await agentRepository.findAgentById(agentId);
  if (!existing) {
    throw new NotFoundError('Wallet agent not found');
  }

  const status = input.status === 'revoked' ? undefined : input.status;
  const update = toAgentUpdateInput(input, status);
  const hasFieldChanges = Object.keys(update).length > 0;
  if (isRevoked(existing) && (input.status !== 'revoked' || hasFieldChanges)) {
    throw new ConflictError(REVOKED_AGENT_CONFLICT);
  }

  let latest = hasFieldChanges ? await applyAgentUpdate(agentId, update) : existing;
  if (input.status === 'revoked') {
    latest = (await agentRepository.revokeAgentWithApiKeys(agentId)).agent ?? latest;
  }
  const detailed = await agentRepository.findAgentByIdWithDetails(agentId);
  return detailed ?? latest;
}

export async function revokeWalletAgent(agentId: string) {
  const { agent, alreadyRevoked } = await agentRepository.revokeAgentWithApiKeys(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }

  return { agent, alreadyRevoked };
}

export async function listAgentAlerts(filter: FindAgentAlertsFilter) {
  const agent = await agentRepository.findAgentById(filter.agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  return agentRepository.findAlerts(filter);
}

/**
 * Move an agent alert to acknowledged or resolved. A repeated request that finds
 * the alert already in the target status succeeds unchanged (idempotent); one that
 * finds it in another status, such as acknowledging a resolved alert, conflicts.
 */
async function transitionAgentAlert(agentId: string, alertId: string, transition: AgentAlertTransition) {
  const { alert, changed } = await agentRepository.transitionAlertStatus(agentId, alertId, transition);
  if (!alert) {
    throw new NotFoundError('Agent alert not found');
  }
  const target = AGENT_ALERT_TRANSITION_TARGETS[transition];
  if (!changed && alert.status !== target) {
    throw new ConflictError(`Cannot ${transition} an alert that is ${alert.status}`);
  }

  return { alert, alreadyInTargetStatus: !changed };
}

export async function acknowledgeAgentAlert(agentId: string, alertId: string) {
  return transitionAgentAlert(agentId, alertId, 'acknowledge');
}

export async function resolveAgentAlert(agentId: string, alertId: string) {
  return transitionAgentAlert(agentId, alertId, 'resolve');
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

  if (existing.status !== 'active') {
    return { override: existing, alreadyInactive: true };
  }

  const { override, revoked } = await agentRepository.revokeFundingOverride(overrideId);
  return { override: override ?? existing, alreadyInactive: !revoked };
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
