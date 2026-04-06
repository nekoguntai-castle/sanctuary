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

import type { VaultPolicy } from '@prisma/client';
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

/**
 * Evaluate all active policies for a transaction.
 * Returns the combined result of all policy evaluations.
 *
 * @param input.preview - If true, skip event logging (for /evaluate endpoint)
 */
export async function evaluatePolicies(
  input: PolicyEvaluationInput & { preview?: boolean }
): Promise<PolicyEvaluationResult> {
  const { walletId, userId, recipient, amount, preview } = input;

  // Get the wallet's group for inheritance
  const wallet = await walletRepository.findById(walletId);
  const groupId = wallet?.groupId ?? null;

  // Fetch all active policies (system + group + wallet)
  const policies = await vaultPolicyService.getActivePoliciesForWallet(walletId, groupId);

  if (policies.length === 0) {
    return { allowed: true, triggered: [] };
  }

  const triggered: PolicyEvaluationResult['triggered'] = [];
  const limits: PolicyEvaluationResult['limits'] = {};
  let blocked = false;

  // Evaluate each policy in priority order
  for (const policy of policies) {
    const config = policy.config as Record<string, unknown>;
    const isMonitor = policy.enforcement === 'monitor';

    try {
      switch (policy.type) {
        case 'spending_limit': {
          const result = await evaluateSpendingLimit(
            policy,
            config as unknown as SpendingLimitConfig,
            walletId,
            userId,
            amount
          );
          if (result.triggered) {
            triggered.push({
              policyId: policy.id,
              policyName: policy.name,
              type: 'spending_limit',
              action: isMonitor ? 'monitored' : 'blocked',
              reason: result.reason,
            });
            if (!isMonitor) blocked = true;
          }
          // Always populate limit info for UI
          if (result.limits) {
            Object.assign(limits, result.limits);
          }
          break;
        }

        case 'approval_required': {
          const result = evaluateApprovalRequired(
            config as unknown as ApprovalRequiredConfig,
            amount
          );
          if (result.triggered) {
            triggered.push({
              policyId: policy.id,
              policyName: policy.name,
              type: 'approval_required',
              action: isMonitor ? 'monitored' : 'approval_required',
              reason: result.reason,
            });
            // approval_required doesn't block — it requires a workflow
          }
          break;
        }

        case 'address_control': {
          const result = await evaluateAddressControl(
            policy,
            config as unknown as AddressControlConfig,
            recipient,
            input.outputs
          );
          if (result.triggered) {
            triggered.push({
              policyId: policy.id,
              policyName: policy.name,
              type: 'address_control',
              action: isMonitor ? 'monitored' : 'blocked',
              reason: result.reason,
            });
            if (!isMonitor) blocked = true;
          }
          break;
        }

        case 'velocity': {
          const result = await evaluateVelocity(
            policy,
            config as unknown as VelocityConfig,
            walletId,
            userId
          );
          if (result.triggered) {
            triggered.push({
              policyId: policy.id,
              policyName: policy.name,
              type: 'velocity',
              action: isMonitor ? 'monitored' : 'blocked',
              reason: result.reason,
            });
            if (!isMonitor) blocked = true;
          }
          break;
        }

        case 'time_delay': {
          // Time delay is evaluated post-approval, not pre-create.
          // It's included in the triggered list so the UI knows about it.
          const tdConfig = config as unknown as { trigger: { always?: boolean; amountAbove?: number } };
          if (tdConfig.trigger?.always || (tdConfig.trigger?.amountAbove && amount > BigInt(tdConfig.trigger.amountAbove))) {
            triggered.push({
              policyId: policy.id,
              policyName: policy.name,
              type: 'time_delay',
              action: isMonitor ? 'monitored' : 'approval_required',
              reason: 'Transaction will enter a cooling period after approval',
            });
          }
          break;
        }
      }
    } catch (error) {
      log.error('Policy evaluation error', {
        policyId: policy.id,
        policyType: policy.type,
        error: getErrorMessage(error),
      });

      // Fail-CLOSED for enforce-mode policies: if we can't evaluate, block.
      // Fail-open for monitor-mode policies: log and continue.
      if (!isMonitor) {
        blocked = true;
        triggered.push({
          policyId: policy.id,
          policyName: policy.name,
          type: policy.type as PolicyType,
          action: 'blocked',
          reason: 'Policy could not be evaluated; transaction blocked as a precaution',
        });
      }
    }
  }

  // Log policy events (skip for preview evaluations to avoid side effects)
  if (!preview) {
    for (const t of triggered) {
      policyRepository.createPolicyEvent({
        policyId: t.policyId,
        walletId,
        userId,
        eventType: t.action === 'monitored' ? 'evaluated' : 'triggered',
        details: {
          action: t.action,
          reason: t.reason,
          amount: amount.toString(),
          recipient,
        },
      }).catch(err => {
        log.warn('Failed to log policy event', { error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  return {
    allowed: !blocked,
    triggered,
    limits: Object.keys(limits).length > 0 ? limits : undefined,
  };
}

/**
 * Record usage after a successful broadcast.
 * Must be called after a transaction is confirmed broadcast.
 */
export async function recordUsage(
  walletId: string,
  userId: string,
  amount: bigint
): Promise<void> {
  const wallet = await walletRepository.findById(walletId);
  const groupId = wallet?.groupId ?? null;
  const policies = await vaultPolicyService.getActivePoliciesForWallet(walletId, groupId);

  for (const policy of policies) {
    const config = policy.config as Record<string, unknown>;

    try {
      if (policy.type === 'spending_limit') {
        const slConfig = config as unknown as SpendingLimitConfig;
        const windowTypes: Array<{ type: WindowType; limit: number }> = [];
        if (slConfig.daily && slConfig.daily > 0) windowTypes.push({ type: 'daily', limit: slConfig.daily });
        if (slConfig.weekly && slConfig.weekly > 0) windowTypes.push({ type: 'weekly', limit: slConfig.weekly });
        if (slConfig.monthly && slConfig.monthly > 0) windowTypes.push({ type: 'monthly', limit: slConfig.monthly });

        for (const wt of windowTypes) {
          const { start, end } = getWindowBounds(wt.type);
          const window = await policyRepository.findOrCreateUsageWindow({
            policyId: policy.id,
            walletId,
            userId: slConfig.scope === 'per_user' ? userId : undefined,
            windowType: wt.type,
            windowStart: start,
            windowEnd: end,
          });
          await policyRepository.incrementUsageWindow(window.id, amount);
        }
      }

      if (policy.type === 'velocity') {
        const vConfig = config as unknown as VelocityConfig;
        const windowTypes: Array<{ type: WindowType }> = [];
        if (vConfig.maxPerHour && vConfig.maxPerHour > 0) windowTypes.push({ type: 'hourly' });
        if (vConfig.maxPerDay && vConfig.maxPerDay > 0) windowTypes.push({ type: 'daily' });
        if (vConfig.maxPerWeek && vConfig.maxPerWeek > 0) windowTypes.push({ type: 'weekly' });

        for (const wt of windowTypes) {
          const { start, end } = getWindowBounds(wt.type);
          const window = await policyRepository.findOrCreateUsageWindow({
            policyId: policy.id,
            walletId,
            userId: vConfig.scope === 'per_user' ? userId : undefined,
            windowType: wt.type,
            windowStart: start,
            windowEnd: end,
          });
          await policyRepository.incrementUsageWindow(window.id, BigInt(0));
        }
      }
    } catch (error) {
      log.error('Failed to record policy usage', {
        policyId: policy.id,
        error: getErrorMessage(error),
      });
    }
  }
}

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
