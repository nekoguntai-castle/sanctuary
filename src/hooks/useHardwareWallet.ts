import { useState, useEffect, useCallback } from 'react';
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
    try {
      setConnecting(true);
      setError(null);

      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      const connectedDevice = await hardwareWalletService.connect(type, options);
      setDevice(connectedDevice);

      // Refresh device list
      await refreshDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to device';
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
    },
    [refreshDevices]
  );

  /**
   * Disconnect from current device
   */
  const disconnect = useCallback(() => {
    void (async () => {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      await hardwareWalletService.disconnect();
    })().catch((err) => {
      log.warn('Failed to disconnect hardware wallet service', { error: err });
    });
    setDevice(null);
    setError(null);
  }, []);

  /**
   * Sign a transaction with the connected device
   */
  const signTransaction = useCallback(
    async (tx: TransactionForSigning): Promise<string> => {
    try {
      setSigning(true);
      setError(null);

      if (!device) {
        throw new Error('No device connected');
      }

      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      const txid = await hardwareWalletService.signTransaction(tx);
      return txid;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign transaction';
      setError(message);
      throw err;
    } finally {
      setSigning(false);
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
    const { hardwareWalletService } = await loadHardwareWalletRuntime();

    // Check the service's connection state directly (not React state which updates async)
    if (!hardwareWalletService.isConnected()) {
      throw new Error('No device connected');
    }

    try {
      setSigning(true);
      setError(null);

      const signingContext = Array.isArray(signingContextOrLegacyPaths)
        ? undefined
        : signingContextOrLegacyPaths;
      const result = await hardwareWalletService.signPSBT({
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
      const message = err instanceof Error ? err.message : 'Failed to sign PSBT';
      setError(message);
      throw err;
    } finally {
      setSigning(false);
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
