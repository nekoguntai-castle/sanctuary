/**
 * Push API Tests
 *
 * The web client only reads the user's registered mobile push devices; the
 * register/unregister routes are called by the mobile app.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { getPushDevices, PushDevicesResponseSchema } from '../../src/api/push';

const device = {
  id: 'device-1',
  platform: 'ios',
  deviceName: 'iPhone',
  lastUsedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('push API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the current user devices with response validation', async () => {
    mockGet.mockResolvedValue({ devices: [device] });

    await expect(getPushDevices()).resolves.toEqual([device]);
    expect(mockGet).toHaveBeenCalledWith('/push/devices', undefined, undefined, {
      schema: PushDevicesResponseSchema,
    });
  });

  it('returns an empty list when no devices are registered', async () => {
    mockGet.mockResolvedValue({ devices: [] });

    await expect(getPushDevices()).resolves.toEqual([]);
  });

  it('propagates request failures to the caller', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    await expect(getPushDevices()).rejects.toThrow('network down');
  });

  describe('PushDevicesResponseSchema', () => {
    it('accepts the server shape including a null device name', () => {
      expect(PushDevicesResponseSchema.safeParse({ devices: [{ ...device, deviceName: null, platform: 'android' }] }).success).toBe(true);
    });

    it('rejects a body without a devices array', () => {
      expect(PushDevicesResponseSchema.safeParse({}).success).toBe(false);
      expect(PushDevicesResponseSchema.safeParse({ devices: [{ id: 'x' }] }).success).toBe(false);
    });
  });
});
