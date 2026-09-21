/**
 * useHardwareWallet Hook Tests
 *
 * Tests for the hardware wallet integration hook covering:
 * - Device connection/disconnection
 * - Transaction and PSBT signing
 * - Error handling
 * - Loading states
 */

import { act,renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock types
interface MockDevice {
  id: string;
  type: string;
  connected: boolean;
  name: string;
}

// Mock the hardware wallet service
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSignTransaction = vi.fn();
const mockSignPSBT = vi.fn();
const mockGetDevices = vi.fn();
const mockIsConnected = vi.fn();
const mockLoadHardwareWalletRuntime = vi.hoisted(() => vi.fn());
// Declared via vi.hoisted so the mock factory below (which the hoisted
// vi.mock() call runs before this file's own top-level statements) can
// safely reference it without a temporal-dead-zone error.
const { issuedLeases, mockLoggerWarn, mockReleaseConnection } = vi.hoisted(() => ({
  issuedLeases: [] as unknown[],
  mockLoggerWarn: vi.fn(),
  mockReleaseConnection: vi.fn(),
}));

const getMockRuntime = () => ({
  hardwareWalletService: {
    connectWithLease: async (type?: string, options?: unknown) => {
      const device = await mockConnect(type, options);
      const lease = {};
      issuedLeases.push(lease);
      return { device, lease };
    },
    releaseConnection: (lease: unknown) => mockReleaseConnection(lease),
    signTransactionForLease: (_lease: unknown, tx: unknown) => mockSignTransaction(tx),
    signPSBTForLease: (_lease: unknown, request: unknown) => mockSignPSBT(request),
    isConnected: () => mockIsConnected(),
  },
  getConnectedDevices: () => mockGetDevices(),
});

vi.mock('../../src/services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: (type?: string, options?: unknown) => mockConnect(type, options),
    connectWithLease: async (type?: string, options?: unknown) => {
      const device = await mockConnect(type, options);
      const lease = {};
      issuedLeases.push(lease);
      return { device, lease };
    },
    releaseConnection: (lease: unknown) => mockReleaseConnection(lease),
    disconnect: () => mockDisconnect(),
    signTransaction: (tx: unknown) => mockSignTransaction(tx),
    signTransactionForLease: (_lease: unknown, tx: unknown) => mockSignTransaction(tx),
    signPSBT: (request: unknown) => mockSignPSBT(request),
    signPSBTForLease: (_lease: unknown, request: unknown) => mockSignPSBT(request),
    getDevices: () => mockGetDevices(),
    isConnected: () => mockIsConnected(),
  },
  getConnectedDevices: () => mockGetDevices(),
}));

vi.mock('../../src/services/hardwareWallet/loader', () => ({
  loadHardwareWalletRuntime: () => mockLoadHardwareWalletRuntime(),
}));

vi.mock('../../src/services/hardwareWallet/environment', () => ({
  isHardwareWalletSupported: vi.fn(() => true),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  }),
}));

// Import hook after mocks
import { useHardwareWallet } from '../../src/hooks/useHardwareWallet';

