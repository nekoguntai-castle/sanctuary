import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GATEWAY_NOTIFIED_EVENT_TYPES } from '@sanctuary/shared/constants/gatewayEvents';

const { mockFormatTransactionNotification } = vi.hoisted(() => ({
  mockFormatTransactionNotification: vi.fn((_type, walletName, amount, txid) => ({
    title: `tx:${walletName}`,
    body: `${amount}`,
    data: { txid },
  })),
}));

vi.mock('../../../src/services/push', () => ({
  formatTransactionNotification: mockFormatTransactionNotification,
}));

import {
  formatNotificationForEvent,
  PUSH_EVENT_TYPES,
} from '../../../src/services/backendEvents/notifications';
import type { BackendEvent } from '../../../src/services/backendEvents/types';

describe('backendEvents notifications formatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes exactly the shared gateway-notified event vocabulary', () => {
    expect(PUSH_EVENT_TYPES).toEqual(GATEWAY_NOTIFIED_EVENT_TYPES);
    expect(PUSH_EVENT_TYPES).toEqual([
      'transaction',
      'confirmation',
      'ai_insight',
      'consolidation_suggestion',
    ]);
  });

  it('ignores event types the server never produces, such as draft_created', () => {
    const retiredType = 'draft_created';
    expect(PUSH_EVENT_TYPES).not.toContain(retiredType);
    expect(formatNotificationForEvent({
      type: retiredType as unknown as BackendEvent['type'],
      walletId: 'wallet-1',
      data: { amount: 5000 },
    })).toBeNull();
  });

  it('formats a consolidation as its own notification type, not as a sent payment', () => {
    const notification = formatNotificationForEvent({
      type: 'transaction',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      data: {
        txid: 'tx-1',
        type: 'consolidation',
        amount: 9000,
      },
    });

    expect(mockFormatTransactionNotification).toHaveBeenCalledWith(
      'consolidation',
      'Treasury',
      9000,
      'tx-1'
    );
    expect(notification).not.toBeNull();
  });

  it('returns null for malformed transaction events', () => {
    expect(
      formatNotificationForEvent({
        type: 'transaction',
        walletId: 'wallet-1',
        data: { type: 'received', amount: 1000 }, // missing txid
      })
    ).toBeNull();
  });

  it('formats only first confirmation events', () => {
    const first = formatNotificationForEvent({
      type: 'confirmation',
      walletId: 'wallet-1',
      data: { confirmations: 1, txid: 'tx-1', amount: 1000 },
    });
    const second = formatNotificationForEvent({
      type: 'confirmation',
      walletId: 'wallet-1',
      data: { confirmations: 2, txid: 'tx-1', amount: 1000 },
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('uses the server milestone rule when previousConfirmations is present', () => {
    const format = (previousConfirmations: number, confirmations: number) => formatNotificationForEvent({
      type: 'confirmation',
      walletId: 'wallet-1',
      data: { previousConfirmations, confirmations, txid: 'tx-1', amount: 1000 },
    });

    // A block can jump 0 -> 2; that is still the first confirmation.
    expect(format(0, 2)).not.toBeNull();
    expect(format(0, 1)).not.toBeNull();
    expect(format(1, 2)).toBeNull();
    expect(format(2, 1)).toBeNull();
    expect(formatNotificationForEvent({
      type: 'confirmation',
      walletId: 'wallet-1',
      data: { previousConfirmations: 0, txid: 'tx-1' },
    })).toBeNull();
  });

  it('uses zero-amount fallback for first confirmation when amount is missing', () => {
    const notification = formatNotificationForEvent({
      type: 'confirmation',
      walletId: 'wallet-1',
      data: { confirmations: 1, txid: 'tx-fallback' },
    });

    expect(mockFormatTransactionNotification).toHaveBeenCalledWith(
      'confirmed',
      'Wallet',
      0,
      'tx-fallback'
    );
    expect(notification).not.toBeNull();
  });

  it('returns null for forwarded events that are not pushed', () => {
    const notification = formatNotificationForEvent({
      type: 'balance',
      walletId: 'wallet-1',
      data: {},
    });

    expect(notification).toBeNull();
  });

  describe('wallet-level gateway push events', () => {
    it('formats a minimal ai_insight notification with the server-supplied type label', () => {
      expect(formatNotificationForEvent({
        type: 'ai_insight',
        walletId: 'wallet-1',
        walletName: 'Treasury',
        userIds: ['user-1'],
        data: {
          insightId: 'insight-1',
          insightType: 'utxo_health',
          insightTypeLabel: 'UTXO Health',
          severity: 'warning',
        },
      })).toEqual({
        title: 'Treasury Intelligence',
        body: 'Treasury: warning UTXO Health insight',
        data: { walletId: 'wallet-1', insightId: 'insight-1', kind: 'ai_insight' },
      });
    });

    it('falls back to the raw insight type, then a generic label, and the default wallet name', () => {
      expect(formatNotificationForEvent({
        type: 'ai_insight',
        walletId: 'wallet-1',
        data: { insightId: 'insight-1', insightType: 'fee_timing', severity: 'info' },
      })?.body).toBe('Wallet: info fee_timing insight');
      expect(formatNotificationForEvent({
        type: 'ai_insight',
        walletId: 'wallet-1',
        data: { insightId: 'insight-1', severity: 'critical' },
      })?.body).toBe('Wallet: critical wallet insight');
    });

    it('drops ai_insight events missing the insight id or severity', () => {
      expect(formatNotificationForEvent({
        type: 'ai_insight',
        walletId: 'wallet-1',
        data: { severity: 'warning' },
      })).toBeNull();
      expect(formatNotificationForEvent({
        type: 'ai_insight',
        walletId: 'wallet-1',
        data: { insightId: 'insight-1' },
      })).toBeNull();
    });

    it('formats a minimal consolidation_suggestion notification', () => {
      expect(formatNotificationForEvent({
        type: 'consolidation_suggestion',
        walletId: 'wallet-1',
        walletName: 'Treasury',
        userIds: ['user-1'],
        data: { feeRate: 3 },
      })).toEqual({
        title: 'Consolidation opportunity',
        body: 'Treasury: fees are low (3 sat/vB)',
        data: { walletId: 'wallet-1', kind: 'consolidation_suggestion' },
      });
    });

    it('drops consolidation_suggestion events without a finite fee rate', () => {
      expect(formatNotificationForEvent({
        type: 'consolidation_suggestion',
        walletId: 'wallet-1',
        data: {},
      })).toBeNull();
      expect(formatNotificationForEvent({
        type: 'consolidation_suggestion',
        walletId: 'wallet-1',
        data: { feeRate: Number.NaN },
      })).toBeNull();
    });
  });
});
