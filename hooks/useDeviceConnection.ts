/**
 * Device Connection Hook
 *
 * Manages state for connecting to hardware wallets via USB:
 * - USB connection progress
 * - Fetching all derivation paths
 * - Error handling
 */

import { useState, useCallback } from 'react';
import { HardwareDeviceModel } from '../src/api/devices';
import { DeviceAccount } from '../services/deviceParsers';
import { getDeviceTypeFromModel } from '../utils/deviceConnection';
import { createLogger } from '../utils/logger';

const log = createLogger('useDeviceConnection');
let hardwareWalletModulePromise: Promise<typeof import('../services/hardwareWallet/runtime')> | null = null;

const loadHardwareWalletModule = async () => {
  hardwareWalletModulePromise ??= import('../services/hardwareWallet/runtime');
  return hardwareWalletModulePromise;
};

/** Progress state for USB scanning */
export interface UsbProgress {
  current: number;
  total: number;
  name: string;
}

/** Result of a successful USB connection */
export interface DeviceConnectionResult {
  /** Master fingerprint from device */
  fingerprint: string;
  /** All accounts fetched from device */
  accounts: DeviceAccount[];
}

export interface UseDeviceConnectionState {
  /** Whether currently scanning/connecting */
  scanning: boolean;
  /** USB scanning progress */
  usbProgress: UsbProgress | null;
  /** Result of successful connection */
  connectionResult: DeviceConnectionResult | null;
  /** Error message from failed connection */
  error: string | null;
  /** Connect to device via USB */
  connectUsb: (model: HardwareDeviceModel) => Promise<void>;
  /** Reset all state */
  reset: () => void;
  /** Clear error only */
  clearError: () => void;
}

/**
 * Hook for managing USB device connections
 *
 * @example
 * const {
 *   scanning,
 *   usbProgress,
 *   connectionResult,
 *   error,
 *   connectUsb,
 * } = useDeviceConnection();
 *
 * const handleConnect = async () => {
 *   await connectUsb(selectedModel);
 *   if (connectionResult) {
 *     // Connection succeeded
 *   }
 * };
 */
export function useDeviceConnection(): UseDeviceConnectionState {
  const [scanning, setScanning] = useState(false);
  const [usbProgress, setUsbProgress] = useState<UsbProgress | null>(null);
  const [connectionResult, setConnectionResult] = useState<DeviceConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setScanning(false);
    setUsbProgress(null);
    setConnectionResult(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const connectUsb = useCallback(async (model: HardwareDeviceModel) => {
    setScanning(true);
    setError(null);
    setUsbProgress(null);
    setConnectionResult(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletModule();
      // Determine device type from model
      const deviceType = getDeviceTypeFromModel(model);

      log.info('Connecting to device', {
        model: model.name,
        deviceType,
      });

      // Connect to the hardware wallet
      const device = await hardwareWalletService.connect(deviceType);

      if (!device || !device.connected) {
        throw new Error('Failed to connect to device');
      }

      // Fetch all standard derivation paths
      log.info('Fetching all derivation paths from device');
      const allXpubs = await hardwareWalletService.getAllXpubs((current, total, name) => {
        setUsbProgress({ current, total, name });
      });

      // Convert to DeviceAccount format
      const accounts: DeviceAccount[] = allXpubs.map((result) => ({
        purpose: result.purpose,
        scriptType: result.scriptType,
        derivationPath: result.path,
        xpub: result.xpub,
      }));

      // Set fingerprint from first result (all should have same fingerprint)
      const fingerprint = allXpubs.length > 0 ? allXpubs[0].fingerprint : '';

      setConnectionResult({ fingerprint, accounts });

      log.info('Device connected successfully', {
        fingerprint,
        accountCount: accounts.length,
        deviceType,
      });
    } catch (err) {
      log.error('Failed to connect to device', { error: err });
      const message = err instanceof Error ? err.message : 'Failed to connect to device';
      setError(message);
    } finally {
      setScanning(false);
      setUsbProgress(null);
    }
  }, []);

  return {
    scanning,
    usbProgress,
    connectionResult,
    error,
    connectUsb,
    reset,
    clearError,
  };
}
