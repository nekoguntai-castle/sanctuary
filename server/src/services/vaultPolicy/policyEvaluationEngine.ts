/**
 * Policy Evaluation Engine
 *
 * Evaluates all active vault policies for a given transaction.
 * Returns whether the transaction is allowed and what actions are required.
 *
 * Design principles:
 * - Enforce-mode policies are fail-CLOSED: if evaluation errors, transaction is blocked.
 * - Monitor-mode policies are fail-open: errors are logged but don't block.
 * - Preview evaluations skip event logging to avoid side effects.
 */

import type { VaultPolicy } from '../../generated/prisma/client';
import { policyRepository } from '../../repositories/policyRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyType,
  SpendingLimitConfig,
  ApprovalRequiredConfig,
  AddressControlConfig,
  VelocityConfig,
  WindowType,
} from './types';
import { vaultPolicyService } from './vaultPolicyService';

const log = createLogger('VAULT_POLICY:SVC_ENGINE');

type EvaluationInput = PolicyEvaluationInput & { preview?: boolean };
type TriggeredPolicy = PolicyEvaluationResult['triggered'][number];
type TriggerAction = TriggeredPolicy['action'];

interface EvaluationState {
  walletId: string;
  userId: string;
  recipient: string;
  amount: bigint;
  outputs?: PolicyEvaluationInput['outputs'];
  triggered: PolicyEvaluationResult['triggered'];
  limits: NonNullable<PolicyEvaluationResult['limits']>;
  blocked: boolean;
}

interface UsageRecordContext {
  walletId: string;
  userId: string;
  amount: bigint;
}

interface UsageWindowRecord {
  type: WindowType;
  userId?: string;
  incrementAmount: bigint;
}

/**
 * Evaluate all active policies for a transaction.
 * Returns the combined result of all policy evaluations.
 *
 * @param input.preview - If true, skip event logging (for /evaluate endpoint)
 */
export async function evaluatePolicies(
  input: EvaluationInput
): Promise<PolicyEvaluationResult> {
  const state = createEvaluationState(input);

  // Get the wallet's group for inheritance
  const wallet = await walletRepository.findById(input.walletId);
  const groupId = wallet?.groupId ?? null;

  // Fetch all active policies (system + group + wallet)
  const policies = await vaultPolicyService.getActivePoliciesForWallet(input.walletId, groupId);

  if (policies.length === 0) {
    return { allowed: true, triggered: [] };
  }

  // Evaluate each policy in priority order
  for (const policy of policies) {
    await evaluatePolicySafely(policy, state);
  }

  // Log policy events (skip for preview evaluations to avoid side effects)
  if (!input.preview) {
    logPolicyEvents(state);
  }

  return createEvaluationResult(state);
}

const createEvaluationState = (input: EvaluationInput): EvaluationState => ({
  walletId: input.walletId,
  userId: input.userId,
  recipient: input.recipient,
  amount: input.amount,
  outputs: input.outputs,
  triggered: [],
  limits: {},
  blocked: false,
});

const evaluatePolicySafely = async (
  policy: VaultPolicy,
  state: EvaluationState
): Promise<void> => {
  try {
    await evaluatePolicy(policy, state);
  } catch (error) {
    handlePolicyEvaluationError(policy, state, error);
  }
};

const evaluatePolicy = async (
  policy: VaultPolicy,
  state: EvaluationState
): Promise<void> => {
  const config = policy.config as Record<string, unknown>;

  switch (policy.type) {
    case 'spending_limit':
      await applySpendingLimitPolicy(policy, config, state);
      break;
    case 'approval_required':
      applyApprovalRequiredPolicy(policy, config, state);
      break;
    case 'address_control':
      await applyAddressControlPolicy(policy, config, state);
      break;
    case 'velocity':
      await applyVelocityPolicy(policy, config, state);
      break;
    case 'time_delay':
      applyTimeDelayPolicy(policy, config, state);
      break;
  }
};

const applySpendingLimitPolicy = async (
  policy: VaultPolicy,
  config: Record<string, unknown>,
  state: EvaluationState
): Promise<void> => {
  const result = await evaluateSpendingLimit(
    policy,
    config as unknown as SpendingLimitConfig,
    state.walletId,
    state.userId,
    state.amount
  );

  if (result.triggered) {
    addTriggeredPolicy(state, policy, 'spending_limit', getBlockingAction(policy), result.reason);
    markBlockedWhenEnforced(state, policy);
  }

  // Always populate limit info for UI
  /* v8 ignore next -- policy evaluators return limit metadata only for limit-bearing policies */
  if (result.limits) {
    Object.assign(state.limits, result.limits);
  }
};

