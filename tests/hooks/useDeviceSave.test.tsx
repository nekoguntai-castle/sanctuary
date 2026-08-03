/**
 * useDeviceSave Hook Tests
 *
 * Tests for the device save hook that handles creating new devices
 * and merging accounts into existing devices with conflict detection.
 */

import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock SidebarContext
const mockRefreshSidebar = vi.fn();
vi.mock('../../src/contexts/SidebarContext', () => ({
  useSidebar: () => ({
    refreshSidebar: mockRefreshSidebar,
  }),
}));

// Mock device API
const mockCreateDeviceWithConflictHandling = vi.fn();
const mockMergeDeviceAccounts = vi.fn();

vi.mock('../../src/api/devices', () => ({
  createDeviceWithConflictHandling: (request: unknown) =>
    mockCreateDeviceWithConflictHandling(request),
  mergeDeviceAccounts: (request: unknown) => mockMergeDeviceAccounts(request),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { useDeviceSave } from '../../src/hooks/useDeviceSave';
import type { CreateDeviceRequest } from '../../src/api/devices';

// Test data
const mockCreateRequest: CreateDeviceRequest = {
  type: 'Coldcard Mk4',
  label: 'My Coldcard',
  fingerprint: '12345678',
  accounts: [
    {
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub...',
    },
  ],
  modelSlug: 'coldcard-mk4',
};

const mockCreatedDevice = {
  id: 'device-123',
  type: 'Coldcard Mk4',
  label: 'My Coldcard',
  fingerprint: '12345678',
};

const mockConflictResponse = {
  existingDevice: {
    id: 'existing-device-456',
    type: 'Coldcard Mk4',
    label: 'Existing Coldcard',
    fingerprint: '12345678',
  },
  comparison: {
    newAccounts: [
      {
        purpose: 'multisig' as const,
        scriptType: 'native_segwit' as const,
        derivationPath: "m/48'/0'/0'/2'",
        xpub: 'xpub-new...',
      },
    ],
    matchingAccounts: [],
    conflictingAccounts: [],
  },
};

describe('useDeviceSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should have saving false initially', () => {
      const { result } = renderHook(() => useDeviceSave());

      expect(result.current.saving).toBe(false);
    });

    it('should have merging false initially', () => {
      const { result } = renderHook(() => useDeviceSave());

      expect(result.current.merging).toBe(false);
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useDeviceSave());

      expect(result.current.error).toBeNull();
    });

    it('should have no conflict data initially', () => {
      const { result } = renderHook(() => useDeviceSave());

      expect(result.current.conflictData).toBeNull();
    });
  });

  describe('saveDevice - Created', () => {
    it('should set saving true during operation', async () => {
      let resolveSave: (value: unknown) => void;
      mockCreateDeviceWithConflictHandling.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          })
      );

      const { result } = renderHook(() => useDeviceSave());

      act(() => {
        result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.saving).toBe(true);

      await act(async () => {
        resolveSave!({ status: 'created', device: mockCreatedDevice });
      });

      expect(result.current.saving).toBe(false);
    });

    it('should navigate to devices list on successful creation', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'created',
        device: mockCreatedDevice,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/devices');
    });

    it('should refresh sidebar on successful creation', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'created',
        device: mockCreatedDevice,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockRefreshSidebar).toHaveBeenCalledTimes(1);
    });

    it('should clear previous error on new save', async () => {
      // First cause an error
      mockCreateDeviceWithConflictHandling.mockRejectedValueOnce(
        new Error('First error')
      );

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe('First error');

      // Then succeed
      mockCreateDeviceWithConflictHandling.mockResolvedValueOnce({
        status: 'created',
        device: mockCreatedDevice,
      });

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('saveDevice - Merged', () => {
    it('should navigate to device detail on auto-merge', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'merged',
        result: {
          device: { id: 'merged-device-789' },
          added: 1,
        },
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/devices/merged-device-789');
    });

    it('should refresh sidebar on auto-merge', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'merged',
        result: {
          device: { id: 'merged-device-789' },
          added: 1,
        },
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockRefreshSidebar).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveDevice - Conflict', () => {
    it('should set conflict data on conflict', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: mockConflictResponse,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.conflictData).toEqual(mockConflictResponse);
    });

    it('should not navigate on conflict', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: mockConflictResponse,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should not refresh sidebar on conflict', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: mockConflictResponse,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(mockRefreshSidebar).not.toHaveBeenCalled();
    });
  });

  describe('saveDevice - Error', () => {
    it('should set error message on failure', async () => {
      mockCreateDeviceWithConflictHandling.mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe('Network error');
    });

    it('should handle non-Error thrown values', async () => {
      mockCreateDeviceWithConflictHandling.mockRejectedValue('string error');

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe(
        'Failed to save device. Please try again.'
      );
    });

    it('should set saving false after error', async () => {
      mockCreateDeviceWithConflictHandling.mockRejectedValue(
        new Error('Error')
      );

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.saving).toBe(false);
    });
  });

  describe('mergeDevice', () => {
    it('should set merging true during operation', async () => {
      let resolveMerge: (value: unknown) => void;
      mockMergeDeviceAccounts.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveMerge = resolve;
          })
      );

      const { result } = renderHook(() => useDeviceSave());

      act(() => {
        result.current.mergeDevice(mockCreateRequest);
      });

      expect(result.current.merging).toBe(true);

      await act(async () => {
        resolveMerge!({ device: { id: 'merged-123' }, added: 1 });
      });

      expect(result.current.merging).toBe(false);
    });

    it('should add merge flag to request', async () => {
      mockMergeDeviceAccounts.mockResolvedValue({
        device: { id: 'merged-123' },
        added: 1,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.mergeDevice(mockCreateRequest);
      });

      expect(mockMergeDeviceAccounts).toHaveBeenCalledWith({
        ...mockCreateRequest,
        merge: true,
      });
    });

    it('should navigate to device detail on success', async () => {
      mockMergeDeviceAccounts.mockResolvedValue({
        device: { id: 'merged-456' },
        added: 2,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.mergeDevice(mockCreateRequest);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/devices/merged-456');
    });

    it('should refresh sidebar on success', async () => {
      mockMergeDeviceAccounts.mockResolvedValue({
        device: { id: 'merged-456' },
        added: 2,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.mergeDevice(mockCreateRequest);
      });

      expect(mockRefreshSidebar).toHaveBeenCalledTimes(1);
    });

    it('should set error on failure', async () => {
      mockMergeDeviceAccounts.mockRejectedValue(new Error('Merge failed'));

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.mergeDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe('Merge failed');
    });
  });

  describe('clearConflict', () => {
    it('should clear conflict data', async () => {
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: mockConflictResponse,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.conflictData).not.toBeNull();

      act(() => {
        result.current.clearConflict();
      });

      expect(result.current.conflictData).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      mockCreateDeviceWithConflictHandling.mockRejectedValue(
        new Error('Test error')
      );

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      // Set up some state
      mockCreateDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: mockConflictResponse,
      });

      const { result } = renderHook(() => useDeviceSave());

      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.conflictData).not.toBeNull();

      // Then cause an error
      mockCreateDeviceWithConflictHandling.mockRejectedValueOnce(
        new Error('Error')
      );
      await act(async () => {
        await result.current.saveDevice(mockCreateRequest);
      });

      expect(result.current.error).toBe('Error');

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.saving).toBe(false);
      expect(result.current.merging).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.conflictData).toBeNull();
    });
  });

  describe('Function Stability', () => {
    it('should have stable function references', () => {
      const { result, rerender } = renderHook(() => useDeviceSave());

      const saveDevice1 = result.current.saveDevice;
      const mergeDevice1 = result.current.mergeDevice;
      const clearConflict1 = result.current.clearConflict;
      const clearError1 = result.current.clearError;
      const reset1 = result.current.reset;

      rerender();

      expect(result.current.saveDevice).toBe(saveDevice1);
      expect(result.current.mergeDevice).toBe(mergeDevice1);
      expect(result.current.clearConflict).toBe(clearConflict1);
      expect(result.current.clearError).toBe(clearError1);
      expect(result.current.reset).toBe(reset1);
    });
  });
});
