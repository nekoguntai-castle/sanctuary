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
import { normalizeMasterFingerprint } from '../../identity';
import type { TrezorConnection } from './types';
import { signPsbtWithTrezor } from './signPsbt';
import { getTrezorScriptType } from './pathUtils';
import {
  assertSessionIdentity,
  connectDevice,
  connectSelectedDevice,
  requireResolvedSession,
  requireSelectedDevice,
} from './sessionIdentity';

export const TREZOR_CONNECT_VERSION = '9.7.3' as const;

const log = createLogger('TrezorAdapter');

type TrezorFeatures = {
  device_id?: string | null;
  label?: string | null;
  model?: string;
  internal_model?: string;
  pin_protection?: boolean | null;
  unlocked?: boolean | null;
  passphrase_protection?: boolean | null;
  major_version?: number;
  minor_version?: number;
  patch_version?: number;
};

type FingerprintPayload = {
  childNum?: number;
  descriptor?: string;
  depth?: number;
  fingerprint?: number;
  publicKey?: string;
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

const masterFingerprintFromDescriptor = (payload: FingerprintPayload): string | undefined => {
  if (payload.depth !== 3 || payload.childNum !== 0x80000000) return undefined;
  if (!payload.xpub || !payload.descriptor) return undefined;
  const match = payload.descriptor.match(/^wpkh\(\[([0-9a-f]{8})\/84h\/0h\/0h\]/i);
  if (
    !match ||
    !payload.descriptor.startsWith(`wpkh([${match[1]}/84h/0h/0h]${payload.xpub}/<0;1>/*)`)
  )
    return undefined;
  const fingerprint = match[1].toLowerCase();
  log.info('Trezor fingerprint obtained', {
    hexFingerprint: fingerprint,
    xpubPrefix: payload.xpub?.substring(0, 20),
  });
  return fingerprint;
};

const requireMasterFingerprint = (fingerprint: unknown): string => {
  return normalizeMasterFingerprint(fingerprint, 'Trezor');
};

const createConnectError = (message: string): Error => {
  if (message.includes('Popup closed') || message.includes('cancelled')) {
    return new Error('Connection cancelled by user');
  }
  if (message.includes('Device not found') || message.includes('no device')) {
    return new Error(
      'No Trezor device found. Please connect your device and ensure Trezor Suite is running.'
    );
  }
  if (message.includes('Bridge not running')) {
    return new Error('Trezor Suite bridge not running. Please open Trezor Suite desktop app.');
  }

  return new Error(`Failed to connect Trezor: ${message}`);
};

const getCoinForPath = (path: string): 'Bitcoin' | 'Testnet' => {
  return path.includes("/1'/") || path.includes('/1h/') ? 'Testnet' : 'Bitcoin';
};

const isUserRejectedAddressDisplay = (message: string): boolean => {
  return /cancelled|denied|rejected/i.test(message);
};

type TrezorInitSettings = Parameters<typeof TrezorConnect.init>[0];

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

  constructor(private readonly initSettings?: TrezorInitSettings) {}

  private clearSelectedSession(): void {
    this.connection = {
      initialized: this.connection.initialized,
      connected: false,
    };
    this.connectedDevice = null;
  }

  private invalidateStaleSession(message: string): void {
    if (message.includes('Trezor selected session mismatch')) this.clearSelectedSession();
  }

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
      await TrezorConnect.init(
        this.initSettings ?? {
        manifest: {
          email: 'support@sanctuary.bitcoin',
          appUrl: window.location.origin || 'https://sanctuary.bitcoin',
          appName: 'Sanctuary',
        },
        coreMode: 'auto',
        debug: true,
        lazyLoad: false,
        }
      );

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

      const { features, session } = await this.getDeviceFeatures();
      const fingerprint = await this.getMasterFingerprint(session);
      const modelName = getTrezorModelName(features);
      const device = this.setConnectedDevice(features, fingerprint, modelName, session);

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

  private async getDeviceFeatures(): Promise<{
    features: TrezorFeatures;
    session: NonNullable<TrezorConnection['session']>;
  }> {
    const result = await TrezorConnect.getFeatures();

    if (!result.success) {
      const errorPayload = result.payload as { error?: string; code?: string };
      log.error('Trezor getFeatures failed', { payload: errorPayload });
      throw new Error(errorPayload.error || 'Failed to connect to Trezor');
    }

    const selected = requireSelectedDevice(result.device);
    const stateResult = await TrezorConnect.getDeviceState({
      device: connectSelectedDevice(selected),
    });
    if (!stateResult.success) {
      const message =
        'error' in stateResult.payload
          ? stateResult.payload.error
          : 'Failed to resolve selected Trezor session';
      throw new Error(message);
    }
    return {
      features: result.payload as TrezorFeatures,
      session: requireResolvedSession(selected, stateResult.payload.state, stateResult.device),
    };
  }

  private async getMasterFingerprint(
    session: NonNullable<TrezorConnection['session']>
  ): Promise<string> {
    try {
      const fpResult = await TrezorConnect.getPublicKey({
        path: "m/84'/0'/0'",
        coin: 'Bitcoin',
        scriptType: 'SPENDWITNESS',
        showOnTrezor: false,
        device: connectDevice(session),
      });
      if (!fpResult.success) {
        throw new Error('Trezor master fingerprint request failed');
      }
      assertSessionIdentity(fpResult.device, session);
      return requireMasterFingerprint(masterFingerprintFromDescriptor(fpResult.payload));
    } catch (fpError) {
      log.warn('Could not get fingerprint from Trezor', { error: fpError });
      const message = fpError instanceof Error ? fpError.message : 'Unknown error';
      throw new Error(`Trezor master fingerprint unavailable: ${message}`);
    }
  }

  private setConnectedDevice(
    features: TrezorFeatures,
    fingerprint: string,
    modelName: string,
    session: NonNullable<TrezorConnection['session']>
  ): HardwareWalletDevice {
    const firmwareVersion = [
      features.major_version,
      features.minor_version,
      features.patch_version,
    ].every((value) => Number.isInteger(value))
      ? `${features.major_version}.${features.minor_version}.${features.patch_version}`
      : undefined;
    this.connection = {
      initialized: true,
      connected: true,
      session,
      deviceId: features.device_id || undefined,
      fingerprint,
      model: modelName,
      label: features.label || undefined,
      firmwareVersion,
      connectVersion: TREZOR_CONNECT_VERSION,
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
      firmwareVersion,
      transportVersion: TREZOR_CONNECT_VERSION,
    };
    this.connectedDevice = device;

    return device;
  }

  /**
   * Disconnect from Trezor
   */
  async disconnect(): Promise<void> {
    this.clearSelectedSession();
    log.info('Trezor disconnected');
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }
    const masterFingerprint = requireMasterFingerprint(this.connection.fingerprint);
    const session = this.connection.session;
    if (!session) throw new Error('Trezor selected session is unavailable');

    try {
      const result = await TrezorConnect.getPublicKey({
        path,
        showOnTrezor: false,
        coin: getCoinForPath(path),
        device: connectDevice(session),
      });

      if (!result.success) {
        const errorMsg =
          'error' in result.payload ? result.payload.error : 'Failed to get public key';
        throw new Error(errorMsg);
      }
      assertSessionIdentity(result.device, session);

      const { xpub, fingerprint: parentFingerprint } = result.payload;
      if (typeof xpub !== 'string' || xpub.length === 0) {
        throw new Error(`Trezor returned an empty xpub for ${path}`);
      }

      // IMPORTANT: Trezor's getPublicKey returns the PARENT fingerprint of the requested path,
      // not the master fingerprint. For BIP-174 PSBTs and wallet descriptors, we need the
      // MASTER fingerprint. Use the origin embedded in the device-authored account descriptor.
      const parentFpHex = parentFingerprint?.toString(16).padStart(8, '0');

      log.info('Got Trezor xpub', {
        path,
        xpubPrefix: xpub.substring(0, 15),
        masterFingerprint,
        parentFingerprint: parentFpHex,
      });

      return {
        xpub,
        fingerprint: masterFingerprint,
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.invalidateStaleSession(message);

      if (message.includes('cancelled') || message.includes('Cancelled')) {
        throw new Error('Request cancelled on device');
      }

      throw new Error(`Failed to get xpub from Trezor: ${message}`);
    }
  }

  /**
   * Verify an address on the Trezor display.
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }
    const session = this.connection.session;
    if (!session) throw new Error('Trezor selected session is unavailable');

    try {
      const result = await TrezorConnect.getAddress({
        path,
        address,
        showOnTrezor: true,
        coin: getCoinForPath(path),
        scriptType: getTrezorScriptType(path),
        device: connectDevice(session),
      });

      if (!result.success) {
        const errorMsg =
          'error' in result.payload ? result.payload.error : 'Failed to verify address';
        throw new Error(errorMsg);
      }
      assertSessionIdentity(result.device, session);

      return result.payload.address === address;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.invalidateStaleSession(message);

      if (isUserRejectedAddressDisplay(message)) {
        return false;
      }

      throw new Error(`Failed to verify address on Trezor: ${message}`);
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

    try {
      return await signPsbtWithTrezor(request, this.connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.invalidateStaleSession(message);
      throw error;
    }
  }
}
