import { useState, useEffect, useCallback, useRef } from 'react';
import { isHardwareWalletSupported } from '../services/hardwareWallet/environment';
import type {
  HardwareWalletDevice,
  DeviceType,
  HardwareWalletConnectionOptions,
  TransactionForSigning,
  TrezorConnectSignedArtifact,
} from '../services/hardwareWallet/types';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import { loadHardwareWalletRuntime } from '../services/hardwareWallet/loader';
import { createLogger } from '../utils/logger';
import type { HardwareWalletConnectionLease } from '../services/hardwareWallet/service';

const log = createLogger('useHardwareWallet');

export interface UseHardwareWalletReturn {
  // Device state
  device: HardwareWalletDevice | null;
  devices: HardwareWalletDevice[];
  isConnected: boolean;
  isSupported: boolean;

  // Loading states
  connecting: boolean;
  signing: boolean;

  // Error state
  error: string | null;

  // Actions
  connect: (
    type?: DeviceType,
    options?: HardwareWalletConnectionOptions,
  ) => Promise<void>;
  disconnect: () => void;
  signTransaction: (tx: TransactionForSigning) => Promise<string>;
  signPSBT: (
    psbtBase64: string,
    signingContextOrLegacyPaths?: PsbtSigningContext | string[],
    multisigXpubs?: Record<string, string>,
    legacyWalletId?: string
  ) => Promise<{
    psbt?: string;
    rawTx?: string;
    trezorArtifact?: TrezorConnectSignedArtifact;
  }>;
  refreshDevices: () => Promise<void>;
  clearError: () => void;
}

/**
 * React hook for hardware wallet integration
 *
 * Provides state management and actions for hardware wallet operations
 */
