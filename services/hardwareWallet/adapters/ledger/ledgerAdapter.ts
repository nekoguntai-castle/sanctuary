/**
 * Ledger Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Ledger devices using WebUSB.
 * Supports Nano S, Nano X, Nano S Plus, Stax, and Flex.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
import { AppClient } from 'ledger-bitcoin';
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

// Connection state
interface LedgerConnection {
  transport: TransportWebUSB;
  app: AppBtc;
  appClient: AppClient;
  device: USBDevice;
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
      } catch {
        // Ignore close errors
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

      if (message.includes('denied') || message.includes('NotAllowed')) {
        throw new Error('Access denied. Please allow USB access and try again.');
      }
      if (message.includes('0x6d00') || message.includes('0x6e00')) {
        throw new Error('Please open the Bitcoin app on your Ledger device.');
      }
      if (message.includes('locked') || message.includes('0x6982')) {
        throw new Error('Ledger is locked. Please unlock with your PIN.');
      }

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

      const xpub = await this.connection.app.getWalletXpub({
        path,
        xpubVersion,
      });

      let fingerprint = '';
      try {
        fingerprint = await this.connection.appClient.getMasterFingerprint();
      } catch (fpError) {
        log.warn('Could not get fingerprint', { error: fpError });
      }

      log.info('getXpub result', {
        path,
        xpubVersion: xpubVersion.toString(16),
        hasXpub: !!xpub,
        xpubPrefix: xpub?.substring(0, 10),
        fingerprint,
      });

      return {
        xpub,
        fingerprint,
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('0x6985') || message.includes('denied')) {
        throw new Error('Request rejected on device');
      }
      if (message.includes('0x6d00') || message.includes('0x6e00')) {
        throw new Error('Bitcoin app not open on device');
      }

      throw new Error(`Failed to get xpub: ${message}`);
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
