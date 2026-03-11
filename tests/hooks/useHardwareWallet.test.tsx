/**
 * useHardwareWallet Hook Tests
 *
 * Tests for the hardware wallet integration hook covering:
 * - Device connection/disconnection
 * - Transaction and PSBT signing
 * - Error handling
 * - Loading states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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

vi.mock('../../services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: (type?: string) => mockConnect(type),
    disconnect: () => mockDisconnect(),
    signTransaction: (tx: unknown) => mockSignTransaction(tx),
    signPSBT: (request: unknown) => mockSignPSBT(request),
    getDevices: () => mockGetDevices(),
    isConnected: () => mockIsConnected(),
  },
  getConnectedDevices: () => mockGetDevices(),
}));

vi.mock('../../services/hardwareWallet/environment', () => ({
  isHardwareWalletSupported: vi.fn(() => true),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import hook after mocks
import { useHardwareWallet } from '../../hooks/useHardwareWallet';

describe('useHardwareWallet', () => {
  const mockDevice: MockDevice = {
    id: 'device-123',
    type: 'ledger',
    connected: true,
    name: 'Ledger Nano X',
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('connect', () => {
    it('should connect to a device successfully', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      expect(mockConnect).toHaveBeenCalledWith('ledger');
      expect(result.current.device).toEqual(mockDevice);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set connecting state during connection', async () => {
      let resolveConnect: (value: MockDevice) => void;
      mockConnect.mockImplementation(
        () => new Promise((resolve) => { resolveConnect = resolve; })
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
  });

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
  });

  describe('signTransaction', () => {
    const mockTx = {
      walletId: 'wallet-123',
      recipient: 'tb1qtest...',
      amount: 100000,
      feeRate: 5,
    };

    it('should sign transaction successfully', async () => {
      const expectedTxid = 'signed-txid-123';
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockSignTransaction.mockResolvedValue(expectedTxid);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let txid: string | undefined;
      await act(async () => {
        txid = await result.current.signTransaction(mockTx);
      });

      expect(mockSignTransaction).toHaveBeenCalledWith(mockTx);
      expect(txid).toBe(expectedTxid);
      expect(result.current.signing).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set signing state during signing', async () => {
      let resolveSign: (value: string) => void;
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockSignTransaction.mockImplementation(
        () => new Promise((resolve) => { resolveSign = resolve; })
      );

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      act(() => {
        result.current.signTransaction(mockTx);
      });

      expect(result.current.signing).toBe(true);
      await waitFor(() => {
        expect(mockSignTransaction).toHaveBeenCalled();
      });

      await act(async () => {
        resolveSign!('txid');
      });

      expect(result.current.signing).toBe(false);
    });

    it('should throw error when no device connected', async () => {
      const { result } = renderHook(() => useHardwareWallet());

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.signTransaction(mockTx);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe('No device connected');
      expect(result.current.error).toBe('No device connected');
    });

    it('should handle signing error', async () => {
      const error = new Error('User rejected');
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockSignTransaction.mockRejectedValue(error);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.signTransaction(mockTx);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe('User rejected');
      expect(result.current.error).toBe('User rejected');
      expect(result.current.signing).toBe(false);
    });

    it('should use fallback message for non-Error signTransaction failures', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockSignTransaction.mockRejectedValue('sign failed');

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.signTransaction(mockTx);
        } catch (e) {
          caughtError = e;
        }
      });

      expect(caughtError).toBe('sign failed');
      expect(result.current.error).toBe('Failed to sign transaction');
      expect(result.current.signing).toBe(false);
    });
  });

  describe('signPSBT', () => {
    const mockPsbt = 'cHNidP8BAH...';
    const mockInputPaths = ["m/84'/0'/0'/0/0", "m/84'/0'/0'/0/1"];

    it('should sign PSBT successfully', async () => {
      const expectedResult = { psbt: 'signed-psbt', rawTx: undefined };
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockResolvedValue(expectedResult);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let signResult: { psbt: string; rawTx?: string } | undefined;
      await act(async () => {
        signResult = await result.current.signPSBT(mockPsbt, mockInputPaths);
      });

      expect(mockSignPSBT).toHaveBeenCalledWith({
        psbt: mockPsbt,
        inputPaths: mockInputPaths,
      });
      expect(signResult).toEqual(expectedResult);
      expect(result.current.signing).toBe(false);
    });

    it('should return rawTx for Trezor devices', async () => {
      const expectedResult = { psbt: 'signed-psbt', rawTx: 'raw-tx-hex' };
      mockConnect.mockResolvedValue({ ...mockDevice, type: 'trezor' });
      mockGetDevices.mockResolvedValue([{ ...mockDevice, type: 'trezor' }]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockResolvedValue(expectedResult);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('trezor');
      });

      let signResult: { psbt: string; rawTx?: string } | undefined;
      await act(async () => {
        signResult = await result.current.signPSBT(mockPsbt);
      });

      expect(signResult?.rawTx).toBe('raw-tx-hex');
    });

    it('should throw error when no device connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const { result } = renderHook(() => useHardwareWallet());

      await expect(async () => {
        await act(async () => {
          await result.current.signPSBT(mockPsbt);
        });
      }).rejects.toThrow('No device connected');
    });

    it('should use empty array for inputPaths when not provided', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockResolvedValue({ psbt: 'signed' });

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      await act(async () => {
        await result.current.signPSBT(mockPsbt);
      });

      expect(mockSignPSBT).toHaveBeenCalledWith({
        psbt: mockPsbt,
        inputPaths: [],
      });
    });

    it('should handle PSBT signing error', async () => {
      const error = new Error('Invalid PSBT');
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockRejectedValue(error);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.signPSBT(mockPsbt);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe('Invalid PSBT');
      expect(result.current.error).toBe('Invalid PSBT');
      expect(result.current.signing).toBe(false);
    });

    it('should use fallback message for non-Error signPSBT failures', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockGetDevices.mockResolvedValue([mockDevice]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockRejectedValue(123);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('ledger');
      });

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.signPSBT(mockPsbt);
        } catch (e) {
          caughtError = e;
        }
      });

      expect(caughtError).toBe(123);
      expect(result.current.error).toBe('Failed to sign PSBT');
      expect(result.current.signing).toBe(false);
    });
  });

  describe('refreshDevices', () => {
    it('should refresh device list', async () => {
      mockGetDevices
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockDevice]);

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
      mockGetDevices
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('USB error'));

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

  describe('isSupported', () => {
    it('should reflect hardware wallet support', async () => {
      const { result } = await renderHardwareWallet();

      // Our mock returns true
      expect(result.current.isSupported).toBe(true);
    });
  });

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
});
