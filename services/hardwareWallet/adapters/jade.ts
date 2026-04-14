/**
 * Blockstream Jade Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Jade devices using WebSerial.
 * Uses CBOR-encoded RPC protocol for communication.
 */

import { encode, decode } from 'cbor-x';
import { createLogger } from '../../../utils/logger';
import { isTestnetPath } from '../pathUtils';
import { jadePathToArray } from './jadePathUtils';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('JadeAdapter');

// Jade USB identifiers
const JADE_VENDOR_ID = 0x10c4; // Silicon Labs
const JADE_PRODUCT_ID = 0xea60;

// Alternative IDs for Jade Plus
const JADE_PLUS_VENDOR_ID = 0x1a86;
const JADE_PLUS_PRODUCT_ID = 0x55d4;

// Serial port settings
const SERIAL_OPTIONS: SerialOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

// RPC message types
interface JadeRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JadeRpcResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Connection state
interface JadeConnection {
  port: SerialPort;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  messageId: number;
}

/**
 * Generate unique message ID
 */
let globalMessageId = 0;
const generateMessageId = (): string => {
  globalMessageId = (globalMessageId + 1) % 100000;
  return `msg${globalMessageId}`;
};

/**
 * Jade Device Adapter
 */
export class JadeAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'jade';
  readonly displayName = 'Blockstream Jade';

  private connection: JadeConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;
  private responseBuffer: Uint8Array = new Uint8Array(0);

  /**
   * Check if WebSerial is supported
   */
  isSupported(): boolean {
    const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    return hasWebSerial && isSecure;
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
   * Get list of previously authorized Jade devices
   */
  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      const ports = await navigator.serial.getPorts();

      return ports
        .filter((port) => {
          const info = port.getInfo();
          return (
            (info.usbVendorId === JADE_VENDOR_ID && info.usbProductId === JADE_PRODUCT_ID) ||
            (info.usbVendorId === JADE_PLUS_VENDOR_ID && info.usbProductId === JADE_PLUS_PRODUCT_ID)
          );
        })
        .map((port, index) => {
          const info = port.getInfo();
          const isPlus = info.usbVendorId === JADE_PLUS_VENDOR_ID;
          return {
            id: `jade-${info.usbVendorId}-${info.usbProductId}-${index}`,
            type: 'jade' as DeviceType,
            name: isPlus ? 'Jade Plus' : 'Jade',
            model: isPlus ? 'Jade Plus' : 'Jade',
            connected: false,
            fingerprint: undefined,
          };
        });
    } catch (error) {
      log.error('Failed to enumerate devices', { error });
      return [];
    }
  }

  /**
   * Send CBOR-encoded RPC request and wait for response
   */
  private async sendRpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    const id = generateMessageId();
    const request: JadeRpcRequest = { id, method };
    if (params) {
      request.params = params;
    }

    log.info('Sending RPC request', { method, id });

    // Encode and send
    const encoded = encode(request);
    await this.connection.writer.write(new Uint8Array(encoded));

    // Read response
    const response = await this.readResponse(id);

    if (response.error) {
      throw new Error(`Jade error (${response.error.code}): ${response.error.message}`);
    }

    return response.result as T;
  }

  /**
   * Read CBOR response from device
   */
  private async readResponse(expectedId: string, timeout = 60000): Promise<JadeRpcResponse> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Try to decode accumulated buffer
      if (this.responseBuffer.length > 0) {
        try {
          const response = decode(this.responseBuffer) as JadeRpcResponse;

          // Check if this is our response
          if (response.id === expectedId) {
            // Clear buffer after successful decode
            this.responseBuffer = new Uint8Array(0);
            return response;
          }

          // Not our message, clear and continue
          log.warn('Received unexpected message', { expectedId, receivedId: response.id });
          this.responseBuffer = new Uint8Array(0);
        } catch (error) {
          log.debug('Waiting for more Jade CBOR response bytes', { error });
          // Incomplete CBOR data, need more bytes
        }
      }

      // Read more data
      const { value, done } = await this.connection.reader.read();

      if (done) {
        throw new Error('Serial port closed unexpectedly');
      }

      if (value) {
        // Append to buffer
        const newBuffer = new Uint8Array(this.responseBuffer.length + value.length);
        newBuffer.set(this.responseBuffer);
        newBuffer.set(value, this.responseBuffer.length);
        this.responseBuffer = newBuffer;
      }
    }

    throw new Error('Timeout waiting for device response');
  }

  /**
   * Connect to a Jade device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebSerial is not supported. Please use Chrome/Edge on HTTPS.');
    }

    // Close existing connection
    await this.disconnect();

    try {
      // Request device permission
      const port = await navigator.serial.requestPort({
        filters: [
          { usbVendorId: JADE_VENDOR_ID, usbProductId: JADE_PRODUCT_ID },
          { usbVendorId: JADE_PLUS_VENDOR_ID, usbProductId: JADE_PLUS_PRODUCT_ID },
        ],
      });

      const info = port.getInfo();
      const isPlus = info.usbVendorId === JADE_PLUS_VENDOR_ID;

      log.info('Opening serial port', { vendorId: info.usbVendorId, productId: info.usbProductId });

      // Open port
      await port.open(SERIAL_OPTIONS);

      if (!port.readable || !port.writable) {
        throw new Error('Serial port not readable/writable');
      }

      const reader = port.readable.getReader();
      const writer = port.writable.getWriter();

      this.connection = { port, reader, writer, messageId: 0 };
      this.responseBuffer = new Uint8Array(0);

      // Get version info to verify connection
      const versionInfo = await this.sendRpc<{
        JADE_VERSION: string;
        JADE_OTA_MAX_CHUNK: number;
        JADE_CONFIG: string;
        BOARD_TYPE: string;
        JADE_FEATURES: string;
        IDF_VERSION: string;
        CHIP_FEATURES: string;
        EFUSEMAC: string;
      }>('get_version_info');

      log.info('Connected to Jade', {
        version: versionInfo.JADE_VERSION,
        board: versionInfo.BOARD_TYPE,
        features: versionInfo.JADE_FEATURES,
      });

      this.connectedDevice = {
        id: `jade-${info.usbVendorId}-${info.usbProductId}`,
        type: 'jade',
        name: isPlus ? 'Jade Plus' : `Jade ${versionInfo.JADE_VERSION}`,
        model: versionInfo.BOARD_TYPE || (isPlus ? 'Jade Plus' : 'Jade'),
        connected: true,
        fingerprint: undefined,
      };

      return this.connectedDevice;
    } catch (error) {
      await this.disconnect();

      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('denied') || message.includes('NotAllowed') || message.includes('cancelled')) {
        throw new Error('Access denied. Please allow device access and try again.');
      }
      if (message.includes('busy') || message.includes('in use')) {
        throw new Error('Device is busy. Please close other applications using Jade.');
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
        this.connection.reader.releaseLock();
        this.connection.writer.releaseLock();
        await this.connection.port.close();
      } catch (error) {
        log.warn('Error closing connection', { error });
      }
      this.connection = null;
    }
    this.connectedDevice = null;
    this.responseBuffer = new Uint8Array(0);
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const isTestnet = isTestnetPath(path);
      const network = isTestnet ? 'testnet' : 'mainnet';
      const pathArray = jadePathToArray(path);

      log.info('Getting xpub', { path, network, pathArray });

      const xpub = await this.sendRpc<string>('get_xpub', {
        network,
        path: pathArray,
      });

      log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });

      return {
        xpub,
        fingerprint: '', // Jade doesn't return fingerprint with xpub
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('User cancelled') || message.includes('user_cancelled')) {
        throw new Error('Request cancelled on device');
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
      const isTestnet = isTestnetPath(path);
      const network = isTestnet ? 'testnet' : 'mainnet';
      const pathArray = jadePathToArray(path);

      // Determine variant based on path
      let variant = 'pkh(k)'; // Default P2PKH
      if (path.includes("/84'") || path.includes("/84h")) {
        variant = 'wpkh(k)';
      } else if (path.includes("/49'") || path.includes("/49h")) {
        variant = 'sh(wpkh(k))';
      } else if (path.includes("/86'") || path.includes("/86h")) {
        variant = 'tr(k)';
      }

      await this.sendRpc<string>('get_receive_address', {
        network,
        path: pathArray,
        variant,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('User cancelled') || message.includes('user_cancelled')) {
        return false;
      }

      throw new Error(`Failed to verify address: ${message}`);
    }
  }

  /**
   * Sign a PSBT
   *
   * Jade has native PSBT signing support via the sign_psbt RPC command
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
      // Determine network from account path
      const accountPath = request.accountPath || request.inputPaths?.[0] || "m/84'/0'/0'";
      const isTestnet = isTestnetPath(accountPath);
      const network = isTestnet ? 'testnet' : 'mainnet';

      log.info('Signing PSBT', { network, accountPath });

      // Jade's sign_psbt takes base64 PSBT and returns signed base64 PSBT
      const signedPsbt = await this.sendRpc<string>('sign_psbt', {
        network,
        psbt: request.psbt,
      });

      log.info('PSBT signed successfully');

      // Count signatures by comparing input count
      // (Jade doesn't return signature count, so we estimate)
      const signatureCount = request.inputPaths?.length || 1;

      return {
        psbt: signedPsbt,
        signatures: signatureCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('PSBT signing failed', { error: message });

      if (message.includes('User cancelled') || message.includes('user_cancelled')) {
        throw new Error('Transaction rejected on device. Please approve the transaction on your Jade.');
      }
      if (message.includes('busy') || message.includes('in use')) {
        throw new Error('Jade is busy. Please wait and try again.');
      }

      throw new Error(`Failed to sign transaction: ${message}`);
    }
  }
}
