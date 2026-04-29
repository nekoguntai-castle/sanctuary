/**
 * Agent Funding Policy
 *
 * Enforces per-agent funding caps and cadence limits before Sanctuary stores a
 * new agent-submitted funding draft.
 */

import { agentRepository, utxoRepository } from '../repositories';
import { InvalidInputError, NotFoundError } from '../errors';

/**
 * If `overrideId` is set, the caller must mark that override used only after
 * the funding draft has been created successfully.
 */
export interface AgentFundingPolicyDecision {
  overrideId: string | null;
}

const fundingPolicyError = (
  message: string,
  reasonCode: string,
): InvalidInputError => {
  return new InvalidInputError(message, undefined, { reasonCode });
};

const CAP_VIOLATION_REASONS = {
  maxFundingAmount: 'policy_max_funding_amount',
  operationalBalanceCap: 'policy_operational_balance_cap',
  dailyLimit: 'policy_daily_limit',
  weeklyLimit: 'policy_weekly_limit',
} as const;

interface CapViolation {
  message: string;
  reasonCode: string;
}

export async function enforceAgentFundingPolicy(
  agentId: string,
  operationalWalletId: string,
  fundingAmount: bigint,
  now: Date = new Date(),
): Promise<AgentFundingPolicyDecision> {
  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  if (agent.revokedAt || agent.status !== 'active') {
    throw fundingPolicyError('Agent is not active', 'agent_inactive');
  }
  if (agent.operationalWalletId !== operationalWalletId) {
    throw fundingPolicyError(
      'Funding draft destination is not the linked operational wallet',
      'policy_destination_mismatch',
    );
  }

  // Owner overrides can waive funding caps, but never agent status, destination, or cadence guards.
  if (agent.cooldownMinutes != null && agent.lastFundingDraftAt) {
    const cooldownMs = agent.cooldownMinutes * 60 * 1000;
    const nextAllowedAt = agent.lastFundingDraftAt.getTime() + cooldownMs;
    if (cooldownMs > 0 && now.getTime() < nextAllowedAt) {
      throw fundingPolicyError(
        'Agent funding cooldown is still active',
        'policy_cooldown',
      );
    }
  }

  let capViolation: CapViolation | null = null;

  // Evaluate all cap checks, preserving the first user-facing failure message,
  // then allow a single bounded owner override to cover the cap exception.
  if (
    agent.maxFundingAmountSats != null &&
    fundingAmount > agent.maxFundingAmountSats
  ) {
    capViolation = {
      message: 'Agent funding amount exceeds the per-request cap',
      reasonCode: CAP_VIOLATION_REASONS.maxFundingAmount,
    };
  }

  if (agent.maxOperationalBalanceSats != null) {
    const currentOperationalBalance =
      await utxoRepository.getUnspentBalance(operationalWalletId);
    if (
      currentOperationalBalance + fundingAmount >
      agent.maxOperationalBalanceSats
    ) {
      capViolation ??= {
        message: 'Agent operational wallet balance cap would be exceeded',
        reasonCode: CAP_VIOLATION_REASONS.operationalBalanceCap,
      };
    }
  }

  if (agent.dailyFundingLimitSats != null) {
    const dayTotal = await agentRepository.sumAgentDraftAmountsSince(
      agentId,
      startOfUtcDay(now),
    );
    if (dayTotal + fundingAmount > agent.dailyFundingLimitSats) {
      capViolation ??= {
        message: 'Agent daily funding limit would be exceeded',
        reasonCode: CAP_VIOLATION_REASONS.dailyLimit,
      };
    }
  }

  if (agent.weeklyFundingLimitSats != null) {
    const weekTotal = await agentRepository.sumAgentDraftAmountsSince(
      agentId,
      startOfUtcWeek(now),
    );
    if (weekTotal + fundingAmount > agent.weeklyFundingLimitSats) {
      capViolation ??= {
        message: 'Agent weekly funding limit would be exceeded',
        reasonCode: CAP_VIOLATION_REASONS.weeklyLimit,
      };
    }
  }

  if (capViolation) {
    return requireOverrideOrThrow(
      agentId,
      operationalWalletId,
      fundingAmount,
      now,
      capViolation,
    );
  }

  return { overrideId: null };
}

async function requireOverrideOrThrow(
  agentId: string,
  operationalWalletId: string,
  fundingAmount: bigint,
  now: Date,
  violation: CapViolation,
): Promise<AgentFundingPolicyDecision> {
  const override = await agentRepository.findUsableFundingOverride({
    agentId,
    operationalWalletId,
    amount: fundingAmount,
    now,
  });

  if (!override) {
    throw fundingPolicyError(violation.message, violation.reasonCode);
  }

  return { overrideId: override.id };
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfUtcWeek(date: Date): Date {
  const dayStart = startOfUtcDay(date);
  const day = dayStart.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(dayStart.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
}
