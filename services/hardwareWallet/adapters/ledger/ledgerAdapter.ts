/**
 * Ledger Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Ledger devices using WebUSB.
 * Supports Nano S, Nano X, Nano S Plus, Stax, and Flex.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
import { AppClient } from '@ledgerhq/ledger-bitcoin';
import { createLogger } from '../../../../utils/logger';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../../types';
import { LEDGER_VENDOR_ID, XPUB_VERSION, TPUB_VERSION, getLedgerModel, getDeviceId } from './utils';
import { signPsbt } from './signPsbt';

const log = createLogger('LedgerAdapter');

type LedgerErrorContext = 'connect' | 'xpub';
type LedgerFriendlyErrorRule = {
  patterns: readonly string[];
  connect: string;
  xpub: string;
};

const LEDGER_FRIENDLY_PREFIXES = [
  'Access denied.',
  'Ledger is locked.',
  'Please open the Bitcoin app',
  'Bitcoin app not open',
  'Ledger is already connected',
  'Request rejected on Ledger.',
  'Ledger disconnected.',
];

const LEDGER_FRIENDLY_ERROR_RULES: LedgerFriendlyErrorRule[] = [
  {
    patterns: ['notallowed', 'access denied', 'denied access', 'permission denied'],
    connect: 'Access denied. Please allow USB access and try again.',
    xpub: 'Access denied. Please allow USB access and try again.',
  },
  {
    patterns: ['0x6982', 'locked'],
    connect: 'Ledger is locked. Please unlock with your PIN.',
    xpub: 'Ledger is locked. Unlock it with your PIN and try again.',
  },
  {
    patterns: ['0x6d00', '0x6e00', 'cla_not_supported', 'ins_not_supported', 'bitcoin app not open'],
    connect: 'Please open the Bitcoin app on your Ledger device.',
    xpub: 'Bitcoin app not open on Ledger. Open the Bitcoin app and try again.',
  },
  {
    patterns: ['already open', 'already claimed', 'interface claimed', 'libusb_error_busy', 'busy'],
    connect: 'Ledger is already connected to another app. Close Ledger Live and other browser tabs, then try again.',
    xpub: 'Ledger is already connected to another app. Close Ledger Live and other browser tabs, then try again.',
  },
  {
    patterns: ['0x6985', 'rejected', 'denied by user'],
    connect: 'Request rejected on Ledger. Approve the public key export on the device to import accounts.',
    xpub: 'Request rejected on Ledger. Approve the public key export on the device to import accounts.',
  },
  {
    patterns: ['no device', 'disconnected'],
    connect: 'Ledger disconnected. Reconnect it and try again.',
    xpub: 'Ledger disconnected. Reconnect it and try again.',
  },
];

// Connection state
interface LedgerConnection {
  transport: TransportWebUSB;
  app: AppBtc;
  appClient: AppClient;
  device: USBDevice;
}

function getLedgerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function matchesAnyPattern(message: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => message.includes(pattern));
}

function getLedgerFriendlyError(error: unknown, context: LedgerErrorContext): string | null {
  const message = getLedgerErrorMessage(error);
  if (LEDGER_FRIENDLY_PREFIXES.some(prefix => message.startsWith(prefix))) return message;

  const normalized = message.toLowerCase();
  for (const rule of LEDGER_FRIENDLY_ERROR_RULES) {
    if (matchesAnyPattern(normalized, rule.patterns)) return rule[context];
  }

  return null;
}

function shouldTryLegacyXpubFallback(error: unknown): boolean {
  return getLedgerFriendlyError(error, 'xpub') === null;
}

/**
 * Ledger Device Adapter
 */