const applyApprovalRequiredPolicy = (
  policy: VaultPolicy,
  config: Record<string, unknown>,
  state: EvaluationState
): void => {
  const result = evaluateApprovalRequired(
    config as unknown as ApprovalRequiredConfig,
    state.amount
  );

  if (result.triggered) {
    addTriggeredPolicy(
      state,
      policy,
      'approval_required',
      policy.enforcement === 'monitor' ? 'monitored' : 'approval_required',
      result.reason
    );
    // approval_required doesn't block — it requires a workflow
  }
};

const applyAddressControlPolicy = async (
  policy: VaultPolicy,
  config: Record<string, unknown>,
  state: EvaluationState
): Promise<void> => {
  const result = await evaluateAddressControl(
    policy,
    config as unknown as AddressControlConfig,
    state.recipient,
    state.outputs
  );

  if (result.triggered) {
    addTriggeredPolicy(state, policy, 'address_control', getBlockingAction(policy), result.reason);
    markBlockedWhenEnforced(state, policy);
  }
};

const applyVelocityPolicy = async (
  policy: VaultPolicy,
  config: Record<string, unknown>,
  state: EvaluationState
): Promise<void> => {
  const result = await evaluateVelocity(
    policy,
    config as unknown as VelocityConfig,
    state.walletId,
    state.userId
  );

  if (result.triggered) {
    addTriggeredPolicy(state, policy, 'velocity', getBlockingAction(policy), result.reason);
    markBlockedWhenEnforced(state, policy);
  }
};

const applyTimeDelayPolicy = (
  policy: VaultPolicy,
  config: Record<string, unknown>,
  state: EvaluationState
): void => {
  // Time delay is evaluated post-approval, not pre-create.
  // It's included in the triggered list so the UI knows about it.
  const tdConfig = config as unknown as { trigger: { always?: boolean; amountAbove?: number } };

  if (shouldTriggerTimeDelay(tdConfig, state.amount)) {
    addTriggeredPolicy(
      state,
      policy,
      'time_delay',
      policy.enforcement === 'monitor' ? 'monitored' : 'approval_required',
      'Transaction will enter a cooling period after approval'
    );
  }
};

const shouldTriggerTimeDelay = (
  config: { trigger?: { always?: boolean; amountAbove?: number } },
  amount: bigint
): boolean =>
  Boolean(
    config.trigger?.always ||
    (config.trigger?.amountAbove && amount > BigInt(config.trigger.amountAbove))
  );

const getBlockingAction = (policy: VaultPolicy): TriggerAction =>
  policy.enforcement === 'monitor' ? 'monitored' : 'blocked';

const markBlockedWhenEnforced = (
  state: EvaluationState,
  policy: VaultPolicy
): void => {
  if (policy.enforcement !== 'monitor') {
    state.blocked = true;
  }
};

const addTriggeredPolicy = (
  state: EvaluationState,
  policy: VaultPolicy,
  type: PolicyType,
  action: TriggerAction,
  reason: string
): void => {
  state.triggered.push({
    policyId: policy.id,
    policyName: policy.name,
    type,
    action,
    reason,
  });
};

const handlePolicyEvaluationError = (
  policy: VaultPolicy,
  state: EvaluationState,
  error: unknown
): void => {
  log.error('Policy evaluation error', {
    policyId: policy.id,
    policyType: policy.type,
    error: getErrorMessage(error),
  });

  // Fail-CLOSED for enforce-mode policies: if we can't evaluate, block.
  // Fail-open for monitor-mode policies: log and continue.
  if (policy.enforcement !== 'monitor') {
    state.blocked = true;
    addTriggeredPolicy(
      state,
      policy,
      policy.type as PolicyType,
      'blocked',
      'Policy could not be evaluated; transaction blocked as a precaution'
    );
  }
};

const logPolicyEvents = (state: EvaluationState): void => {
  for (const triggered of state.triggered) {
    policyRepository.createPolicyEvent({
      policyId: triggered.policyId,
      walletId: state.walletId,
      userId: state.userId,
      eventType: triggered.action === 'monitored' ? 'evaluated' : 'triggered',
      details: {
        action: triggered.action,
        reason: triggered.reason,
        amount: state.amount.toString(),
        recipient: state.recipient,
      },
    }).catch(err => {
      log.warn('Failed to log policy event', { error: err instanceof Error ? err.message : String(err) });
    });
  }
};

const createEvaluationResult = (
  state: EvaluationState
): PolicyEvaluationResult => ({
  allowed: !state.blocked,
  triggered: state.triggered,
  limits: Object.keys(state.limits).length > 0 ? state.limits : undefined,
});

/**
 * Record usage after a successful broadcast.
 * Must be called after a transaction is confirmed broadcast.
 */
export async function recordUsage(
  walletId: string,
  userId: string,
  amount: bigint
): Promise<void> {
  const context: UsageRecordContext = { walletId, userId, amount };
  const policies = await getActivePoliciesForUsage(walletId);

  for (const policy of policies) {
    await recordPolicyUsage(policy, context);
  }
}

