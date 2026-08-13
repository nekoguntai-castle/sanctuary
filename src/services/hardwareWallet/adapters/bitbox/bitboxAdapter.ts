/**
 * BitBox02 Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for BitBox02 devices using WebHID.
 * Supports BitBox02 Multi and BitBox02 Bitcoin-only editions.
 */

import { createLogger } from '../../../../utils/logger';
import { isTestnetPath } from '../../pathUtils';
import { BITBOX_VENDOR_ID, BITBOX_PRODUCT_ID } from './types';
import type { BitBoxConnection } from './types';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../../types';

const log = createLogger('BitBoxAdapter');

type BitBoxApiModule = typeof import('bitbox02-api');
type BitBoxPathUtilsModule = typeof import('./pathUtils');
type BitBoxSignModule = typeof import('./signPsbt');

let bitBoxApiModulePromise: Promise<BitBoxApiModule> | null = null;
let bitBoxPathUtilsModulePromise: Promise<BitBoxPathUtilsModule> | null = null;
let bitBoxSignModulePromise: Promise<BitBoxSignModule> | null = null;

const loadBitBoxApiModule = async (): Promise<BitBoxApiModule> => {
  if (!bitBoxApiModulePromise) {
    bitBoxApiModulePromise = import('bitbox02-api');
  }
  return bitBoxApiModulePromise;
};

const loadBitBoxPathUtilsModule = async (): Promise<BitBoxPathUtilsModule> => {
  if (!bitBoxPathUtilsModulePromise) {
    bitBoxPathUtilsModulePromise = import('./pathUtils');
  }
  return bitBoxPathUtilsModulePromise;
};

const loadBitBoxSignModule = async (): Promise<BitBoxSignModule> => {
  if (!bitBoxSignModulePromise) {
    bitBoxSignModulePromise = import('./signPsbt');
  }
  return bitBoxSignModulePromise;
};

const isAbortError = async (error: unknown): Promise<boolean> => {
  try {
    const { isErrorAbort } = await loadBitBoxApiModule();
    return isErrorAbort(error);
  } catch {
    return false;
  }
};

const readRootFingerprint = (api: InstanceType<BitBoxApiModule['BitBox02API']>): string => {
  const result: unknown = api.firmware().RootFingerprint();
  if (!Array.isArray(result) || result.length < 2 || result[1]) {
    throw new Error('BitBox02 root fingerprint is unavailable');
  }
  const fingerprintBytes = result[0];
  if (!(fingerprintBytes instanceof Uint8Array) || fingerprintBytes.length !== 4) {
    throw new Error('BitBox02 root fingerprint is unavailable');
  }
  return Buffer.from(fingerprintBytes).toString('hex');
};

const getConnectError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (message.includes('denied') || message.includes('NotAllowed') || message.includes('User abort')) {
    return new Error('Access denied. Please allow device access and try again.');
  }
  if (message.includes('Pairing rejected')) {
    return new Error('Pairing was rejected. Please try again and confirm on the device.');
  }
  if (message.includes('Firmware upgrade required')) {
    return new Error('Firmware upgrade required. Please update your BitBox02 firmware.');
  }
  if (message.includes('busy')) {
    return new Error('BitBox02 is busy. Please close other applications using the device.');
  }
  return new Error(`Failed to connect: ${message}`);
};

/**
 * BitBox02 Device Adapter
 */