export class LedgerAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'ledger';
  readonly displayName = 'Ledger';

  private connection: LedgerConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if WebUSB is supported
   */
  isSupported(): boolean {
    const hasWebUSB = typeof navigator !== 'undefined' && 'usb' in navigator;
    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    return hasWebUSB && isSecure;
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
   * Get list of previously authorized Ledger devices
   */
  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      const devices = await navigator.usb.getDevices();
      const ledgerDevices = devices.filter(d => d.vendorId === LEDGER_VENDOR_ID);

      return ledgerDevices.map(device => ({
        id: getDeviceId(device),
        type: 'ledger' as DeviceType,
        name: getLedgerModel(device.productId),
        model: getLedgerModel(device.productId),
        connected: device.opened || (this.connection?.device === device),
        fingerprint: undefined,
      }));
    } catch (error) {
      log.error('Failed to enumerate devices', { error });
      return [];
    }
  }

  /**
   * Connect to a Ledger device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebUSB is not supported. Please use Chrome/Edge on HTTPS.');
    }

    // Close existing connection
    if (this.connection) {
      try {
        await this.connection.transport.close();
      } catch (error) {
        // Ignore close errors — only triggered by a live WebUSB transport
        // that rejects close(), which cannot be exercised under jsdom.
        /* c8 ignore next */
        log.debug('Ignoring Ledger transport close error before reconnect', { error });
      }
      this.connection = null;
    }

    try {
      // Request device permission and create transport
      const transport = await TransportWebUSB.create();
      const device = (transport as any).device as USBDevice;

      // Create Bitcoin app instances
      const app = new AppBtc({ transport });
      const appClient = new AppClient(transport as any);

      // Get master fingerprint
      let fingerprint: string | undefined;
      try {
        fingerprint = await appClient.getMasterFingerprint();
        log.info('Got master fingerprint from device', { fingerprint });
      } catch (error) {
        const friendlyError = getLedgerFriendlyError(error, 'connect');
        if (friendlyError) {
          try {
            await transport.close();
          } catch (closeError) {
            log.debug('Ignoring Ledger transport close error after failed readiness check', { error: closeError });
          }
          throw new Error(friendlyError);
        }
        log.warn('Could not get fingerprint - Bitcoin app may not be open', { error });
      }

      this.connection = { transport: transport as any, app, appClient, device };

      this.connectedDevice = {
        id: getDeviceId(device),
        type: 'ledger',
        name: getLedgerModel(device.productId),
        model: getLedgerModel(device.productId),
        connected: true,
        fingerprint,
      };

      return this.connectedDevice;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const friendlyError = getLedgerFriendlyError(error, 'connect');

      if (friendlyError) throw new Error(friendlyError);

      throw new Error(`Failed to connect: ${message}`);
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.transport.close();
      } catch (error) {
        log.warn('Error closing transport', { error });
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
      const isTestnet = path.includes("/1'/") || path.includes("/1h/");
      const xpubVersion = isTestnet ? TPUB_VERSION : XPUB_VERSION;

      const xpub = await this.getLedgerXpub(path, xpubVersion);

      if (!xpub) {
        throw new Error(`Ledger returned an empty xpub for ${path}`);
      }

      const fingerprint = await this.getMasterFingerprint();

      log.info('getXpub result', {
        path,
        hasXpub: !!xpub,
        xpubLength: xpub.length,
        fingerprint,
      });

      return {
        xpub,
        fingerprint,
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const friendlyError = getLedgerFriendlyError(error, 'xpub');

      if (friendlyError) throw new Error(friendlyError);

      throw new Error(`Failed to get xpub: ${message}`);
    }
  }

  private async getLedgerXpub(path: string, xpubVersion: number): Promise<string> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      return await this.connection.appClient.getExtendedPubkey(path);
    } catch (error) {
      if (!shouldTryLegacyXpubFallback(error)) {
        throw error;
      }

      log.warn('Ledger AppClient xpub read failed, falling back to legacy BTC API', {
        path,
        error: getLedgerErrorMessage(error),
      });

      return this.connection.app.getWalletXpub({
        path,
        xpubVersion,
      });
    }
  }

  private async getMasterFingerprint(): Promise<string> {
    if (!this.connection) return '';

    if (this.connectedDevice?.fingerprint) {
      return this.connectedDevice.fingerprint;
    }

    try {
      return await this.connection.appClient.getMasterFingerprint();
    } catch (fpError) {
      log.warn('Could not get fingerprint', { error: fpError });
      return '';
    }
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, _address: string): Promise<boolean> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      await this.connection.app.getWalletPublicKey(path, { verify: true });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('0x6985') || message.includes('denied')) {
        return false;
      }

      throw new Error(`Failed to verify address: ${message}`);
    }
  }

  /**
   * Sign a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.connection) {
      log.error('No active connection');
      throw new Error('No device connected');
    }

    try {
      return await signPsbt(this.connection.appClient, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('PSBT signing failed', { error: message });

      if (message.includes('0x6985') || message.includes('denied') || message.includes('rejected')) {
        throw new Error('Transaction rejected on device. Please approve the transaction on your Ledger.');
      }
      if (message.includes('0x6d00') || message.includes('0x6e00') || message.includes('CLA_NOT_SUPPORTED')) {
        throw new Error('Bitcoin app not open on device. Please open the Bitcoin app on your Ledger.');
      }
      if (message.includes('0x6982') || message.includes('locked')) {
        throw new Error('Device is locked. Please unlock your Ledger with your PIN.');
      }
      if (message.includes('No device')) {
        throw new Error('Device disconnected. Please reconnect your Ledger and try again.');
      }

      throw new Error(`Failed to sign transaction: ${message}`);
    }
  }
}
