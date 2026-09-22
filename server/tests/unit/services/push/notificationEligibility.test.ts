import { describe, expect, it } from 'vitest';

import { isWalletTransactionNotificationEnabled } from '../../../../src/services/push/notificationEligibility';

const preferences = (settings: Record<string, unknown>) => ({
  telegram: { wallets: { 'wallet-1': settings } },
});

describe('isWalletTransactionNotificationEnabled', () => {
  it.each([
    ['received', 'notifyReceived'],
    ['sent', 'notifySent'],
    ['consolidation', 'notifyConsolidation'],
  ] as const)('requires enabled and %s direction preference', (type, key) => {
    const enabled = {
      enabled: true,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      [key]: true,
    };
    expect(isWalletTransactionNotificationEnabled(preferences(enabled), 'wallet-1', type)).toBe(true);
    expect(isWalletTransactionNotificationEnabled(preferences({ ...enabled, [key]: false }), 'wallet-1', type)).toBe(false);
    expect(isWalletTransactionNotificationEnabled(preferences({ ...enabled, enabled: false }), 'wallet-1', type)).toBe(false);
  });

  it('fails closed for absent settings and unknown transaction directions', () => {
    expect(isWalletTransactionNotificationEnabled(null, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled({}, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled({ telegram: null }, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled({ telegram: {} }, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled({ telegram: { wallets: null } }, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled({ telegram: { wallets: {} } }, 'wallet-1', 'received')).toBe(false);
    expect(isWalletTransactionNotificationEnabled(preferences({ enabled: true }), 'wallet-1', 'other')).toBe(false);
  });
});