describe('useHardwareWallet', () => {
  const mockDevice: MockDevice = {
    id: 'device-123',
    type: 'ledger',
    connected: true,
    name: 'Ledger Nano X',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    issuedLeases.length = 0;
    mockReleaseConnection.mockImplementation(() => mockDisconnect());
    mockLoadHardwareWalletRuntime.mockImplementation(async () => getMockRuntime());
    mockGetDevices.mockResolvedValue([]);
    mockIsConnected.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderHardwareWallet = async () => {
    const hook = renderHook(() => useHardwareWallet());
    await waitFor(() => {
      expect(mockGetDevices).toHaveBeenCalled();
    });
    return hook;
  };

  function registerInitialStateTests(): void {
    describe('Initial State', () => {
    it('should return initial state with no device connected', async () => {
      const { result } = await renderHardwareWallet();

      expect(result.current.device).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.signing).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isSupported).toBe(true);
    });

    it('should fetch devices on mount', async () => {
      mockGetDevices.mockResolvedValue([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      await waitFor(() => {
        expect(mockGetDevices).toHaveBeenCalled();
        expect(result.current.devices).toEqual([mockDevice]);
      });
    });
    });
  }

  function registerConnectionTests(): void {
    describe('connect', () => {
    it('should connect to a device successfully', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      expect(mockConnect).toHaveBeenCalledWith('ledger', undefined);
      expect(result.current.device).toEqual(mockDevice);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set connecting state during connection', async () => {
      let resolveConnect: (value: MockDevice) => void;
      mockConnect.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveConnect = resolve;
            })
      );

      const { result } = renderHook(() => useHardwareWallet());

      act(() => {
        result.current.connect('ledger');
      });

      expect(result.current.connecting).toBe(true);
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      await act(async () => {
        resolveConnect!(mockDevice);
      });

      expect(result.current.connecting).toBe(false);
    });

    it('should handle connection error', async () => {
      const error = new Error('Device not found');
      mockConnect.mockRejectedValue(error);

      const { result } = renderHook(() => useHardwareWallet());

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.connect('ledger');
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe('Device not found');
      expect(result.current.device).toBeNull();
      expect(result.current.error).toBe('Device not found');
      expect(result.current.connecting).toBe(false);
    });

    it('should handle non-Error exceptions', async () => {
      mockConnect.mockRejectedValue('String error');

      const { result } = renderHook(() => useHardwareWallet());

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.connect();
        } catch (e) {
          caughtError = e;
        }
      });

      expect(caughtError).toBe('String error');
      expect(result.current.error).toBe('Failed to connect to device');
    });

    it('clears device state when replacing A with B fails', async () => {
      const deviceA = { ...mockDevice, id: 'device-a' };
      mockConnect
        .mockResolvedValueOnce(deviceA)
        .mockRejectedValueOnce(new Error('device B failed'));
      mockGetDevices.mockResolvedValue([deviceA]);
      const { result } = await renderHardwareWallet();

      await act(async () => result.current.connect('ledger'));
      expect(result.current.device).toEqual(deviceA);

      let replacementError: unknown;
      await act(async () => {
        try {
          await result.current.connect('trezor');
        } catch (error) {
          replacementError = error;
        }
      });

      expect(replacementError).toEqual(new Error('device B failed'));
      expect(result.current.device).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBe('device B failed');
      expect(mockReleaseConnection).toHaveBeenCalledWith(issuedLeases[0]);
    });

    it('continues replacement connect after prior lease release fails', async () => {
      const deviceA = { ...mockDevice, id: 'device-a' };
      const deviceB = { ...mockDevice, id: 'device-b', type: 'trezor' };
      mockConnect.mockResolvedValueOnce(deviceA).mockResolvedValueOnce(deviceB);
      mockReleaseConnection.mockRejectedValueOnce(new Error('release A failed'));
      const { result } = await renderHardwareWallet();

      await act(async () => result.current.connect('ledger'));
      await act(async () => result.current.connect('trezor'));

      expect(result.current.device).toEqual(deviceB);
      expect(result.current.isConnected).toBe(true);
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Failed to release prior hardware wallet session before reconnect',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it('abandons a reconnect superseded while its prior lease release is pending', async () => {
      const deviceA = { ...mockDevice, id: 'device-a' };
      const deviceC = { ...mockDevice, id: 'device-c', type: 'trezor' };
      let resolveRelease!: () => void;
      mockConnect.mockResolvedValueOnce(deviceA).mockResolvedValueOnce(deviceC);
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      mockReleaseConnection.mockReturnValueOnce(new Promise<void>((resolve) => {
        resolveRelease = resolve;
      }));

      let connectB!: Promise<void>;
      act(() => {
        connectB = result.current.connect('trezor');
      });
      await waitFor(() => expect(mockReleaseConnection).toHaveBeenCalled());
      await act(async () => result.current.connect('trezor'));
      await act(async () => {
        resolveRelease();
        await connectB;
      });

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(result.current.device).toEqual(deviceC);
    });
    });
  }

  function registerDisconnectionTests(): void {
    describe('disconnect', () => {
    it('should disconnect from device', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      // Connect first
      await act(async () => {
        await result.current.connect('ledger');
      });

      expect(result.current.device).toEqual(mockDevice);

      // Then disconnect
      act(() => {
        result.current.disconnect();
      });

      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalled();
      });
      expect(result.current.device).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should keep state cleared even when disconnect call fails', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockDisconnect.mockRejectedValueOnce(new Error('disconnect failed'));

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      act(() => {
        result.current.disconnect();
      });

      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalled();
      });

      expect(result.current.device).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('releases only the hook-owned lease when another session may own the singleton', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      const { result } = await renderHardwareWallet();

      await act(async () => {
        await result.current.connect('ledger');
      });
      const hookLease = issuedLeases[0];
      const externalLease = {};

      act(() => result.current.disconnect());
      await waitFor(() => expect(mockReleaseConnection).toHaveBeenCalledWith(hookLease));
      expect(mockReleaseConnection.mock.calls[0]?.[0]).toBe(hookLease);
      expect(mockReleaseConnection.mock.calls[0]?.[0]).not.toBe(externalLease);
    });
    });
  }

  // Kept as its own registration function (separate from
  // registerDisconnectionTests) so no single test-registration closure grows
  // past the lizard complexity gate's NLOC/CCN thresholds.
  function registerConnectGenerationGuardTests(): void {
    describe('connect generation guard', () => {
    it('does not let runtime-delayed connect A touch connect B', async () => {
      const runtime = getMockRuntime();
      const { result } = await renderHardwareWallet();
      let resolveRuntimeA!: (value: typeof runtime) => void;
      mockLoadHardwareWalletRuntime
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveRuntimeA = resolve;
        }))
        .mockResolvedValue(runtime);
      const deviceB = { ...mockDevice, id: 'device-b', type: 'trezor' };
      mockConnect.mockResolvedValue(deviceB);
      let connectA!: Promise<void>;

      act(() => {
        connectA = result.current.connect('ledger');
      });
      await waitFor(() => expect(mockLoadHardwareWalletRuntime).toHaveBeenCalled());
      await act(async () => result.current.connect('trezor'));
      await act(async () => {
        resolveRuntimeA(runtime);
        await connectA;
      });

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith('trezor', undefined);
      expect(result.current.device).toEqual(deviceB);
      expect(mockReleaseConnection).not.toHaveBeenCalled();
    });

    it('does not touch the service when disconnect supersedes runtime loading', async () => {
      const runtime = getMockRuntime();
      const { result } = await renderHardwareWallet();
      let resolveRuntime!: (value: typeof runtime) => void;
      mockLoadHardwareWalletRuntime.mockImplementationOnce(() => new Promise((resolve) => {
        resolveRuntime = resolve;
      }));
      let connection!: Promise<void>;

      act(() => {
        connection = result.current.connect('ledger');
      });
      await waitFor(() => expect(mockLoadHardwareWalletRuntime).toHaveBeenCalled());
      act(() => result.current.disconnect());
      await act(async () => {
        resolveRuntime(runtime);
        await connection;
      });

      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockReleaseConnection).not.toHaveBeenCalled();
      expect(result.current.device).toBeNull();
      expect(result.current.connecting).toBe(false);
    });

    it('should not resurrect the device when a stale connect resolves after a disconnect', async () => {
      let resolveConnect: (value: MockDevice) => void;
      mockConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );
      mockGetDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useHardwareWallet());

      // Start a connect that will not resolve yet.
      act(() => {
        void result.current.connect('ledger').catch(() => {
          // Superseded connects settle without throwing; nothing to do here.
        });
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      // Disconnect before the pending connect resolves.
      act(() => {
        result.current.disconnect();
      });
      expect(mockDisconnect).not.toHaveBeenCalled();

      // The late connect now resolves with a device.
      await act(async () => {
        resolveConnect!(mockDevice);
      });

      // The stale connect must not resurrect `device`, and must tear down
      // the exact service-level session it created.
      expect(result.current.device).toBeNull();
      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
      });
    });

    it('logs a warning when the superseded-session cleanup disconnect itself fails', async () => {
      let resolveConnect: (value: MockDevice) => void;
      mockConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );
      mockGetDevices.mockResolvedValue([]);
      mockDisconnect.mockRejectedValueOnce(new Error('cleanup disconnect failed'));

      const { result } = renderHook(() => useHardwareWallet());

      act(() => {
        void result.current.connect('ledger').catch(() => {
          // Superseded connects settle without throwing; nothing to do here.
        });
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      act(() => {
        result.current.disconnect();
      });
      expect(mockDisconnect).not.toHaveBeenCalled();

      await act(async () => {
        resolveConnect!(mockDevice);
      });

      expect(result.current.device).toBeNull();
      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
      });
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Failed to disconnect superseded hardware wallet session',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('does not let a stale connect A tear down a newer connect B session when A resolves after B has started', async () => {
      let resolveConnectA: (value: MockDevice) => void;
      let resolveConnectB: (value: MockDevice) => void;
      mockConnect
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveConnectA = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveConnectB = resolve;
            })
        );
      mockGetDevices.mockResolvedValue([]);

      const deviceA: MockDevice = { ...mockDevice, id: 'device-a' };
      const deviceB: MockDevice = { ...mockDevice, id: 'device-b' };

      const { result } = renderHook(() => useHardwareWallet());

      // Start connect A.
      act(() => {
        void result.current.connect('ledger').catch(() => {
          // A settles without throwing when superseded; nothing to do here.
        });
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(1);
      });

      // Disconnect before A resolves.
      act(() => {
        result.current.disconnect();
      });
      expect(mockDisconnect).not.toHaveBeenCalled();

      // Start connect B, which claims the session the disconnect vacated.
      act(() => {
        void result.current.connect('trezor');
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(2);
      });

      // A resolves late, after B has already started. A must not touch the
      // service session B now owns (no extra disconnect call) and must not
      // set `device`. B is still pending, so `connecting` must stay true —
      // A's stale settlement must not clear loading state that belongs to
      // B's still-in-flight attempt.
      await act(async () => {
        resolveConnectA!(deviceA);
      });
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(result.current.connecting).toBe(true);
      expect(result.current.device).toBeNull();

      // B resolving should still set its own device normally.
      await act(async () => {
        resolveConnectB!(deviceB);
      });
      expect(result.current.device).toEqual(deviceB);
      expect(result.current.connecting).toBe(false);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('does not tear down a newer connect B session when a stale connect A (with no disconnect in between) resolves late', async () => {
      let resolveConnectA: (value: MockDevice) => void;
      let resolveConnectB: (value: MockDevice) => void;
      mockConnect
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveConnectA = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveConnectB = resolve;
            })
        );
      mockGetDevices.mockResolvedValue([]);

      const deviceA: MockDevice = { ...mockDevice, id: 'device-a' };
      const deviceB: MockDevice = { ...mockDevice, id: 'device-b' };

      const { result } = renderHook(() => useHardwareWallet());

      // Start connect A.
      act(() => {
        void result.current.connect('ledger').catch(() => {
          // A settles without throwing when superseded; nothing to do here.
        });
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(1);
      });

      // Start connect B directly, with no disconnect() call in between —
      // the last action stays 'connect' throughout.
      act(() => {
        void result.current.connect('trezor');
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(2);
      });

      // A resolves late. Its exact lease is released without touching B.
      await act(async () => {
        resolveConnectA!(deviceA);
      });
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(result.current.device).toBeNull();

      // B resolving sets its own device normally.
      await act(async () => {
        resolveConnectB!(deviceB);
      });
      expect(result.current.device).toEqual(deviceB);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('does not surface a stale connect rejection as the current error, but still rejects the caller', async () => {
      let rejectConnect: (error: Error) => void;
      mockConnect.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectConnect = reject;
          })
      );
      mockGetDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useHardwareWallet());

      let caughtError: unknown;
      act(() => {
        void result.current.connect('ledger').catch((e) => {
          caughtError = e;
        });
      });
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      // Disconnect before the pending connect rejects — this bumps the
      // generation, making the eventual rejection stale.
      act(() => {
        result.current.disconnect();
      });
      expect(mockDisconnect).not.toHaveBeenCalled();

      const rejection = new Error('stale connect failure');
      await act(async () => {
        rejectConnect!(rejection);
      });

      // The caller still observes the rejection...
      expect(caughtError).toBe(rejection);
      // ...but the stale generation must not resurrect error state that the
      // disconnect() call already cleared for the current generation.
      expect(result.current.error).toBeNull();
    });
    });
  }

  function registerDeviceRefreshTests(): void {
    describe('refreshDevices', () => {
    it('should refresh device list', async () => {
        mockGetDevices.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      // Initial fetch returns empty
      await waitFor(() => {
        expect(result.current.devices).toEqual([]);
      });

      // Refresh should get the new device
      await act(async () => {
        await result.current.refreshDevices();
      });

      expect(result.current.devices).toEqual([mockDevice]);
    });

    it('should handle refresh error gracefully', async () => {
        mockGetDevices.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('USB error'));

      const { result } = renderHook(() => useHardwareWallet());

      await waitFor(() => {
        expect(mockGetDevices).toHaveBeenCalled();
      });

      // Should not throw, just log error
      await act(async () => {
        await result.current.refreshDevices();
      });

      // Devices should remain unchanged
      expect(result.current.devices).toEqual([]);
    });
    });
  }

  function registerClearErrorTests(): void {
    describe('clearError', () => {
    it('should clear error state', async () => {
      mockConnect.mockRejectedValue(new Error('Connection failed'));

      const { result } = renderHook(() => useHardwareWallet());

      // Cause an error
      await act(async () => {
        try {
          await result.current.connect();
        } catch {
          // Expected
        }
      });

      expect(result.current.error).toBe('Connection failed');

      // Clear the error
      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
    });
  }

  function registerSupportStateTests(): void {
    describe('isSupported', () => {
    it('should reflect hardware wallet support', async () => {
      const { result } = await renderHardwareWallet();

      // Our mock returns true
      expect(result.current.isSupported).toBe(true);
    });
    });
  }

  function registerDerivedConnectionStateTests(): void {
    describe('isConnected derived state', () => {
    it('should be true when device is connected', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      expect(result.current.isConnected).toBe(true);
    });

    it('should be false when device is not connected', async () => {
      const disconnectedDevice = { ...mockDevice, connected: false };
      mockConnect.mockResolvedValue(disconnectedDevice);
      mockGetDevices.mockResolvedValue([disconnectedDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      expect(result.current.isConnected).toBe(false);
    });

    it('should be false when no device', async () => {
      const { result } = await renderHardwareWallet();

      expect(result.current.isConnected).toBe(false);
    });
    });
  }

  registerInitialStateTests();
  registerConnectionTests();
  registerDisconnectionTests();
  registerConnectGenerationGuardTests();
  registerDeviceRefreshTests();
  registerClearErrorTests();
  registerSupportStateTests();
  registerDerivedConnectionStateTests();
});