const getActivePoliciesForUsage = async (
  walletId: string
): Promise<VaultPolicy[]> => {
  const wallet = await walletRepository.findById(walletId);
  const groupId = wallet?.groupId ?? null;
  return vaultPolicyService.getActivePoliciesForWallet(walletId, groupId);
};

const recordPolicyUsage = async (
  policy: VaultPolicy,
  context: UsageRecordContext
): Promise<void> => {
  try {
    for (const record of getUsageWindowRecords(policy, context)) {
      await recordUsageWindow(policy, context.walletId, record);
    }
  } catch (error) {
    log.error('Failed to record policy usage', {
      policyId: policy.id,
      error: getErrorMessage(error),
    });
  }
};

const getUsageWindowRecords = (
  policy: VaultPolicy,
  context: UsageRecordContext
): UsageWindowRecord[] => {
  const config = policy.config as Record<string, unknown>;

  if (policy.type === 'spending_limit') {
    return getSpendingLimitUsageRecords(
      config as unknown as SpendingLimitConfig,
      context
    );
  }

  if (policy.type === 'velocity') {
    return getVelocityUsageRecords(config as unknown as VelocityConfig, context);
  }

  return [];
};

const getSpendingLimitUsageRecords = (
  config: SpendingLimitConfig,
  context: UsageRecordContext
): UsageWindowRecord[] => {
  const scopedUserId = getScopedUsageUserId(config.scope, context.userId);

  return [
    createUsageWindowRecord('daily', config.daily, context.amount, scopedUserId),
    createUsageWindowRecord('weekly', config.weekly, context.amount, scopedUserId),
    createUsageWindowRecord('monthly', config.monthly, context.amount, scopedUserId),
  ].filter((record): record is UsageWindowRecord => record !== null);
};

const getVelocityUsageRecords = (
  config: VelocityConfig,
  context: UsageRecordContext
): UsageWindowRecord[] => {
  const scopedUserId = getScopedUsageUserId(config.scope, context.userId);

  return [
    createUsageWindowRecord('hourly', config.maxPerHour, BigInt(0), scopedUserId),
    createUsageWindowRecord('daily', config.maxPerDay, BigInt(0), scopedUserId),
    createUsageWindowRecord('weekly', config.maxPerWeek, BigInt(0), scopedUserId),
  ].filter((record): record is UsageWindowRecord => record !== null);
};

const createUsageWindowRecord = (
  type: WindowType,
  limit: number | undefined,
  incrementAmount: bigint,
  userId: string | undefined
): UsageWindowRecord | null =>
  limit && limit > 0 ? { type, userId, incrementAmount } : null;

const getScopedUsageUserId = (
  scope: SpendingLimitConfig['scope'] | VelocityConfig['scope'],
  userId: string
): string | undefined => scope === 'per_user' ? userId : undefined;

const recordUsageWindow = async (
  policy: VaultPolicy,
  walletId: string,
  record: UsageWindowRecord
): Promise<void> => {
  const { start, end } = getWindowBounds(record.type);
  const window = await policyRepository.findOrCreateUsageWindow({
    policyId: policy.id,
    walletId,
    userId: record.userId,
    windowType: record.type,
    windowStart: start,
    windowEnd: end,
  });
  await policyRepository.incrementUsageWindow(window.id, record.incrementAmount);
};

// ========================================
// INDIVIDUAL POLICY EVALUATORS
// ========================================

interface SpendingLimitResult {
  triggered: boolean;
  reason: string;
  limits?: PolicyEvaluationResult['limits'];
}

async function evaluateSpendingLimit(
  policy: VaultPolicy,
  config: SpendingLimitConfig,
  walletId: string,
  userId: string,
  amount: bigint
): Promise<SpendingLimitResult> {
  const limits: PolicyEvaluationResult['limits'] = {};

  // Check per-transaction limit
  if (config.perTransaction && config.perTransaction > 0) {
    limits.perTransaction = { limit: config.perTransaction };
    if (amount > BigInt(config.perTransaction)) {
      return {
        triggered: true,
        reason: `Transaction amount (${amount} sats) exceeds per-transaction limit (${config.perTransaction} sats)`,
        limits,
      };
    }
  }

  // Check rolling window limits
  const windowChecks: Array<{ type: WindowType; limit: number; key: 'daily' | 'weekly' | 'monthly' }> = [];
  if (config.daily && config.daily > 0) windowChecks.push({ type: 'daily', limit: config.daily, key: 'daily' });
  if (config.weekly && config.weekly > 0) windowChecks.push({ type: 'weekly', limit: config.weekly, key: 'weekly' });
  if (config.monthly && config.monthly > 0) windowChecks.push({ type: 'monthly', limit: config.monthly, key: 'monthly' });

  for (const check of windowChecks) {
    const { start, end } = getWindowBounds(check.type);
    const window = await policyRepository.findOrCreateUsageWindow({
      policyId: policy.id,
      walletId,
      userId: config.scope === 'per_user' ? userId : undefined,
      windowType: check.type,
      windowStart: start,
      windowEnd: end,
    });

    const used = window.totalSpent;
    const remaining = BigInt(check.limit) - used;

    limits[check.key] = {
      used: Number(used),
      limit: check.limit,
      remaining: Math.max(0, Number(remaining)),
    };

    if (used + amount > BigInt(check.limit)) {
      return {
        triggered: true,
        reason: `${check.key} spending limit exceeded: ${used + amount} / ${check.limit} sats`,
        limits,
      };
    }
  }

  return { triggered: false, reason: '', limits };
}

