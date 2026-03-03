import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig, mockGenerateRequestSignature, mockLogger } = vi.hoisted(() => ({
  mockConfig: {
    backendUrl: 'http://backend:3000',
    gatewaySecret: 'gateway-secret-with-32-characters!!',
  },
  mockGenerateRequestSignature: vi.fn(() => ({
    signature: 'sig-123',
    timestamp: '1700000000000',
  })),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/services/backendEvents/auth', () => ({
  generateRequestSignature: mockGenerateRequestSignature,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  getDevicesForUser,
  removeInvalidDevice,
} from '../../../src/services/backendEvents/deviceTokens';

describe('backendEvents deviceTokens', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockConfig.gatewaySecret = 'gateway-secret-with-32-characters!!';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getDevicesForUser', () => {
    it('uses signed headers when gateway secret is configured', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: 'd1', platform: 'ios', pushToken: 'tok', userId: 'u1' },
        ]),
      });

      const devices = await getDevicesForUser('u1');

      expect(mockGenerateRequestSignature).toHaveBeenCalledWith(
        'GET',
        '/api/v1/push/by-user/u1',
        null
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://backend:3000/api/v1/push/by-user/u1',
        {
          headers: {
            'X-Gateway-Signature': 'sig-123',
            'X-Gateway-Timestamp': '1700000000000',
          },
        }
      );
      expect(devices).toEqual([{ id: 'd1', platform: 'ios', pushToken: 'tok', userId: 'u1' }]);
    });

    it('falls back to legacy gateway header when secret is not configured', async () => {
      mockConfig.gatewaySecret = '';
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getDevicesForUser('u1');

      expect(mockGenerateRequestSignature).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://backend:3000/api/v1/push/by-user/u1',
        {
          headers: {
            'X-Gateway-Request': 'true',
          },
        }
      );
    });

    it('returns empty list for non-success responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      await expect(getDevicesForUser('u1')).resolves.toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch devices for user',
        expect.objectContaining({ userId: 'u1', status: 503 })
      );
    });

    it('returns empty list on fetch failures', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      await expect(getDevicesForUser('u1')).resolves.toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching devices',
        expect.objectContaining({ error: 'network down' })
      );
    });
  });

  describe('removeInvalidDevice', () => {
    it('uses signed delete request and logs successful cleanup', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await removeInvalidDevice('device-1', 'abcdefghijklmnopqrstuvwxyz');

      expect(mockGenerateRequestSignature).toHaveBeenCalledWith(
        'DELETE',
        '/api/v1/push/device/device-1',
        null
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://backend:3000/api/v1/push/device/device-1',
        {
          method: 'DELETE',
          headers: {
            'X-Gateway-Signature': 'sig-123',
            'X-Gateway-Timestamp': '1700000000000',
          },
        }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Removed invalid push token',
        expect.objectContaining({ deviceId: 'device-1', token: 'abcdefghij...' })
      );
    });

    it('warns when backend does not accept token removal', async () => {
      mockConfig.gatewaySecret = '';
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      await removeInvalidDevice('device-2', 'tok-2');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://backend:3000/api/v1/push/device/device-2',
        {
          method: 'DELETE',
          headers: {
            'X-Gateway-Request': 'true',
          },
        }
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to remove invalid token',
        expect.objectContaining({ deviceId: 'device-2', status: 404 })
      );
    });

    it('logs errors from removal failures without throwing', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'));

      await expect(removeInvalidDevice('device-3', 'tok-3')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error removing invalid token',
        expect.objectContaining({ deviceId: 'device-3', error: 'timeout' })
      );
    });
  });
});
