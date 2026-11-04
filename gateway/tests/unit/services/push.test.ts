/**
 * Push Notification Service Tests
 *
 * Tests the unified push notification interface and notification formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the sub-services
vi.mock('../../../src/services/push/fcm', () => ({
  initializeFCM: vi.fn(() => true),
  isFCMAvailable: vi.fn(() => true),
  sendToDevice: vi.fn(),
  sendToDevices: vi.fn(),
}));

vi.mock('../../../src/services/push/apns', () => ({
  initializeAPNs: vi.fn(() => true),
  isAPNsAvailable: vi.fn(() => true),
  shutdownAPNs: vi.fn(),
  sendToDevice: vi.fn(),
  sendToDevices: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as fcm from '../../../src/services/push/fcm';
import * as apns from '../../../src/services/push/apns';
import {
  initializePushServices,
  shutdownPushServices,
  sendToDevice,
  sendToDevices,
  formatTransactionNotification,
  Device,
  PushNotification,
} from '../../../src/services/push';

describe('Push Notification Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset availability to default (both available)
    vi.mocked(fcm.isFCMAvailable).mockReturnValue(true);
    vi.mocked(apns.isAPNsAvailable).mockReturnValue(true);
  });

  describe('initializePushServices', () => {
    it('should initialize both FCM and APNs', () => {
      initializePushServices();

      expect(fcm.initializeFCM).toHaveBeenCalled();
      expect(apns.initializeAPNs).toHaveBeenCalled();
    });
  });

  describe('shutdownPushServices', () => {
    it('should shutdown APNs provider', () => {
      shutdownPushServices();

      expect(apns.shutdownAPNs).toHaveBeenCalled();
    });
  });

  describe('sendToDevice', () => {
    const notification: PushNotification = {
      title: 'Test Title',
      body: 'Test Body',
      data: { key: 'value' },
    };

    describe('Android devices', () => {
      const androidDevice: Device = {
        id: 'device-1',
        platform: 'android',
        pushToken: 'fcm-token-123',
      };

      it('should send to Android device via FCM', async () => {
        vi.mocked(fcm.sendToDevice).mockResolvedValue({ success: true });

        const result = await sendToDevice(androidDevice, notification);

        expect(fcm.sendToDevice).toHaveBeenCalledWith('fcm-token-123', notification);
        expect(result.success).toBe(true);
      });

      it('should return error when FCM is not available', async () => {
        vi.mocked(fcm.isFCMAvailable).mockReturnValue(false);

        const result = await sendToDevice(androidDevice, notification);

        expect(result.success).toBe(false);
        expect(result.error).toBe('FCM not configured');
      });

      it('should handle invalid token response', async () => {
        vi.mocked(fcm.sendToDevice).mockResolvedValue({
          success: false,
          error: 'invalid_token',
        });

        const result = await sendToDevice(androidDevice, notification);

        expect(result.success).toBe(false);
        expect(result.invalidToken).toBe(true);
      });
    });

    describe('iOS devices', () => {
      const iosDevice: Device = {
        id: 'device-2',
        platform: 'ios',
        pushToken: 'apns-token-456',
      };

      it('should send to iOS device via APNs', async () => {
        vi.mocked(apns.sendToDevice).mockResolvedValue({ success: true });

        const result = await sendToDevice(iosDevice, notification);

        expect(apns.sendToDevice).toHaveBeenCalledWith('apns-token-456', notification);
        expect(result.success).toBe(true);
      });

      it('should return error when APNs is not available', async () => {
        vi.mocked(apns.isAPNsAvailable).mockReturnValue(false);

        const result = await sendToDevice(iosDevice, notification);

        expect(result.success).toBe(false);
        expect(result.error).toBe('APNs not configured');
      });

      it('should handle invalid token response', async () => {
        vi.mocked(apns.sendToDevice).mockResolvedValue({
          success: false,
          error: 'invalid_token',
        });

        const result = await sendToDevice(iosDevice, notification);

        expect(result.success).toBe(false);
        expect(result.invalidToken).toBe(true);
      });
    });

    it('should return error for unknown platform', async () => {
      const unknownDevice = {
        id: 'device-3',
        platform: 'windows' as 'ios' | 'android',
        pushToken: 'token',
      };

      const result = await sendToDevice(unknownDevice, notification);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown platform');
    });
  });

  describe('sendToDevices', () => {
    const notification: PushNotification = {
      title: 'Batch Test',
      body: 'Batch Body',
    };

    it('should route devices to correct services', async () => {
      const devices: Device[] = [
        { id: 'd1', platform: 'android', pushToken: 'fcm-1' },
        { id: 'd2', platform: 'android', pushToken: 'fcm-2' },
        { id: 'd3', platform: 'ios', pushToken: 'apns-1' },
      ];

      vi.mocked(fcm.sendToDevices).mockResolvedValue({
        success: 2,
        failed: 0,
        invalidTokens: [],
      });

      vi.mocked(apns.sendToDevices).mockResolvedValue({
        success: 1,
        failed: 0,
        invalidTokens: [],
      });

      const result = await sendToDevices(devices, notification);

      expect(fcm.sendToDevices).toHaveBeenCalledWith(['fcm-1', 'fcm-2'], notification);
      expect(apns.sendToDevices).toHaveBeenCalledWith(['apns-1'], notification);
      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should collect invalid tokens from both services', async () => {
      const devices: Device[] = [
        { id: 'd1', platform: 'android', pushToken: 'fcm-invalid' },
        { id: 'd2', platform: 'ios', pushToken: 'apns-invalid' },
      ];

      vi.mocked(fcm.sendToDevices).mockResolvedValue({
        success: 0,
        failed: 1,
        invalidTokens: ['fcm-invalid'],
      });

      vi.mocked(apns.sendToDevices).mockResolvedValue({
        success: 0,
        failed: 1,
        invalidTokens: ['apns-invalid'],
      });

      const result = await sendToDevices(devices, notification);

      expect(result.invalidTokens).toHaveLength(2);
      expect(result.invalidTokens).toContainEqual({ id: 'd1', token: 'fcm-invalid' });
      expect(result.invalidTokens).toContainEqual({ id: 'd2', token: 'apns-invalid' });
    });

    it('should count failures when service is not available', async () => {
      vi.mocked(fcm.isFCMAvailable).mockReturnValue(false);
      vi.mocked(apns.isAPNsAvailable).mockReturnValue(false);

      const devices: Device[] = [
        { id: 'd1', platform: 'android', pushToken: 'fcm-1' },
        { id: 'd2', platform: 'ios', pushToken: 'apns-1' },
      ];

      const result = await sendToDevices(devices, notification);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
    });

    it('should handle empty device list', async () => {
      const result = await sendToDevices([], notification);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
    });
  });

  describe('formatTransactionNotification', () => {
    it('should format received transaction notification', () => {
      const notification = formatTransactionNotification(
        'received',
        'Main Wallet',
        50000000, // 0.5 BTC in sats
        'txid123'
      );

      expect(notification.title).toBe('Bitcoin Received');
      expect(notification.body).toBe('Main Wallet: +0.50000000 BTC');
      expect(notification.data).toEqual({
        type: 'transaction',
        txid: 'txid123',
        walletName: 'Main Wallet',
      });
    });

    it('should format sent transaction notification', () => {
      const notification = formatTransactionNotification(
        'sent',
        'Savings',
        -100000, // Production sent events carry a negative wallet delta
        'txid456'
      );

      expect(notification.title).toBe('Bitcoin Sent');
      expect(notification.body).toBe('Savings: -0.00100000 BTC');
      expect(notification.data?.type).toBe('transaction');
    });

    it('should format confirmed transaction notification', () => {
      const notification = formatTransactionNotification(
        'confirmed',
        'Cold Storage',
        100000000, // 1 BTC in sats
        'txid789'
      );

      expect(notification.title).toBe('Transaction Confirmed');
      expect(notification.body).toBe('Cold Storage: 1.00000000 BTC confirmed');
      expect(notification.data?.type).toBe('confirmation');
    });

    it('should handle very small amounts', () => {
      const notification = formatTransactionNotification(
        'received',
        'Test',
        1, // 1 sat
        'txid000'
      );

      expect(notification.body).toBe('Test: +0.00000001 BTC');
    });

    it('should handle large amounts', () => {
      const notification = formatTransactionNotification(
        'received',
        'Whale Wallet',
        2100000000000000, // 21 million BTC in sats
        'txidmax'
      );

      expect(notification.body).toContain('21000000');
    });
  });
});
