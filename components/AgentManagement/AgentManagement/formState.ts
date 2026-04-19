import type { WalletAgentMetadata, WalletAgentStatus } from '../../../src/api/admin';

export const DEFAULT_AGENT_FORM = {
  name: '',
  userId: '',
  fundingWalletId: '',
  operationalWalletId: '',
  signerDeviceId: '',
  status: 'active' as WalletAgentStatus,
  maxFundingAmountSats: '',
  maxOperationalBalanceSats: '',
  dailyFundingLimitSats: '',
  weeklyFundingLimitSats: '',
  cooldownMinutes: '',
  minOperationalBalanceSats: '',
  largeOperationalSpendSats: '',
  largeOperationalFeeSats: '',
  repeatedFailureThreshold: '',
  repeatedFailureLookbackMinutes: '',
  alertDedupeMinutes: '',
  requireHumanApproval: true,
  notifyOnOperationalSpend: true,
  pauseOnUnexpectedSpend: false,
};

export type AgentFormState = typeof DEFAULT_AGENT_FORM;
export type SetAgentFormField = <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => void;

type PolicyFieldKey = keyof Pick<
  AgentFormState,
  'maxFundingAmountSats' | 'maxOperationalBalanceSats' | 'dailyFundingLimitSats' | 'weeklyFundingLimitSats'
>;

type MonitoringSatsFieldKey = keyof Pick<
  AgentFormState,
  'minOperationalBalanceSats' | 'largeOperationalSpendSats' | 'largeOperationalFeeSats'
>;

type MonitoringNumberFieldKey = keyof Pick<
  AgentFormState,
  'repeatedFailureThreshold' | 'repeatedFailureLookbackMinutes' | 'alertDedupeMinutes'
>;

export const POLICY_FIELDS: Array<{
  key: PolicyFieldKey;
  label: string;
  helper: string;
}> = [
  { key: 'maxFundingAmountSats', label: 'Per-request cap', helper: 'Maximum sats in one funding draft.' },
  { key: 'maxOperationalBalanceSats', label: 'Operational balance cap', helper: 'Reject funding when the operational wallet is already above this balance.' },
  { key: 'dailyFundingLimitSats', label: 'Daily cap', helper: 'Maximum accepted funding amount per UTC day.' },
  { key: 'weeklyFundingLimitSats', label: 'Weekly cap', helper: 'Maximum accepted funding amount per UTC week.' },
];

export const MONITORING_SATS_FIELDS: Array<{
  key: MonitoringSatsFieldKey;
  label: string;
  helper: string;
}> = [
  { key: 'minOperationalBalanceSats', label: 'Refill threshold', helper: 'Alert when the operational wallet drops below this balance.' },
  { key: 'largeOperationalSpendSats', label: 'Large spend alert', helper: 'Alert when a single operational spend meets or exceeds this amount.' },
  { key: 'largeOperationalFeeSats', label: 'Large fee alert', helper: 'Alert when an operational transaction fee meets or exceeds this amount.' },
];

export const MONITORING_NUMBER_FIELDS: Array<{
  key: MonitoringNumberFieldKey;
  label: string;
  helper: string;
  placeholder: string;
}> = [
  { key: 'repeatedFailureThreshold', label: 'Rejected attempt alert count', helper: 'Alert after this many rejected funding attempts in the lookback window.', placeholder: 'No alert' },
  { key: 'repeatedFailureLookbackMinutes', label: 'Failure lookback minutes', helper: 'Window used for rejected attempt alerts. Defaults to 60 minutes.', placeholder: '60' },
  { key: 'alertDedupeMinutes', label: 'Alert dedupe minutes', helper: 'Suppress duplicate threshold alerts for this many minutes. Defaults to 60 minutes.', placeholder: '60' },
];

function textValue(value: string | null): string {
  return value ?? '';
}

function numberValue(value: number | null): string {
  return value === null ? '' : value.toString();
}

export function createInitialAgentForm(agent?: WalletAgentMetadata): AgentFormState {
  if (!agent) {
    return { ...DEFAULT_AGENT_FORM };
  }

  return {
    ...DEFAULT_AGENT_FORM,
    name: agent.name,
    userId: agent.userId,
    fundingWalletId: agent.fundingWalletId,
    operationalWalletId: agent.operationalWalletId,
    signerDeviceId: agent.signerDeviceId,
    status: agent.status,
    maxFundingAmountSats: textValue(agent.maxFundingAmountSats),
    maxOperationalBalanceSats: textValue(agent.maxOperationalBalanceSats),
    dailyFundingLimitSats: textValue(agent.dailyFundingLimitSats),
    weeklyFundingLimitSats: textValue(agent.weeklyFundingLimitSats),
    cooldownMinutes: numberValue(agent.cooldownMinutes),
    minOperationalBalanceSats: textValue(agent.minOperationalBalanceSats),
    largeOperationalSpendSats: textValue(agent.largeOperationalSpendSats),
    largeOperationalFeeSats: textValue(agent.largeOperationalFeeSats),
    repeatedFailureThreshold: numberValue(agent.repeatedFailureThreshold),
    repeatedFailureLookbackMinutes: numberValue(agent.repeatedFailureLookbackMinutes),
    alertDedupeMinutes: numberValue(agent.alertDedupeMinutes),
    requireHumanApproval: agent.requireHumanApproval,
    notifyOnOperationalSpend: agent.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: agent.pauseOnUnexpectedSpend,
  };
}
