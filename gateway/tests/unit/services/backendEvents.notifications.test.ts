import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFormatTransactionNotification,
  mockFormatBroadcastNotification,
  mockFormatPsbtSigningNotification,
  mockFormatDraftCreatedNotification,
  mockFormatDraftApprovedNotification,
} = vi.hoisted(() => ({
  mockFormatTransactionNotification: vi.fn((_type, walletName, amount, txid) => ({
    title: `tx:${walletName}`,
    body: `${amount}`,
    data: { txid },
  })),
  mockFormatBroadcastNotification: vi.fn((_success, walletName, txid, error) => ({
    title: `broadcast:${walletName}`,
    body: error || '',
    data: { txid },
  })),
  mockFormatPsbtSigningNotification: vi.fn((_walletName, draftId) => ({
    title: 'psbt',
    body: '',
    data: { draftId },
  })),
  mockFormatDraftCreatedNotification: vi.fn((_walletName, draftId) => ({
    title: 'draft-created',
    body: '',
    data: { draftId },
  })),
  mockFormatDraftApprovedNotification: vi.fn((_walletName, draftId) => ({
    title: 'draft-approved',
    body: '',
    data: { draftId },
  })),
}));

vi.mock('../../../src/services/push', () => ({
  formatTransactionNotification: mockFormatTransactionNotification,
  formatBroadcastNotification: mockFormatBroadcastNotification,
  formatPsbtSigningNotification: mockFormatPsbtSigningNotification,
  formatDraftCreatedNotification: mockFormatDraftCreatedNotification,
  formatDraftApprovedNotification: mockFormatDraftApprovedNotification,
}));

import {
  formatNotificationForEvent,
  PUSH_EVENT_TYPES,
} from '../../../src/services/backendEvents/notifications';

describe('backendEvents notifications formatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the expected push-capable backend event list', () => {
    expect(PUSH_EVENT_TYPES).toEqual([
      'transaction',
      'confirmation',
      'broadcast_success',
      'broadcast_failed',
      'psbt_signing_required',
      'draft_created',
      'draft_approved',
      'ai_insight',
      'consolidation_suggestion',
    ]);
  });

  it('formats transaction event and maps consolidation to sent', () => {
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
      'sent',
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

  it('formats broadcast success/failure with defaults', () => {
    const success = formatNotificationForEvent({
      type: 'broadcast_success',
      walletId: 'wallet-1',
      walletName: 'Main Wallet',
      data: { txid: 'tx-ok' },
    });
    const failed = formatNotificationForEvent({
      type: 'broadcast_failed',
      walletId: 'wallet-1',
      data: { error: 'rejected by mempool' }, // txid intentionally missing
    });

    expect(success).not.toBeNull();
    expect(mockFormatBroadcastNotification).toHaveBeenCalledWith(
      false,
      'Wallet',
      '',
      'rejected by mempool'
    );
    expect(failed).not.toBeNull();
  });

  it('returns null for broadcast success events missing txid', () => {
    const notification = formatNotificationForEvent({
      type: 'broadcast_success',
      walletId: 'wallet-1',
      walletName: 'Main Wallet',
      data: {},
    });

    expect(notification).toBeNull();
    expect(mockFormatBroadcastNotification).not.toHaveBeenCalledWith(
      true,
      expect.any(String),
      expect.any(String)
    );
  });

  it('formats PSBT signing requests with default signer counts and creator', () => {
    const notification = formatNotificationForEvent({
      type: 'psbt_signing_required',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      data: {
        draftId: 'draft-1',
        amount: 25_000,
      },
    });

    expect(mockFormatPsbtSigningNotification).toHaveBeenCalledWith(
      'Treasury',
      'draft-1',
      'Someone',
      25_000,
      2,
      1
    );
    expect(notification).not.toBeNull();
  });

  it('formats draft created and approved events with defaults', () => {
    const created = formatNotificationForEvent({
      type: 'draft_created',
      walletId: 'wallet-1',
      data: {
        draftId: 'draft-a',
        amount: 5000,
      },
    });
    const approved = formatNotificationForEvent({
      type: 'draft_approved',
      walletId: 'wallet-1',
      data: {
        draftId: 'draft-a',
      },
    });

    expect(mockFormatDraftCreatedNotification).toHaveBeenCalledWith(
      'Wallet',
      'draft-a',
      'Someone',
      5000
    );
    expect(mockFormatDraftApprovedNotification).toHaveBeenCalledWith(
      'Wallet',
      'draft-a',
      'Someone',
      0,
      0
    );
    expect(created).not.toBeNull();
    expect(approved).not.toBeNull();
  });

  it('returns null for unknown event types', () => {
    const notification = formatNotificationForEvent({
      type: 'balance' as any,
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
