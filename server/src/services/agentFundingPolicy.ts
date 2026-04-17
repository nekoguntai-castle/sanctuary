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

export async function enforceAgentFundingPolicy(
  agentId: string,
  operationalWalletId: string,
  fundingAmount: bigint,
  now: Date = new Date()
): Promise<AgentFundingPolicyDecision> {
  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  if (agent.revokedAt || agent.status !== 'active') {
    throw new InvalidInputError('Agent is not active');
  }
  if (agent.operationalWalletId !== operationalWalletId) {
    throw new InvalidInputError('Funding draft destination is not the linked operational wallet');
  }

  // Owner overrides can waive funding caps, but never agent status, destination, or cadence guards.
  if (agent.cooldownMinutes != null && agent.lastFundingDraftAt) {
    const cooldownMs = agent.cooldownMinutes * 60 * 1000;
    const nextAllowedAt = agent.lastFundingDraftAt.getTime() + cooldownMs;
    if (cooldownMs > 0 && now.getTime() < nextAllowedAt) {
      throw new InvalidInputError('Agent funding cooldown is still active');
    }
  }

  let capViolationMessage: string | null = null;

  // Evaluate all cap checks, preserving the first user-facing failure message,
  // then allow a single bounded owner override to cover the cap exception.
  if (agent.maxFundingAmountSats != null && fundingAmount > agent.maxFundingAmountSats) {
    capViolationMessage = 'Agent funding amount exceeds the per-request cap';
  }

  if (agent.maxOperationalBalanceSats != null) {
    const currentOperationalBalance = await utxoRepository.getUnspentBalance(operationalWalletId);
    if (currentOperationalBalance + fundingAmount > agent.maxOperationalBalanceSats) {
      capViolationMessage ??= 'Agent operational wallet balance cap would be exceeded';
    }
  }

  if (agent.dailyFundingLimitSats != null) {
    const dayTotal = await agentRepository.sumAgentDraftAmountsSince(agentId, startOfUtcDay(now));
    if (dayTotal + fundingAmount > agent.dailyFundingLimitSats) {
      capViolationMessage ??= 'Agent daily funding limit would be exceeded';
    }
  }

  if (agent.weeklyFundingLimitSats != null) {
    const weekTotal = await agentRepository.sumAgentDraftAmountsSince(agentId, startOfUtcWeek(now));
    if (weekTotal + fundingAmount > agent.weeklyFundingLimitSats) {
      capViolationMessage ??= 'Agent weekly funding limit would be exceeded';
    }
  }

  if (capViolationMessage) {
    return requireOverrideOrThrow(agentId, operationalWalletId, fundingAmount, now, capViolationMessage);
  }

  return { overrideId: null };
}

async function requireOverrideOrThrow(
  agentId: string,
  operationalWalletId: string,
  fundingAmount: bigint,
  now: Date,
  message: string
): Promise<AgentFundingPolicyDecision> {
  const override = await agentRepository.findUsableFundingOverride({
    agentId,
    operationalWalletId,
    amount: fundingAmount,
    now,
  });

  if (!override) {
    throw new InvalidInputError(message);
  }

  return { overrideId: override.id };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date): Date {
  const dayStart = startOfUtcDay(date);
  const day = dayStart.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(dayStart.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
}
