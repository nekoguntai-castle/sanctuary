import { describe, expect, it } from 'vitest';
import {
  AGENT_ALERT_SEVERITIES,
  AGENT_ALERT_STATUSES,
  AGENT_FUNDING_OVERRIDE_STATUSES,
  WALLET_AGENT_STATUSES,
  WALLET_AGENT_TOGGLE_STATUSES,
  isAgentAlertSeverity,
  isAgentAlertStatus,
  isAgentFundingOverrideStatus,
  isWalletAgentStatus,
} from '@sanctuary/shared/constants/adminAgents';

describe('admin agent constants', () => {
  it('defines wallet-agent status domains', () => {
    expect(WALLET_AGENT_STATUSES).toEqual(['active', 'paused', 'revoked']);
    expect(WALLET_AGENT_TOGGLE_STATUSES).toEqual(['active', 'paused']);
    expect(AGENT_ALERT_SEVERITIES).toEqual(['info', 'warning', 'critical']);
    expect(AGENT_ALERT_STATUSES).toEqual(['open', 'acknowledged', 'resolved']);
    expect(AGENT_FUNDING_OVERRIDE_STATUSES).toEqual(['active', 'used', 'revoked']);
  });

  it('guards each domain independently', () => {
    expect(isWalletAgentStatus('active')).toBe(true);
    expect(isWalletAgentStatus('used')).toBe(false);
    expect(isAgentAlertSeverity('critical')).toBe(true);
    expect(isAgentAlertSeverity('resolved')).toBe(false);
    expect(isAgentAlertStatus('resolved')).toBe(true);
    expect(isAgentAlertStatus('critical')).toBe(false);
    expect(isAgentFundingOverrideStatus('used')).toBe(true);
    expect(isAgentFundingOverrideStatus('paused')).toBe(false);
  });
});
