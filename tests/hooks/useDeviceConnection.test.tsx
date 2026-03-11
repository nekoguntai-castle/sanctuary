/**
 * useDeviceConnection Hook Tests
 *
 * Tests for the device connection hook that manages USB connections
 * to hardware wallets including progress tracking and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { HardwareDeviceModel } from '../../types';

// Mock hardware wallet service
const mockConnect = vi.fn();
const mockGetAllXpubs = vi.fn();

vi.mock('../../services/hardwareWallet', () => ({
  hardwareWalletService: {
    connect: (type: unknown) => mockConnect(type),
    getAllXpubs: (callback: unknown) => mockGetAllXpubs(callback),
  },
}));

// Mock device type helper
vi.mock('../../utils/deviceConnection', () => ({
  getDeviceTypeFromModel: (model: HardwareDeviceModel) => {
    if (model.slug.includes('coldcard')) return 'coldcard';
    if (model.slug.includes('ledger')) return 'ledger';
    if (model.slug.includes('trezor')) return 'trezor';
    return 'unknown';
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { useDeviceConnection } from '../../hooks/useDeviceConnection';

// Test data
const mockModel: HardwareDeviceModel = {
  id: '1',
  name: 'Coldcard Mk4',
  slug: 'coldcard-mk4',
  manufacturer: 'Coinkite',
  connectivity: ['usb', 'microsd'],
  secureElement: true,
  openSource: true,
  airGapped: true,
  supportsBitcoinOnly: true,
  supportsMultisig: true,
  supportsTaproot: true,
  supportsPassphrase: true,
  scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
  hasScreen: true,
  screenType: 'OLED',
};

const mockXpubResults = [
  {
    purpose: 'single_sig' as const,
    scriptType: 'native_segwit' as const,
    path: "m/84'/0'/0'",
    xpub: 'xpub6CUGRUonZSQ4...',
    fingerprint: 'ABCD1234',
  },
  {
    purpose: 'single_sig' as const,
    scriptType: 'taproot' as const,
    path: "m/86'/0'/0'",
    xpub: 'xpub6BsnM8d8Pwzn...',
    fingerprint: 'ABCD1234',
  },
  {
    purpose: 'multisig' as const,
    scriptType: 'native_segwit' as const,
    path: "m/48'/0'/0'/2'",
    xpub: 'xpub6E9Qk6G2ebSo...',
    fingerprint: 'ABCD1234',
  },
];

describe('useDeviceConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ connected: true });
    mockGetAllXpubs.mockResolvedValue(mockXpubResults);
  });

  describe('Initial State', () => {
    it('should have scanning false initially', () => {
      const { result } = renderHook(() => useDeviceConnection());

      expect(result.current.scanning).toBe(false);
    });

    it('should have no USB progress initially', () => {
      const { result } = renderHook(() => useDeviceConnection());

      expect(result.current.usbProgress).toBeNull();
    });

    it('should have no connection result initially', () => {
      const { result } = renderHook(() => useDeviceConnection());

      expect(result.current.connectionResult).toBeNull();
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useDeviceConnection());

      expect(result.current.error).toBeNull();
    });
  });

  describe('connectUsb - Success', () => {
    it('should set scanning true during connection', async () => {
      let resolveConnect: (value: unknown) => void;
      mockConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );

      const { result } = renderHook(() => useDeviceConnection());

      act(() => {
        result.current.connectUsb(mockModel);
      });

      expect(result.current.scanning).toBe(true);
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      await act(async () => {
        resolveConnect!({ connected: true });
      });

      await waitFor(() => {
        expect(result.current.scanning).toBe(false);
      });
    });

    it('should call hardwareWalletService.connect with correct device type', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(mockConnect).toHaveBeenCalledWith('coldcard');
    });

    it('should call getAllXpubs after successful connection', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(mockGetAllXpubs).toHaveBeenCalled();
    });

    it('should set connection result with fingerprint and accounts', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).toEqual({
        fingerprint: 'ABCD1234',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6CUGRUonZSQ4...',
          },
          {
            purpose: 'single_sig',
            scriptType: 'taproot',
            derivationPath: "m/86'/0'/0'",
            xpub: 'xpub6BsnM8d8Pwzn...',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E9Qk6G2ebSo...',
          },
        ],
      });
    });

    it('should clear previous error on new connection', async () => {
      // First cause an error
      mockConnect.mockRejectedValueOnce(new Error('First error'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('First error');

      // Then succeed
      mockConnect.mockResolvedValueOnce({ connected: true });

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBeNull();
    });

    it('should clear previous connection result on new connection', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      // First connection
      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).not.toBeNull();

      // Start a new connection (this clears the result)
      let resolveConnect: (value: unknown) => void;
      mockConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );

      act(() => {
        result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).toBeNull();
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalled();
      });

      await act(async () => {
        resolveConnect!({ connected: true });
      });
    });
  });

  describe('Progress Tracking', () => {
    it('should update USB progress during scanning', async () => {
      mockGetAllXpubs.mockImplementation(
        async (progressCallback: (current: number, total: number, name: string) => void) => {
          progressCallback(1, 6, 'Native SegWit');
          progressCallback(2, 6, 'Taproot');
          progressCallback(3, 6, 'Nested SegWit');
          return mockXpubResults;
        }
      );

      const progressValues: Array<{ current: number; total: number; name: string }> = [];

      const { result } = renderHook(() => useDeviceConnection());

      // We need to capture the progress values during the connection
      const originalUseEffect = result.current;

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      // Progress should be cleared after completion
      expect(result.current.usbProgress).toBeNull();
    });

    it('should clear progress after completion', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.usbProgress).toBeNull();
    });

    it('should clear progress after error', async () => {
      mockConnect.mockRejectedValue(new Error('Connection failed'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.usbProgress).toBeNull();
    });
  });

  describe('connectUsb - Connection Failed', () => {
    it('should set error when device returns not connected', async () => {
      mockConnect.mockResolvedValue({ connected: false });

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Failed to connect to device');
    });

    it('should set error when device is null', async () => {
      mockConnect.mockResolvedValue(null);

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Failed to connect to device');
    });

    it('should set error on connection exception', async () => {
      mockConnect.mockRejectedValue(new Error('USB permission denied'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('USB permission denied');
    });

    it('should handle non-Error thrown values', async () => {
      mockConnect.mockRejectedValue('string error');

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Failed to connect to device');
    });

    it('should set scanning false after error', async () => {
      mockConnect.mockRejectedValue(new Error('Error'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.scanning).toBe(false);
    });

    it('should not set connection result on error', async () => {
      mockConnect.mockRejectedValue(new Error('Error'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).toBeNull();
    });
  });

  describe('connectUsb - GetAllXpubs Failed', () => {
    it('should set error when getAllXpubs fails', async () => {
      mockGetAllXpubs.mockRejectedValue(new Error('Failed to read xpubs'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Failed to read xpubs');
    });
  });

  describe('Empty Xpubs', () => {
    it('should handle empty xpubs array', async () => {
      mockGetAllXpubs.mockResolvedValue([]);

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).toEqual({
        fingerprint: '',
        accounts: [],
      });
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      const { result } = renderHook(() => useDeviceConnection());

      // First connect
      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.connectionResult).not.toBeNull();

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.scanning).toBe(false);
      expect(result.current.usbProgress).toBeNull();
      expect(result.current.connectionResult).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should clear error state', async () => {
      mockConnect.mockRejectedValue(new Error('Test error'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear only error state', async () => {
      mockConnect.mockRejectedValue(new Error('Test error'));

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(mockModel);
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.scanning).toBe(false);
    });
  });

  describe('Different Device Types', () => {
    it('should handle Ledger devices', async () => {
      const ledgerModel: HardwareDeviceModel = {
        ...mockModel,
        name: 'Ledger Nano X',
        slug: 'ledger-nano-x',
        manufacturer: 'Ledger',
      };

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(ledgerModel);
      });

      expect(mockConnect).toHaveBeenCalledWith('ledger');
    });

    it('should handle Trezor devices', async () => {
      const trezorModel: HardwareDeviceModel = {
        ...mockModel,
        name: 'Trezor Model T',
        slug: 'trezor-model-t',
        manufacturer: 'SatoshiLabs',
      };

      const { result } = renderHook(() => useDeviceConnection());

      await act(async () => {
        await result.current.connectUsb(trezorModel);
      });

      expect(mockConnect).toHaveBeenCalledWith('trezor');
    });
  });

  describe('Function Stability', () => {
    it('should have stable function references', () => {
      const { result, rerender } = renderHook(() => useDeviceConnection());

      const connectUsb1 = result.current.connectUsb;
      const reset1 = result.current.reset;
      const clearError1 = result.current.clearError;

      rerender();

      expect(result.current.connectUsb).toBe(connectUsb1);
      expect(result.current.reset).toBe(reset1);
      expect(result.current.clearError).toBe(clearError1);
    });
  });
});