interface SimpleResult {
  triggered: boolean;
  reason: string;
}

function evaluateApprovalRequired(
  config: ApprovalRequiredConfig,
  amount: bigint
): SimpleResult {
  if (config.trigger.always) {
    return {
      triggered: true,
      reason: `All transactions require ${config.requiredApprovals} approval(s)`,
    };
  }

  if (config.trigger.amountAbove && amount > BigInt(config.trigger.amountAbove)) {
    return {
      triggered: true,
      reason: `Transaction amount (${amount} sats) exceeds approval threshold (${config.trigger.amountAbove} sats)`,
    };
  }

  // unknownAddressesOnly requires cross-referencing with address_control policies.
  // This is deferred — for now, it does not trigger on its own.
  // The address_control policy handles address restriction directly.

  return { triggered: false, reason: '' };
}

async function evaluateAddressControl(
  policy: VaultPolicy,
  config: AddressControlConfig,
  recipient: string,
  outputs?: Array<{ address: string; amount: number }>
): Promise<SimpleResult> {
  // Collect all recipient addresses
  const addresses = outputs
    ? outputs.map(o => o.address)
    : [recipient];

  const policyAddresses = await policyRepository.findPolicyAddresses(policy.id);

  if (config.mode === 'allowlist') {
    const allowed = new Set(policyAddresses.filter(a => a.listType === 'allow').map(a => a.address));
    if (allowed.size === 0) {
      // No allowlist entries = no restrictions (empty allowlist doesn't block)
      return { triggered: false, reason: '' };
    }
    for (const addr of addresses) {
      if (!allowed.has(addr)) {
        return {
          triggered: true,
          reason: `Address ${addr.substring(0, 12)}... is not on the allowlist`,
        };
      }
    }
  } else {
    // denylist mode
    const denied = new Set(policyAddresses.filter(a => a.listType === 'deny').map(a => a.address));
    for (const addr of addresses) {
      if (denied.has(addr)) {
        return {
          triggered: true,
          reason: `Address ${addr.substring(0, 12)}... is on the denylist`,
        };
      }
    }
  }

  return { triggered: false, reason: '' };
}

async function evaluateVelocity(
  policy: VaultPolicy,
  config: VelocityConfig,
  walletId: string,
  userId: string
): Promise<SimpleResult> {
  const checks: Array<{ type: WindowType; limit: number; label: string }> = [];
  if (config.maxPerHour && config.maxPerHour > 0) checks.push({ type: 'hourly', limit: config.maxPerHour, label: 'hourly' });
  if (config.maxPerDay && config.maxPerDay > 0) checks.push({ type: 'daily', limit: config.maxPerDay, label: 'daily' });
  if (config.maxPerWeek && config.maxPerWeek > 0) checks.push({ type: 'weekly', limit: config.maxPerWeek, label: 'weekly' });

  for (const check of checks) {
    const { start, end } = getWindowBounds(check.type);
    const window = await policyRepository.findOrCreateUsageWindow({
      policyId: policy.id,
      walletId,
      userId: config.scope === 'per_user' ? userId : undefined,
      windowType: check.type,
      windowStart: start,
      windowEnd: end,
    });

    if (window.txCount >= check.limit) {
      return {
        triggered: true,
        reason: `${check.label} transaction limit reached: ${window.txCount} / ${check.limit}`,
      };
    }
  }

  return { triggered: false, reason: '' };
}

// ========================================
// HELPERS
// ========================================

function getWindowBounds(type: WindowType): { start: Date; end: Date } {
  const now = new Date();

  switch (type) {
    case 'hourly': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
      const end = new Date(start);
      end.setHours(end.getHours() + 1);
      return { start, end };
    }
    case 'daily': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case 'weekly': {
      const day = now.getDay();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case 'monthly': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }
  }
}

// ========================================
// EXPORTS
// ========================================

export const policyEvaluationEngine = {
  evaluatePolicies,
  recordUsage,
};

export default policyEvaluationEngine;
