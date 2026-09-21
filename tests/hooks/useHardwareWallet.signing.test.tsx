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
import type { TransactionForSigning } from '../../src/services/hardwareWallet/types';

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

  function registerTransactionSigningTests(): void {
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
          () =>
            new Promise((resolve) => {
              resolveSign = resolve;
            })
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

    it('rejects a stale signing callback after its lease is released', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      const staleSignTransaction = result.current.signTransaction;

      act(() => result.current.disconnect());
      let signingError: unknown;
      await act(async () => {
        try {
          await staleSignTransaction(mockTx);
        } catch (error) {
          signingError = error;
        }
      });
      expect(signingError).toEqual(new Error('No device connected'));
      expect(mockSignTransaction).not.toHaveBeenCalled();
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
  }

  function registerPsbtSigningTests(): void {
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

        let signResult: Awaited<ReturnType<typeof result.current.signPSBT>> | undefined;
      await act(async () => {
        signResult = await result.current.signPSBT(
          mockPsbt,
          mockInputPaths,
          undefined,
          'wallet-123'
        );
      });

      expect(mockSignPSBT).toHaveBeenCalledWith({
        walletId: 'wallet-123',
        psbt: mockPsbt,
        inputPaths: mockInputPaths,
      });
      expect(signResult).toEqual(expectedResult);
      expect(result.current.signing).toBe(false);
    });

    it('should return rawTx for Trezor devices', async () => {
        const trezorArtifact = {
          type: 'trezor-connect-transaction' as const,
          sourcePsbt: mockPsbt,
          connectSignatures: ['300102'],
          serializedTx: 'raw-tx-hex',
        };
        const expectedResult = {
          psbt: 'signed-psbt',
          rawTx: 'raw-tx-hex',
          trezorArtifact,
        };
      mockConnect.mockResolvedValue({ ...mockDevice, type: 'trezor' });
      mockGetDevices.mockResolvedValue([{ ...mockDevice, type: 'trezor' }]);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockResolvedValue(expectedResult);

      const { result } = renderHook(() => useHardwareWallet());

      await act(async () => {
        await result.current.connect('trezor');
      });

        let signResult: Awaited<ReturnType<typeof result.current.signPSBT>> | undefined;
      await act(async () => {
        signResult = await result.current.signPSBT(mockPsbt);
      });

      expect(signResult?.rawTx).toBe('raw-tx-hex');
        expect(signResult?.trezorArtifact).toEqual(trezorArtifact);
    });

    it('should throw error when no device connected', async () => {
      mockConnect.mockResolvedValue(mockDevice);
      mockIsConnected.mockReturnValue(true);
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      mockIsConnected.mockReturnValue(false);

      await expect(async () => {
        await act(async () => {
          await result.current.signPSBT(mockPsbt);
        });
      }).rejects.toThrow('No device connected');
    });

    it('should reject PSBT signing when no lease exists', async () => {
      const { result } = await renderHardwareWallet();
      let signingError: unknown;

      await act(async () => {
        try {
          await result.current.signPSBT(mockPsbt);
        } catch (error) {
          signingError = error;
        }
      });
      expect(signingError).toEqual(new Error('No device connected'));
      expect(result.current.error).toBe('No device connected');
      expect(result.current.signing).toBe(false);
    });

    it('should forward missing signing evidence for the service to reject fail closed', async () => {
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
        inputPaths: undefined,
        multisigXpubs: undefined,
        signingContext: undefined,
        walletId: undefined,
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
  }

  function registerSigningOwnershipTests(): void {
    describe('signing ownership', () => {
    it('does not start transaction signing after disconnect during runtime loading', async () => {
      const runtime = getMockRuntime();
      let resolveRuntime!: (value: typeof runtime) => void;
      mockConnect.mockResolvedValue(mockDevice);
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      mockLoadHardwareWalletRuntime.mockImplementationOnce(() => new Promise((resolve) => {
        resolveRuntime = resolve;
      }));
      let staleSign!: Promise<unknown>;

      act(() => {
        staleSign = result.current.signTransaction({} as TransactionForSigning).catch((error) => error);
      });
      await waitFor(() => expect(result.current.signing).toBe(true));
      act(() => result.current.disconnect());
      await act(async () => {
        resolveRuntime(runtime);
        await staleSign;
      });

      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
      expect(result.current.signing).toBe(false);
    });

    it('does not start PSBT signing after reconnect during runtime loading', async () => {
      const runtime = getMockRuntime();
      const deviceB = { ...mockDevice, id: 'device-b', type: 'trezor' };
      let resolveRuntime!: (value: typeof runtime) => void;
      mockConnect.mockResolvedValueOnce(mockDevice).mockResolvedValueOnce(deviceB);
      mockIsConnected.mockReturnValue(true);
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      mockLoadHardwareWalletRuntime.mockImplementationOnce(() => new Promise((resolve) => {
        resolveRuntime = resolve;
      }));
      let staleSign!: Promise<unknown>;

      act(() => {
        staleSign = result.current.signPSBT('stale-psbt').catch((error) => error);
      });
      await waitFor(() => expect(result.current.signing).toBe(true));
      await act(async () => result.current.connect('trezor'));
      await act(async () => {
        resolveRuntime(runtime);
        await staleSign;
      });

      expect(mockSignPSBT).not.toHaveBeenCalled();
      expect(result.current.device).toEqual(deviceB);
      expect(result.current.error).toBeNull();
      expect(result.current.signing).toBe(false);
    });

    it('suppresses an in-flight transaction signing failure after reconnect', async () => {
      const deviceB = { ...mockDevice, id: 'device-b', type: 'trezor' };
      let rejectSign!: (error: Error) => void;
      mockConnect.mockResolvedValueOnce(mockDevice).mockResolvedValueOnce(deviceB);
      mockSignTransaction.mockReturnValue(new Promise((_, reject) => {
        rejectSign = reject;
      }));
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      const leaseA = issuedLeases[0];
      let staleSign!: Promise<unknown>;

      act(() => {
        staleSign = result.current.signTransaction({} as TransactionForSigning).catch((error) => error);
      });
      await waitFor(() => expect(mockSignTransaction).toHaveBeenCalled());
      await act(async () => result.current.connect('trezor'));
      await act(async () => {
        rejectSign(new Error('stale transaction failure'));
        await staleSign;
      });

      expect(mockReleaseConnection).toHaveBeenCalledWith(leaseA);
      expect(result.current.device).toEqual(deviceB);
      expect(result.current.error).toBeNull();
      expect(result.current.signing).toBe(false);
    });

    it('suppresses an in-flight PSBT signing failure after disconnect', async () => {
      let rejectSign!: (error: Error) => void;
      mockConnect.mockResolvedValue(mockDevice);
      mockIsConnected.mockReturnValue(true);
      mockSignPSBT.mockReturnValue(new Promise((_, reject) => {
        rejectSign = reject;
      }));
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      const lease = issuedLeases[0];
      let staleSign!: Promise<unknown>;

      act(() => {
        staleSign = result.current.signPSBT('pending-psbt').catch((error) => error);
      });
      await waitFor(() => expect(mockSignPSBT).toHaveBeenCalled());
      act(() => result.current.disconnect());
      await act(async () => {
        rejectSign(new Error('stale PSBT failure'));
        await staleSign;
      });

      expect(mockReleaseConnection).toHaveBeenCalledWith(lease);
      expect(result.current.error).toBeNull();
      expect(result.current.signing).toBe(false);
    });

    it('keeps the newer signing state while an overlapping stale sign settles', async () => {
      let rejectTransaction!: (error: Error) => void;
      let resolvePsbt!: (result: { psbt: string }) => void;
      mockConnect.mockResolvedValue(mockDevice);
      mockIsConnected.mockReturnValue(true);
      mockSignTransaction.mockReturnValue(new Promise((_, reject) => {
        rejectTransaction = reject;
      }));
      mockSignPSBT.mockReturnValue(new Promise((resolve) => {
        resolvePsbt = resolve;
      }));
      const { result } = await renderHardwareWallet();
      await act(async () => result.current.connect('ledger'));
      let staleSign!: Promise<unknown>;
      let currentSign!: Promise<unknown>;

      act(() => {
        staleSign = result.current.signTransaction({} as TransactionForSigning).catch((error) => error);
      });
      await waitFor(() => expect(mockSignTransaction).toHaveBeenCalled());
      act(() => {
        currentSign = result.current.signPSBT('current-psbt');
      });
      await waitFor(() => expect(mockSignPSBT).toHaveBeenCalled());
      await act(async () => {
        rejectTransaction(new Error('older sign failed'));
        await staleSign;
      });

      expect(result.current.error).toBeNull();
      expect(result.current.signing).toBe(true);

      await act(async () => {
        resolvePsbt({ psbt: 'signed-current' });
        await currentSign;
      });
      expect(result.current.signing).toBe(false);
    });
    });
  }

  registerTransactionSigningTests();
  registerPsbtSigningTests();
  registerSigningOwnershipTests();
});
