import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  NotificationService,
  getNotificationService,
  notificationService,
  walletLog,
} from '../../../src/websocket/notifications';
import { walletLogBuffer } from '../../../src/services/walletLogBuffer';
import { getWebSocketServerIfInitialized } from '../../../src/websocket/server';

export function registerSingletonAndWalletLogTests(mockBroadcast: Mock): void {
  describe('Singleton exports', () => {
    it('should export singleton notificationService', () => {
      expect(notificationService).toBeInstanceOf(NotificationService);
    });

    it('should return same instance from getNotificationService', () => {
      expect(getNotificationService()).toBe(notificationService);
    });
  });

  describe('walletLog helper', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should send log entry via notification service', () => {
      walletLog('wallet-123', 'info', 'sync', 'Test log message');

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'log',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            level: 'info',
            module: 'sync',
            message: 'Test log message',
          }),
        })
      );
    });

    it('should include details when provided', () => {
      walletLog('wallet-123', 'error', 'bitcoin', 'Failed to broadcast', {
        txid: 'tx-abc',
        error: 'Insufficient fee',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: {
              txid: 'tx-abc',
              error: 'Insufficient fee',
            },
          }),
        })
      );
    });

    it('should handle all log levels', () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const;

      for (const level of levels) {
        vi.clearAllMocks();
        walletLog('wallet-123', level, 'test', `${level} message`);

        expect(mockBroadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              level,
            }),
          })
        );
      }
    });

    it('should skip websocket-only delivery when the server is unavailable', () => {
      vi.mocked(getWebSocketServerIfInitialized).mockReturnValueOnce(null as any);

      expect(() => walletLog('wallet-123', 'info', 'sync', 'server unavailable')).not.toThrow();
      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(walletLogBuffer.add).toHaveBeenCalled();
    });
  });
}
