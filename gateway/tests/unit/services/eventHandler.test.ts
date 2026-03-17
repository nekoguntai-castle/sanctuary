/**
 * Event Handler Unit Tests
 *
 * Tests handleEvent() in isolation by mocking its dependencies:
 * push service, device tokens, and notification formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockSendToDevices = vi.fn();
vi.mock('../../../src/services/push', () => ({
  sendToDevices: (...args: unknown[]) => mockSendToDevices(...args),
}));

const mockGetDevicesForUser = vi.fn();
const mockRemoveInvalidDevice = vi.fn();
vi.mock('../../../src/services/backendEvents/deviceTokens', () => ({
  getDevicesForUser: (...args: unknown[]) => mockGetDevicesForUser(...args),
  removeInvalidDevice: (...args: unknown[]) => mockRemoveInvalidDevice(...args),
}));

const mockFormatNotificationForEvent = vi.fn();
vi.mock('../../../src/services/backendEvents/notifications', () => ({
  PUSH_EVENT_TYPES: [
    'transaction',
    'confirmation',
    'broadcast_success',
    'broadcast_failed',
    'psbt_signing_required',
    'draft_created',
    'draft_approved',
  ],
  formatNotificationForEvent: (...args: unknown[]) => mockFormatNotificationForEvent(...args),
}));

import { handleEvent } from '../../../src/services/backendEvents/eventHandler';
import type { BackendEvent } from '../../../src/services/backendEvents/types';

describe('handleEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip events that are not push event types', async () => {
    await handleEvent({ type: 'balance', walletId: 'w1', userId: 'u1', data: {} });
    await handleEvent({ type: 'sync', walletId: 'w1', userId: 'u1', data: {} });

    expect(mockGetDevicesForUser).not.toHaveBeenCalled();
    expect(mockSendToDevices).not.toHaveBeenCalled();
  });

  it('should skip events without userId', async () => {
    await handleEvent({
      type: 'transaction',
      walletId: 'w1',
      data: { txid: 'tx1', type: 'received', amount: 1000 },
    } as BackendEvent);

    expect(mockGetDevicesForUser).not.toHaveBeenCalled();
  });

  it('should skip when user has no registered devices', async () => {
    mockGetDevicesForUser.mockResolvedValue([]);

    await handleEvent({
      type: 'transaction',
      walletId: 'w1',
      userId: 'u1',
      data: { txid: 'tx1', type: 'received', amount: 1000 },
    });

    expect(mockGetDevicesForUser).toHaveBeenCalledWith('u1');
    expect(mockSendToDevices).not.toHaveBeenCalled();
  });

  it('should skip when formatNotificationForEvent returns null', async () => {
    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'android', pushToken: 'tok1', userId: 'u1' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue(null);

    await handleEvent({
      type: 'transaction',
      walletId: 'w1',
      userId: 'u1',
      data: { txid: 'tx1', type: 'received', amount: 1000 },
    });

    expect(mockFormatNotificationForEvent).toHaveBeenCalled();
    expect(mockSendToDevices).not.toHaveBeenCalled();
  });

  it('should send push notification for valid event', async () => {
    const devices = [
      { id: 'd1', platform: 'android', pushToken: 'tok1', userId: 'u1' },
      { id: 'd2', platform: 'ios', pushToken: 'tok2', userId: 'u1' },
    ];
    const notification = { title: 'Bitcoin Received', body: 'Main: 1000 sats', data: {} };

    mockGetDevicesForUser.mockResolvedValue(devices);
    mockFormatNotificationForEvent.mockReturnValue(notification);
    mockSendToDevices.mockResolvedValue({ success: 2, failed: 0, invalidTokens: [] });

    await handleEvent({
      type: 'transaction',
      walletId: 'w1',
      walletName: 'Main',
      userId: 'u1',
      data: { txid: 'tx1', type: 'received', amount: 1000 },
    });

    expect(mockSendToDevices).toHaveBeenCalledWith(
      [
        { id: 'd1', platform: 'android', pushToken: 'tok1' },
        { id: 'd2', platform: 'ios', pushToken: 'tok2' },
      ],
      notification
    );
  });

  it('should map device fields correctly (only id, platform, pushToken)', async () => {
    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'ios', pushToken: 'apns-tok', userId: 'u1', extraField: 'ignored' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue({ title: 'Test', body: 'Test', data: {} });
    mockSendToDevices.mockResolvedValue({ success: 1, failed: 0, invalidTokens: [] });

    await handleEvent({
      type: 'broadcast_success',
      walletId: 'w1',
      userId: 'u1',
      data: { txid: 'tx1' },
    });

    const pushDevices = mockSendToDevices.mock.calls[0][0];
    expect(pushDevices[0]).toEqual({ id: 'd1', platform: 'ios', pushToken: 'apns-tok' });
    expect(pushDevices[0]).not.toHaveProperty('userId');
    expect(pushDevices[0]).not.toHaveProperty('extraField');
  });

  it('should remove invalid tokens after push delivery', async () => {
    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'android', pushToken: 'bad-tok', userId: 'u1' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue({ title: 'Test', body: 'Test', data: {} });
    mockSendToDevices.mockResolvedValue({
      success: 0,
      failed: 1,
      invalidTokens: [{ id: 'd1', token: 'bad-tok' }],
    });
    mockRemoveInvalidDevice.mockResolvedValue(undefined);

    await handleEvent({
      type: 'transaction',
      walletId: 'w1',
      userId: 'u1',
      data: { txid: 'tx1', type: 'sent', amount: 5000 },
    });

    expect(mockRemoveInvalidDevice).toHaveBeenCalledWith('d1', 'bad-tok');
  });

  it('should remove multiple invalid tokens sequentially', async () => {
    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'android', pushToken: 'tok1', userId: 'u1' },
      { id: 'd2', platform: 'ios', pushToken: 'tok2', userId: 'u1' },
      { id: 'd3', platform: 'android', pushToken: 'tok3', userId: 'u1' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue({ title: 'Test', body: 'Test', data: {} });
    mockSendToDevices.mockResolvedValue({
      success: 1,
      failed: 2,
      invalidTokens: [
        { id: 'd1', token: 'tok1' },
        { id: 'd3', token: 'tok3' },
      ],
    });
    mockRemoveInvalidDevice.mockResolvedValue(undefined);

    await handleEvent({
      type: 'draft_created',
      walletId: 'w1',
      userId: 'u1',
      data: { draftId: 'dr1', amount: 100000, creatorName: 'Alice' },
    });

    expect(mockRemoveInvalidDevice).toHaveBeenCalledTimes(2);
    expect(mockRemoveInvalidDevice).toHaveBeenCalledWith('d1', 'tok1');
    expect(mockRemoveInvalidDevice).toHaveBeenCalledWith('d3', 'tok3');
  });

  it('should not call removeInvalidDevice when there are no invalid tokens', async () => {
    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'android', pushToken: 'tok1', userId: 'u1' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue({ title: 'Test', body: 'Test', data: {} });
    mockSendToDevices.mockResolvedValue({ success: 1, failed: 0, invalidTokens: [] });

    await handleEvent({
      type: 'draft_approved',
      walletId: 'w1',
      userId: 'u1',
      data: { draftId: 'dr1', signerName: 'Bob' },
    });

    expect(mockRemoveInvalidDevice).not.toHaveBeenCalled();
  });

  it('should handle all push event types', async () => {
    const pushTypes = [
      'transaction',
      'confirmation',
      'broadcast_success',
      'broadcast_failed',
      'psbt_signing_required',
      'draft_created',
      'draft_approved',
    ] as const;

    for (const type of pushTypes) {
      vi.clearAllMocks();
      mockGetDevicesForUser.mockResolvedValue([
        { id: 'd1', platform: 'android', pushToken: 'tok1', userId: 'u1' },
      ]);
      mockFormatNotificationForEvent.mockReturnValue({ title: 'Test', body: 'Test', data: {} });
      mockSendToDevices.mockResolvedValue({ success: 1, failed: 0, invalidTokens: [] });

      await handleEvent({
        type,
        walletId: 'w1',
        userId: 'u1',
        data: { txid: 'tx1', type: 'received', amount: 1000 },
      } as BackendEvent);

      expect(mockGetDevicesForUser).toHaveBeenCalledWith('u1');
    }
  });

  it('should pass the full event to formatNotificationForEvent', async () => {
    const event: BackendEvent = {
      type: 'psbt_signing_required',
      walletId: 'w1',
      walletName: 'Vault',
      userId: 'u1',
      data: {
        draftId: 'dr1',
        creatorName: 'Alice',
        amount: 500000,
        requiredSignatures: 3,
        currentSignatures: 1,
      },
    };

    mockGetDevicesForUser.mockResolvedValue([
      { id: 'd1', platform: 'ios', pushToken: 'tok1', userId: 'u1' },
    ]);
    mockFormatNotificationForEvent.mockReturnValue({ title: 'Sign', body: 'Sign please', data: {} });
    mockSendToDevices.mockResolvedValue({ success: 1, failed: 0, invalidTokens: [] });

    await handleEvent(event);

    expect(mockFormatNotificationForEvent).toHaveBeenCalledWith(event);
  });
});
