/**
 * useDevices Hook Tests
 *
 * Tests for the device query hooks (react-query based).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useDevices,
  useDevice,
  useCreateDevice,
  useDeleteDevice,
  useInvalidateDevices,
  deviceKeys,
} from '../../../hooks/queries/useDevices';

// Mock the devices API
vi.mock('../../../src/api/devices', () => ({
  getDevices: vi.fn(),
  getDevice: vi.fn(),
  createDevice: vi.fn(),
  deleteDevice: vi.fn(),
}));

import * as devicesApi from '../../../src/api/devices';

const mockGetDevices = vi.mocked(devicesApi.getDevices);
const mockGetDevice = vi.mocked(devicesApi.getDevice);
const mockCreateDevice = vi.mocked(devicesApi.createDevice);
const mockDeleteDevice = vi.mocked(devicesApi.deleteDevice);

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

// Wrapper component with QueryClientProvider
const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('Device Query Hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe('deviceKeys', () => {
    it('should define all query key', () => {
      expect(deviceKeys.all).toEqual(['devices']);
    });

    it('should define lists query key', () => {
      expect(deviceKeys.lists()).toEqual(['devices', 'list']);
    });

    it('should define detail query key with id', () => {
      expect(deviceKeys.detail('device-123')).toEqual(['devices', 'detail', 'device-123']);
    });
  });

  describe('useDevices', () => {
    it('should fetch devices on mount', async () => {
      const mockDevices = [
        { id: '1', name: 'Device 1', fingerprint: 'fp1' },
        { id: '2', name: 'Device 2', fingerprint: 'fp2' },
      ];
      mockGetDevices.mockResolvedValue(mockDevices);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevices(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGetDevices).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(mockDevices);
    });

    it('should handle fetch error', async () => {
      mockGetDevices.mockRejectedValue(new Error('Failed to fetch'));

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevices(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it('should return loading state initially', () => {
      mockGetDevices.mockImplementation(() => new Promise(() => {})); // Never resolves

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevices(), { wrapper });

      expect(result.current.isPending).toBe(true);
    });
  });

  describe('useDevice', () => {
    it('should fetch single device when id is provided', async () => {
      const mockDevice = { id: 'device-1', name: 'My Device', fingerprint: 'abc123' };
      mockGetDevice.mockResolvedValue(mockDevice);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevice('device-1'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGetDevice).toHaveBeenCalledWith('device-1');
      expect(result.current.data).toEqual(mockDevice);
    });

    it('should not fetch when id is undefined', () => {
      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevice(undefined), { wrapper });

      expect(result.current.fetchStatus).toBe('idle');
      expect(mockGetDevice).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      mockGetDevice.mockRejectedValue(new Error('Device not found'));

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDevice('bad-id'), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('useCreateDevice', () => {
    it('should create device and invalidate cache', async () => {
      const newDevice = { id: 'new-1', name: 'New Device', fingerprint: 'new-fp' };
      mockCreateDevice.mockResolvedValue(newDevice);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useCreateDevice(), { wrapper });

      const deviceData = { name: 'New Device', fingerprint: 'new-fp' };

      await result.current.mutateAsync(deviceData);

      expect(mockCreateDevice).toHaveBeenCalledWith(deviceData, expect.anything());
    });

    it('should handle creation error', async () => {
      mockCreateDevice.mockRejectedValue(new Error('Creation failed'));

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useCreateDevice(), { wrapper });

      await expect(result.current.mutateAsync({ name: 'Test' })).rejects.toThrow('Creation failed');
    });
  });

  describe('useDeleteDevice', () => {
    it('should delete device', async () => {
      mockDeleteDevice.mockResolvedValue(undefined);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDeleteDevice(), { wrapper });

      await result.current.mutateAsync('device-to-delete');

      expect(mockDeleteDevice).toHaveBeenCalledWith('device-to-delete');
    });

    it('should handle deletion error', async () => {
      mockDeleteDevice.mockRejectedValue(new Error('Deletion failed'));

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useDeleteDevice(), { wrapper });

      await expect(result.current.mutateAsync('bad-id')).rejects.toThrow('Deletion failed');
    });
  });

  describe('useInvalidateDevices', () => {
    it('invalidates all device queries', () => {
      const invalidateSpy = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockResolvedValue(undefined as unknown as void);
      const wrapper = createWrapper(queryClient);

      const { result } = renderHook(() => useInvalidateDevices(), { wrapper });
      result.current();

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: deviceKeys.all });
    });
  });
});
