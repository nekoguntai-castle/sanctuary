/**
 * Device Connection Hook
 *
 * Manages state for connecting to hardware wallets via USB:
 * - USB connection progress
 * - Fetching all derivation paths
 * - Error handling
 */

import { useState, useCallback, useRef } from 'react';
import { HardwareDeviceModel } from '../api/devices';
import { DeviceAccount } from '../services/deviceParsers';
import { loadHardwareWalletRuntime } from '../services/hardwareWallet/loader';
import { buildSkippedXpubWarning } from '../services/hardwareWallet/xpubImportWarnings';
import { validateXpubBatch } from '../services/hardwareWallet/identity';
import { getDeviceTypeFromModel } from '../utils/deviceConnection';
import { createLogger } from '../utils/logger';
import type { TabNetwork } from '../app/networks';
import type { DeviceType, HardwareWalletConnectionOptions } from '../services/hardwareWallet/types';
import type {
  HardwareWalletConnectionLease,
  HardwareWalletService,
} from '../services/hardwareWallet/service';

const log = createLogger('useDeviceConnection');

function connectionOptions(
  deviceType: DeviceType,
  model: HardwareDeviceModel,
  chainEnvironment?: TabNetwork,
): HardwareWalletConnectionOptions {
  if (deviceType === 'jade' && !chainEnvironment) {
    throw new Error(`${deviceType} connection requires an explicit chain environment`);
  }
  return {
    ...(chainEnvironment ? { chainEnvironment } : {}),
    expectedModel: model.name,
  };
}

/** Progress state for USB scanning */
export interface UsbProgress {
  current: number;
  total: number;
  name: string;
}

/** Result of a successful USB connection */
export interface DeviceConnectionResult {
  /** Model that owned the USB operation */
  modelId: string;
  /** Master fingerprint from device */
  fingerprint: string;
  /** All accounts fetched from device */
  accounts: DeviceAccount[];
  /** Warning from paths that were skipped during a partial import */
  warning?: string | null;
}

async function releaseStaleConnection(
  service: HardwareWalletService,
  lease: HardwareWalletConnectionLease,
): Promise<void> {
  try {
    await service.releaseConnection(lease);
  } catch (error) {
    log.warn('Failed to release stale device connection', { error });
  }
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
  connectUsb: (model: HardwareDeviceModel, chainEnvironment?: TabNetwork) => Promise<void>;
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
  const ownershipGeneration = useRef(0);
  const connectionQueue = useRef<Promise<void>>(Promise.resolve());

  const reset = useCallback(() => {
    ownershipGeneration.current += 1;
    setScanning(false);
    setUsbProgress(null);
    setConnectionResult(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const connectUsb = useCallback(async (
    model: HardwareDeviceModel,
    chainEnvironment?: TabNetwork,
  ) => {
    const generation = ++ownershipGeneration.current;
    setScanning(true);
    setError(null);
    setUsbProgress(null);
    setConnectionResult(null);

    const runConnection = async () => {
      let service: HardwareWalletService | null = null;
      let lease: HardwareWalletConnectionLease | null = null;
      const ownsOperation = () => ownershipGeneration.current === generation;

      try {
        const { hardwareWalletService } = await loadHardwareWalletRuntime();
        service = hardwareWalletService;
        if (!ownsOperation()) return;
        // Determine device type from model
        const deviceType = getDeviceTypeFromModel(model);

        log.info('Connecting to device', {
          model: model.name,
          deviceType,
        });

        // Connect to the hardware wallet
        const connection = await hardwareWalletService.connectWithLease(
          deviceType,
          connectionOptions(deviceType, model, chainEnvironment),
        );
        const device = connection.device;
        lease = connection.lease;

        if (!ownsOperation()) {
          return;
        }

        if (!device || !device.connected) {
          throw new Error('Failed to connect to device');
        }

        // Fetch all standard derivation paths
        log.info('Fetching all derivation paths from device');
        const xpubBatch = await hardwareWalletService.getAllXpubsWithFailuresForLease(
          lease,
          (current, total, name) => {
            if (!ownsOperation()) throw new Error('USB operation is no longer active');
            setUsbProgress({ current, total, name });
          },
        );
        if (!ownsOperation()) {
          return;
        }
        const validatedBatch = validateXpubBatch(xpubBatch.results, device.fingerprint);
        const allXpubs = validatedBatch.results;

        // Convert to DeviceAccount format
        const accounts: DeviceAccount[] = allXpubs.map((result) => ({
          purpose: result.purpose,
          scriptType: result.scriptType,
          derivationPath: result.path,
          xpub: result.xpub,
        }));

        const fingerprint = validatedBatch.fingerprint;

        setConnectionResult({
          modelId: model.id,
          fingerprint,
          accounts,
          warning: buildSkippedXpubWarning(xpubBatch.failures),
        });

        log.info('Device connected successfully', {
          fingerprint,
          accountCount: accounts.length,
          deviceType,
        });
      } catch (err) {
        if (!ownsOperation()) {
          return;
        }
        log.error('Failed to connect to device', { error: err });
        const message = err instanceof Error ? err.message : 'Failed to connect to device';
        setError(message);
      } finally {
        if (ownsOperation()) {
          setScanning(false);
          setUsbProgress(null);
        }
        if (service && lease) await releaseStaleConnection(service, lease);
      }
    };

    const operation = connectionQueue.current.then(runConnection, runConnection);
    connectionQueue.current = operation;
    await operation;
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
