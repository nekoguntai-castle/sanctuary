/**
 * Canonical admin wallet-agent value contracts.
 *
 * These values cross frontend API types, server route validation, OpenAPI, and
 * service DTOs. Keep this module dependency-free so all boundaries can import it.
 */

export const WALLET_AGENT_STATUSES = [
  'active',
  'paused',
  'revoked',
] as const;

export type WalletAgentStatus = (typeof WALLET_AGENT_STATUSES)[number];

export const WALLET_AGENT_TOGGLE_STATUSES = [
  WALLET_AGENT_STATUSES[0],
  WALLET_AGENT_STATUSES[1],
] as const;

export type WalletAgentToggleStatus = (typeof WALLET_AGENT_TOGGLE_STATUSES)[number];

export const AGENT_ALERT_SEVERITIES = [
  'info',
  'warning',
  'critical',
] as const;

export type AgentAlertSeverity = (typeof AGENT_ALERT_SEVERITIES)[number];

export const AGENT_ALERT_STATUSES = [
  'open',
  'acknowledged',
  'resolved',
] as const;

export type AgentAlertStatus = (typeof AGENT_ALERT_STATUSES)[number];

export const AGENT_FUNDING_OVERRIDE_STATUSES = [
  'active',
  'used',
  'revoked',
] as const;

export type AgentFundingOverrideStatus = (typeof AGENT_FUNDING_OVERRIDE_STATUSES)[number];

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isWalletAgentStatus(value: unknown): value is WalletAgentStatus {
  return includesString(WALLET_AGENT_STATUSES, value);
}

export function isAgentAlertSeverity(value: unknown): value is AgentAlertSeverity {
  return includesString(AGENT_ALERT_SEVERITIES, value);
}

export function isAgentAlertStatus(value: unknown): value is AgentAlertStatus {
  return includesString(AGENT_ALERT_STATUSES, value);
}

export function isAgentFundingOverrideStatus(value: unknown): value is AgentFundingOverrideStatus {
  return includesString(AGENT_FUNDING_OVERRIDE_STATUSES, value);
}