export class BitBoxAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'bitbox';
  readonly displayName = 'BitBox02';

  private connection: BitBoxConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if WebHID is supported
   */
  isSupported(): boolean {
    const hasWebHID = typeof navigator !== 'undefined' && 'hid' in navigator;
    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    return hasWebHID && isSecure;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get list of previously authorized BitBox02 devices
   */
  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      const devices = await navigator.hid.getDevices();
      const bitboxDevices = devices.filter(
        (d) => d.vendorId === BITBOX_VENDOR_ID && d.productId === BITBOX_PRODUCT_ID
      );

      return bitboxDevices.map((device) => ({
        id: `bitbox-${device.vendorId}-${device.productId}`,
        type: 'bitbox' as DeviceType,
        name: device.productName || 'BitBox02',
        model: 'BitBox02',
        connected: device.opened || false,
        fingerprint: undefined,
      }));
    } catch (error) {
      log.error('Failed to enumerate devices', { error });
      return [];
    }
  }

  /**
   * Connect to a BitBox02 device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebHID is not supported. Please use Chrome/Edge on HTTPS.');
    }

    // Close existing connection
    if (this.connection) {
      try {
        this.connection.api.close();
      } catch (error) {
        log.debug('Ignoring BitBox close error before reconnect', { error });
        // Ignore close errors
      }
      this.connection = null;
    }

    try {
      const { BitBox02API, getDevicePath, constants } = await loadBitBoxApiModule();

      // Get device path (returns "WEBHID" for WebHID)
      const devicePath = await getDevicePath();
      log.info('Got device path', { devicePath });

      const api = new BitBox02API(devicePath);
      let verifiedAttestation: boolean | undefined;

      // Connect with callbacks
      await api.connect(
        // Show pairing code callback
        (pairingCode: string) => {
          log.info('Pairing code received', { pairingCode });
        },
        // User verify callback - resolve when user confirms pairing
        async () => {
          throw new Error(
            'BitBox02 pairing requires explicit user confirmation, which is unavailable in this release'
          );
        },
        // Attestation callback
        (attestationResult: boolean) => {
          log.info('Attestation result', { attestationResult });
          if (!attestationResult) {
            log.warn('Device attestation failed - this may be a counterfeit device');
          }
          verifiedAttestation = attestationResult;
        },
        // On close callback
        () => {
          log.info('BitBox02 connection closed');
          this.connection = null;
          if (this.connectedDevice) {
            this.connectedDevice.connected = false;
          }
        },
        // Status callback
        (status: string) => {
          log.info('BitBox02 status', { status });
        }
      );

      if (verifiedAttestation === false) {
        api.close();
        throw new Error('BitBox02 device attestation failed');
      }
      if (verifiedAttestation !== true) {
        api.close();
        throw new Error('BitBox02 device attestation was not reported');
      }

      // Get product type
      const product = api.firmware().Product();
      let productName: string;
      let model: string;
      if (product === constants.Product.BitBox02Multi) {
        productName = 'BitBox02 Multi';
        model = 'BitBox02';
      } else if (product === constants.Product.BitBox02BTCOnly) {
        productName = 'BitBox02 Bitcoin-only';
        model = 'BitBox02 Bitcoin-only';
      } else {
        api.close();
        throw new Error(`Unsupported BitBox02 product: ${String(product)}`);
      }
      const rootFingerprint = readRootFingerprint(api);

      log.info('Connected to BitBox02', { product: productName });

      this.connection = { api, devicePath, product, rootFingerprint };

      this.connectedDevice = {
        id: `bitbox-${BITBOX_VENDOR_ID}-${BITBOX_PRODUCT_ID}`,
        type: 'bitbox',
        name: productName,
        model,
        connected: true,
        fingerprint: rootFingerprint,
      };

      return this.connectedDevice;
    } catch (error) {
      throw getConnectError(error);
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.api.close();
      } catch (error) {
        log.warn('Error closing connection', { error });
      }
      this.connection = null;
    }
    this.connectedDevice = null;
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const [{ getKeypathFromString }, { getCoin, getXpubType }] = await Promise.all([
        loadBitBoxApiModule(),
        loadBitBoxPathUtilsModule(),
      ]);

      const isTestnet = isTestnetPath(path);
      const coin = getCoin(path);
      const keypathArray = getKeypathFromString(path);
      const xpubType = getXpubType(path, isTestnet);

      log.info('Getting xpub', { path, coin, xpubType, isTestnet });

      const xpub = await this.connection.api.btcXPub(coin, keypathArray, xpubType, false);
      const fingerprint = this.connection.rootFingerprint;
      if (!/^[0-9a-f]{8}$/.test(fingerprint)) {
        throw new Error('BitBox02 root fingerprint is unavailable');
      }

      log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });

      return {
        xpub,
        fingerprint,
        path,
      };
    } catch (error) {
      if (await isAbortError(error)) {
        throw new Error('Request cancelled on device');
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get xpub: ${message}`);
    }
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const [{ getKeypathFromString }, { getCoin, getSimpleType }] = await Promise.all([
        loadBitBoxApiModule(),
        loadBitBoxPathUtilsModule(),
      ]);

      const coin = getCoin(path);
      const keypathArray = getKeypathFromString(path);
      const simpleType = getSimpleType(undefined, path);

      const displayedAddress = await this.connection.api.btcDisplayAddressSimple(
        coin,
        keypathArray,
        simpleType,
        true
      );
      return displayedAddress === address;
    } catch (error) {
      if (await isAbortError(error)) {
        return false;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to verify address: ${message}`);
    }
  }

  /**
   * Sign a PSBT (delegates to standalone signPsbtWithBitBox)
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    log.info('signPSBT called', {
      hasRequest: !!request,
      psbtLength: request?.psbt?.length || 0,
      inputPathsCount: request?.inputPaths?.length || 0,
      accountPath: request?.accountPath,
      scriptType: request?.scriptType,
    });

    if (!this.connection) {
      log.error('No active connection');
      throw new Error('No device connected');
    }

    try {
      const { signPsbtWithBitBox } = await loadBitBoxSignModule();
      return await signPsbtWithBitBox(request, this.connection);
    } catch (error) {
      if (await isAbortError(error)) {
        throw new Error('Transaction rejected on device. Please approve the transaction on your BitBox02.');
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('PSBT signing failed', { error: message });

      if (message.includes('busy')) {
        throw new Error('BitBox02 is busy. Please close other applications using the device.');
      }
      if (message.startsWith('BitBox02 multisig USB signing is blocked')) {
        throw new Error(message);
      }

      throw new Error(`Failed to sign transaction: ${message}`);
    }
  }
}
