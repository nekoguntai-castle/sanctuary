/**
 * Ledger Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Ledger devices using WebUSB.
 * Supports Nano S, Nano X, Nano S Plus, Stax, and Flex.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
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
import { normalizeMasterFingerprint } from '../../identity';
import { LEDGER_VENDOR_ID, getLedgerModel, getDeviceId } from './utils';
import { signPsbt } from './signPsbt';
import { isTestnetPath } from '../../pathUtils';
import { assertLedgerSession, readLedgerAppIdentity } from './session';
import {
  buildLedgerDefaultPolicy,
  requireLedgerAccountPath,
  requireLedgerAddressPath,
} from './walletPolicy';

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
  'Bitcoin Test app is required',
  'Ledger is already connected',
  'Request rejected on Ledger.',
  'Ledger disconnected.',
];

function requireMasterFingerprint(value: unknown): string {
  return normalizeMasterFingerprint(value, 'Ledger');
}

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
  appClient: AppClient;
  device: USBDevice;
  appName?: string;
  appVersion?: string;
}

export interface LedgerAdapterOptions {
  openTransport?: () => Promise<{
    transport: TransportWebUSB;
    device: USBDevice;
  }>;
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

/**
 * Ledger Device Adapter
 */
export class LedgerAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'ledger';
  readonly displayName = 'Ledger';

  private connection: LedgerConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;

  constructor(private readonly options: LedgerAdapterOptions = {}) {}

  /**
   * Check if WebUSB is supported
   */
  isSupported(): boolean {
    if (this.options.openTransport) return true;
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
      const opened = this.options.openTransport
        ? await this.options.openTransport()
        : await TransportWebUSB.create().then((transport) => ({
            transport,
            device: (transport as any).device as USBDevice,
          }));
      const { transport, device } = opened;

      const appClient = new AppClient(transport as any);

      let appName: string;
      let appVersion: string;
      try {
        const appInfo = await readLedgerAppIdentity(appClient);
        appName = appInfo.name;
        appVersion = appInfo.version;
        log.info('Detected Ledger app', { appName, appVersion });
      } catch (error) {
        try {
          await transport.close();
        } catch (closeError) {
          log.debug('Ignoring Ledger transport close error after failed app check', { error: closeError });
        }
        throw error;
      }

      // Get master fingerprint
      let fingerprint: string;
      try {
        fingerprint = requireMasterFingerprint(await appClient.getMasterFingerprint());
        log.info('Got master fingerprint from device', { fingerprint });
      } catch (error) {
        const friendlyError = getLedgerFriendlyError(error, 'connect');
        try {
          await transport.close();
        } catch (closeError) {
          log.debug('Ignoring Ledger transport close error after failed readiness check', { error: closeError });
        }
        if (friendlyError) throw new Error(friendlyError);
        throw new Error(`Ledger master fingerprint unavailable: ${getLedgerErrorMessage(error)}`);
      }

      this.connection = { transport: transport as any, appClient, device, appName, appVersion };

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
      requireLedgerAccountPath(path);
      await assertLedgerSession(this.connection.appClient, isTestnetPath(path) ? 'testnet' : 'mainnet');
      const xpub = await this.connection.appClient.getExtendedPubkey(path, false);

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

  private async getMasterFingerprint(): Promise<string> {
    if (!this.connection) throw new Error('No device connected');

    try {
      const current = requireMasterFingerprint(await this.connection.appClient.getMasterFingerprint());
      const connected = this.connectedDevice?.fingerprint;
      if (connected !== undefined && current !== requireMasterFingerprint(connected)) {
        throw new Error('Ledger session identity changed after connection');
      }
      return current;
    } catch (fpError) {
      log.warn('Could not get fingerprint', { error: fpError });
      throw new Error(`Ledger master fingerprint unavailable: ${getLedgerErrorMessage(fpError)}`);
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
      const parsed = requireLedgerAddressPath(path);
      await assertLedgerSession(
        this.connection.appClient,
        parsed.derivationFamily === 'mainnet' ? 'mainnet' : 'testnet',
      );
      const policy = await buildLedgerDefaultPolicy(
        this.connection.appClient,
        parsed.accountPath,
        this.connectedDevice?.fingerprint,
      );
      const displayed = await this.connection.appClient.getWalletAddress(
        policy.policy,
        null,
        parsed.branch,
        parsed.index,
        true,
      );
      return displayed === address;
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

      if (message.startsWith('Ledger multisig USB signing is blocked')) {
        throw new Error(message);
      }
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
