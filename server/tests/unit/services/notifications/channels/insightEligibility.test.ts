import { describe, expect, it } from 'vitest';
import { eligibleInsightWalletSettings } from '../../../../../src/services/notifications/channels/insightEligibility';

const insight = { severity: 'warning', type: 'utxo_health' };
const prefs = (wallet: Record<string, unknown>) => ({ intelligence: { wallets: { w1: wallet } } });

describe('eligibleInsightWalletSettings', () => {
  it('returns null without preferences or wallet settings', () => {
    expect(eligibleInsightWalletSettings(null, 'w1', insight)).toBeNull();
    expect(eligibleInsightWalletSettings({}, 'w1', insight)).toBeNull();
    expect(eligibleInsightWalletSettings(prefs({ enabled: true }), 'w2', insight)).toBeNull();
  });

  it('returns null when intelligence is disabled for the wallet', () => {
    expect(eligibleInsightWalletSettings(prefs({ enabled: false }), 'w1', insight)).toBeNull();
  });

  it('applies the severity filter, defaulting to info', () => {
    expect(eligibleInsightWalletSettings(prefs({ enabled: true }), 'w1', { ...insight, severity: 'info' }))
      .not.toBeNull();
    expect(eligibleInsightWalletSettings(prefs({ enabled: true, severityFilter: 'critical' }), 'w1', insight))
      .toBeNull();
    expect(eligibleInsightWalletSettings(prefs({ enabled: true, severityFilter: 'warning' }), 'w1', insight))
      .not.toBeNull();
  });

  it('applies the type filter when present', () => {
    expect(eligibleInsightWalletSettings(prefs({ enabled: true, typeFilter: ['tax'] }), 'w1', insight))
      .toBeNull();
    const settings = eligibleInsightWalletSettings(
      prefs({ enabled: true, typeFilter: ['utxo_health'], notifyPush: false }),
      'w1',
      insight,
    );
    expect(settings?.notifyPush).toBe(false);
  });
});
