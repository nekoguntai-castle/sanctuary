/**
 * Trezor Device Adapter
 *
 * Implements DeviceAdapter interface for Trezor devices via Trezor Connect.
 * Supports Model One, Model T, Safe 3, Safe 5, and Safe 7.
 * Requires Trezor Suite desktop app to be running.
 */

import TrezorConnect from '@trezor/connect-web';
import { createLogger } from '../../../../utils/logger';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../../types';
import type { TrezorConnection } from './types';
import { signPsbtWithTrezor } from './signPsbt';

const log = createLogger('TrezorAdapter');

type TrezorFeatures = {
  device_id?: string | null;
  label?: string | null;
  model?: string;
  internal_model?: string;
  pin_protection?: boolean | null;
  unlocked?: boolean | null;
  passphrase_protection?: boolean | null;
};

type FingerprintPayload = {
  fingerprint?: number;
  xpub?: string;
};

const getTrezorModelName = (features: TrezorFeatures): string => {
  if (features.model === 'T') return 'Trezor Model T';
  if (features.model === '1') return 'Trezor Model One';
  if (features.internal_model === 'T2B1') return 'Trezor Safe 3';
  if (features.internal_model === 'T3T1') return 'Trezor Safe 5';
  if (features.internal_model === 'T3W1') return 'Trezor Safe 7';
  return 'Trezor';
};

const formatFingerprint = (payload: FingerprintPayload): string | undefined => {
  const rawFp = payload.fingerprint;
  // Handle unsigned 32-bit conversion (fingerprint can be > 2^31)
  const unsignedFp = rawFp !== undefined ? (rawFp >>> 0) : undefined;
  const fingerprint = unsignedFp?.toString(16).padStart(8, '0');
  log.info('Trezor fingerprint obtained', {
    rawFingerprint: rawFp,
    unsignedFingerprint: unsignedFp,
    hexFingerprint: fingerprint,
    xpubPrefix: payload.xpub?.substring(0, 20),
  });
  return fingerprint;
};

const createConnectError = (message: string): Error => {
  if (message.includes('Popup closed') || message.includes('cancelled')) {
    return new Error('Connection cancelled by user');
  }
  if (message.includes('Device not found') || message.includes('no device')) {
    return new Error('No Trezor device found. Please connect your device and ensure Trezor Suite is running.');
  }
  if (message.includes('Bridge not running')) {
    return new Error('Trezor Suite bridge not running. Please open Trezor Suite desktop app.');
  }

  return new Error(`Failed to connect Trezor: ${message}`);
};

/**
 * Trezor Device Adapter
 */
export class TrezorAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'trezor';
  readonly displayName = 'Trezor';

  private connection: TrezorConnection = {
    initialized: false,
    connected: false,
  };
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if Trezor is supported in current environment.
   * Requires HTTPS for secure context (WebUSB requirement).
   */
  isSupported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Initialize Trezor Connect
   */
  private async initialize(): Promise<void> {
    if (this.connection.initialized) {
      return;
    }

    try {
      await TrezorConnect.init({
        manifest: {
          email: 'support@sanctuary.bitcoin',
          appUrl: window.location.origin || 'https://sanctuary.bitcoin',
          appName: 'Sanctuary',
        },
        coreMode: 'auto',
        debug: true,
        lazyLoad: false,
      });

      this.connection.initialized = true;
      log.info('Trezor Connect initialized');
    } catch (error) {
      log.error('Failed to initialize Trezor Connect', { error });
      throw new Error('Failed to initialize Trezor. Please ensure Trezor Suite is running.');
    }
  }

  /**
   * Connect to a Trezor device
   */
  async connect(): Promise<HardwareWalletDevice> {
    await this.ensureInitialized();

    try {
      log.info('Requesting Trezor device features...');

      const features = await this.getDeviceFeatures();
      const fingerprint = await this.getMasterFingerprint();
      const modelName = getTrezorModelName(features);
      const device = this.setConnectedDevice(features, fingerprint, modelName);

      log.info('Trezor connected', {
        model: modelName,
        label: features.label,
        fingerprint,
      });

      return device;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to connect Trezor', { error: message });

      throw createConnectError(message);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.connection.initialized) {
      await this.initialize();
    }
  }

  private async getDeviceFeatures(): Promise<TrezorFeatures> {
    const result = await TrezorConnect.getFeatures();

    if (!result.success) {
      const errorPayload = result.payload as { error?: string; code?: string };
      log.error('Trezor getFeatures failed', { payload: errorPayload });
      throw new Error(errorPayload.error || 'Failed to connect to Trezor');
    }

    return result.payload as TrezorFeatures;
  }

  private async getMasterFingerprint(): Promise<string | undefined> {
    try {
      const fpResult = await TrezorConnect.getPublicKey({
        path: "m/0'",
        showOnTrezor: false,
      });
      return fpResult.success ? formatFingerprint(fpResult.payload) : undefined;
    } catch (fpError) {
      log.warn('Could not get fingerprint from Trezor', { error: fpError });
      return undefined;
    }
  }

  private setConnectedDevice(
    features: TrezorFeatures,
    fingerprint: string | undefined,
    modelName: string
  ): HardwareWalletDevice {
    this.connection = {
      initialized: true,
      connected: true,
      deviceId: features.device_id || undefined,
      fingerprint,
      model: modelName,
      label: features.label || undefined,
    };

    const device = {
      id: `trezor-${features.device_id || 'unknown'}`,
      type: 'trezor' as const,
      name: features.label || modelName,
      model: modelName,
      connected: true,
      fingerprint,
      needsPin: (features.pin_protection && !features.unlocked) ?? undefined,
      needsPassphrase: features.passphrase_protection ?? undefined,
    };
    this.connectedDevice = device;

    return device;
  }

  /**
   * Disconnect from Trezor
   */
  async disconnect(): Promise<void> {
    this.connection = {
      initialized: this.connection.initialized,
      connected: false,
    };
    this.connectedDevice = null;
    log.info('Trezor disconnected');
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    try {
      const isTestnet = path.includes("/1'/") || path.includes("/1h/");

      const result = await TrezorConnect.getPublicKey({
        path,
        showOnTrezor: false,
        coin: isTestnet ? 'Testnet' : 'Bitcoin',
      });

      if (!result.success) {
        const errorMsg = 'error' in result.payload ? result.payload.error : 'Failed to get public key';
        throw new Error(errorMsg);
      }

      const { xpub, fingerprint: parentFingerprint } = result.payload;

      // IMPORTANT: Trezor's getPublicKey returns the PARENT fingerprint of the requested path,
      // not the master fingerprint. For BIP-174 PSBTs and wallet descriptors, we need the
      // MASTER fingerprint. Use the connection fingerprint (obtained from m/0' during connect).
      const masterFp = this.connection.fingerprint;
      const parentFpHex = parentFingerprint?.toString(16).padStart(8, '0');

      log.info('Got Trezor xpub', {
        path,
        xpubPrefix: xpub.substring(0, 15),
        masterFingerprint: masterFp,
        parentFingerprint: parentFpHex,
      });

      return {
        xpub,
        fingerprint: masterFp || parentFpHex || '', // Prefer master fingerprint
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('cancelled') || message.includes('Cancelled')) {
        throw new Error('Request cancelled on device');
      }

      throw new Error(`Failed to get xpub from Trezor: ${message}`);
    }
  }

  /**
   * Sign a PSBT with Trezor
   * Note: Trezor returns a fully signed raw transaction, not a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    return signPsbtWithTrezor(request, this.connection);
  }
}