export const useHardwareWallet = (): UseHardwareWalletReturn => {
  const [device, setDevice] = useState<HardwareWalletDevice | null>(null);
  const [devices, setDevices] = useState<HardwareWalletDevice[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => isHardwareWalletSupported());

  // Bumped by every connect() and disconnect() call. A connect() attempt
  // whose async work resolves after a newer generation started (a later
  // connect, or a disconnect) is stale: it must not resurrect `device` or
  // apply loading/error state, and must tear down the service-level
  // session it just created so nothing is left connected underneath.
  const connectGenerationRef = useRef(0);
  const signGenerationRef = useRef(0);
  const connectionLeaseRef = useRef<HardwareWalletConnectionLease | null>(null);

  /**
   * Refresh list of connected devices
   */
  const refreshDevices = useCallback(async () => {
    try {
      const { getConnectedDevices } = await loadHardwareWalletRuntime();
      const connectedDevices = await getConnectedDevices();
      setDevices(connectedDevices);
    } catch (err) {
      log.error('Failed to refresh devices', { error: err });
    }
  }, []);

  /**
   * Initial device discovery
   */
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  /**
   * Connect to a hardware wallet
   */
  const connect = useCallback(
    async (type?: DeviceType, options?: HardwareWalletConnectionOptions) => {
    connectGenerationRef.current += 1;
    const myGeneration = connectGenerationRef.current;
    const isCurrent = () => connectGenerationRef.current === myGeneration;

    // No await has happened yet, so this generation is trivially current —
    // always apply the starting loading/error state unconditionally.
    setConnecting(true);
    setSigning(false);
    setError(null);
    setDevice(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!isCurrent()) return;
      const previousLease = connectionLeaseRef.current;
      connectionLeaseRef.current = null;
      if (previousLease) {
        try {
          await hardwareWalletService.releaseConnection(previousLease);
        } catch (releaseError) {
          log.warn('Failed to release prior hardware wallet session before reconnect', {
            error: releaseError,
          });
        }
        if (!isCurrent()) return;
      }
      const connection = await hardwareWalletService.connectWithLease(type, options);

      if (!isCurrent()) {
        try {
          await hardwareWalletService.releaseConnection(connection.lease);
        } catch (disconnectErr) {
          log.warn('Failed to disconnect superseded hardware wallet session', {
            error: disconnectErr,
          });
        }
        return;
      }

      connectionLeaseRef.current = connection.lease;
      setDevice(connection.device);

      // Refresh device list
      await refreshDevices();
    } catch (err) {
      if (isCurrent()) {
        const message = err instanceof Error ? err.message : 'Failed to connect to device';
        setError(message);
      }
      throw err;
    } finally {
      if (isCurrent()) {
        setConnecting(false);
      }
    }
    },
    [refreshDevices]
  );

  /**
   * Disconnect from current device
   */
  const disconnect = useCallback(() => {
    connectGenerationRef.current += 1;
    const lease = connectionLeaseRef.current;
    connectionLeaseRef.current = null;
    if (lease) {
      void (async () => {
        const { hardwareWalletService } = await loadHardwareWalletRuntime();
        await hardwareWalletService.releaseConnection(lease);
      })().catch((err) => {
        log.warn('Failed to disconnect hardware wallet service', { error: err });
      });
    }
    setDevice(null);
    setConnecting(false);
    setSigning(false);
    setError(null);
  }, []);

  /**
   * Sign a transaction with the connected device
   */
  const signTransaction = useCallback(
    async (tx: TransactionForSigning): Promise<string> => {
    const connectionGeneration = connectGenerationRef.current;
    const signGeneration = ++signGenerationRef.current;
    const lease = connectionLeaseRef.current;
    const ownsOperation = () => (
      connectGenerationRef.current === connectionGeneration
      && signGenerationRef.current === signGeneration
      && connectionLeaseRef.current === lease
    );
    try {
      setSigning(true);
      setError(null);

      if (!device || !lease) {
        throw new Error('No device connected');
      }

      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!ownsOperation()) throw new Error('Hardware wallet connection changed');
      const txid = await hardwareWalletService.signTransactionForLease(lease, tx);
      return txid;
    } catch (err) {
      if (ownsOperation()) {
        const message = err instanceof Error ? err.message : 'Failed to sign transaction';
        setError(message);
      }
      throw err;
    } finally {
      if (ownsOperation()) setSigning(false);
    }
    },
    [device]
  );

  /**
   * Sign a PSBT with hardware wallet
   * Returns both the signed PSBT and optionally a raw transaction hex (for Trezor)
   * @param psbtBase64 Base64 encoded PSBT
   * @param signingContext Immutable server-issued wallet and PSBT evidence
   * @param multisigXpubs Map of fingerprint to xpub for multisig wallets (required for Trezor)
   */
  const signPSBT = useCallback(
    async (
    psbtBase64: string,
    signingContextOrLegacyPaths?: PsbtSigningContext | string[],
    multisigXpubs?: Record<string, string>,
      legacyWalletId?: string
    ): Promise<{
      psbt?: string;
      rawTx?: string;
      trezorArtifact?: TrezorConnectSignedArtifact;
    }> => {
    const connectionGeneration = connectGenerationRef.current;
    const signGeneration = ++signGenerationRef.current;
    const lease = connectionLeaseRef.current;
    const ownsOperation = () => (
      connectGenerationRef.current === connectionGeneration
      && signGenerationRef.current === signGeneration
      && connectionLeaseRef.current === lease
    );

    try {
      setSigning(true);
      setError(null);
      if (!lease) throw new Error('No device connected');

      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!ownsOperation()) throw new Error('Hardware wallet connection changed');
      if (!hardwareWalletService.isConnected()) throw new Error('No device connected');

      const signingContext = Array.isArray(signingContextOrLegacyPaths)
        ? undefined
        : signingContextOrLegacyPaths;
      const result = await hardwareWalletService.signPSBTForLease(lease, {
        walletId: signingContext?.walletId ?? legacyWalletId,
        psbt: psbtBase64,
        signingContext,
        inputPaths: Array.isArray(signingContextOrLegacyPaths)
          ? signingContextOrLegacyPaths
          : undefined,
        multisigXpubs,
      });

      // Return both psbt and rawTx (rawTx is only set for Trezor)
        return {
          psbt: result.psbt,
          rawTx: result.rawTx,
          trezorArtifact: result.trezorArtifact,
        };
    } catch (err) {
      if (ownsOperation()) {
        const message = err instanceof Error ? err.message : 'Failed to sign PSBT';
        setError(message);
      }
      throw err;
    } finally {
      if (ownsOperation()) setSigning(false);
    }
    },
    []
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    device,
    devices,
    isConnected: device !== null && device.connected,
    isSupported,
    connecting,
    signing,
    error,
    connect,
    disconnect,
    signTransaction,
    signPSBT,
    refreshDevices,
    clearError,
  };
};
