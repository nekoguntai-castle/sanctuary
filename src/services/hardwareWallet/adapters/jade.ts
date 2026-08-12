/** Funds-safe Blockstream Jade/Jade Plus WebSerial adapter. */

import {
  chainEnvironmentToDerivationFamily,
  parseCanonicalAccountPath,
  parseCanonicalAddressPath,
  type DerivationNetworkFamily,
} from '@sanctuary/shared/constants/walletPolicy';
import { createLogger } from '../../../utils/logger';
import { assertJadeAccountXpubChain, masterFingerprintFromRootXpub } from './jadeIdentity';
import { relayJadePinRequest } from './jadePinRelayClient';
import { JadeProtocolSession, type JadeNetwork } from './jadeProtocol';
import { validateJadeSignedPsbt } from './jadeSignedPsbt';
import { jadePathToArray } from './jadePathUtils';
import { validatePsbtSigningRequest } from '../psbtAccountBinding';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletConnectionOptions,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('JadeAdapter');
const JADE_VENDOR_ID = 0x10c4;
const JADE_PRODUCT_ID = 0xea60;
const JADE_PLUS_VENDOR_ID = 0x1a86;
const JADE_PLUS_PRODUCT_ID = 0x55d4;
const TRANSPORT_CLOSE_TIMEOUT_MS = 2_000;
const SERIAL_OPTIONS: SerialOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

interface JadeVersionInfo {
  JADE_VERSION: string;
  BOARD_TYPE?: string;
}

interface ActiveJadeSession {
  protocol: JadeProtocolSession;
  family: DerivationNetworkFamily;
  network: JadeNetwork;
  fingerprint: string;
}

const portModel = (info: SerialPortInfo): 'Jade' | 'Jade Plus' | null => {
  if (info.usbVendorId === JADE_PLUS_VENDOR_ID && info.usbProductId === JADE_PLUS_PRODUCT_ID) {
    return 'Jade Plus';
  }
  if (info.usbVendorId === JADE_VENDOR_ID && info.usbProductId === JADE_PRODUCT_ID) return 'Jade';
  return null;
};

const requireConnectionOptions = (
  options?: HardwareWalletConnectionOptions,
): { family: DerivationNetworkFamily; network: JadeNetwork; expectedModel?: string } => {
  const family = chainEnvironmentToDerivationFamily(options?.chainEnvironment);
  if (!family) throw new Error('Jade connection requires an explicit supported chain environment');
  return {
    family,
    network: family === 'mainnet' ? 'mainnet' : 'testnet',
    expectedModel: options?.expectedModel,
  };
};

const responseResult = <T>(value: unknown, label: string): T => {
  if (value === undefined) throw new Error(`Jade did not return ${label}`);
  return value as T;
};

const addressVariant = (purpose: number): string => {
  if (purpose === 44) return 'pkh(k)';
  if (purpose === 49) return 'sh(wpkh(k))';
  if (purpose === 84) return 'wpkh(k)';
  if (purpose === 86) return 'tr(k)';
  throw new Error('Jade multisig address display is not supported');
};

const boundedReaderCancel = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> => {
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(
    () => rejectDeadline(new Error('Jade reader cancellation timed out')),
    TRANSPORT_CLOSE_TIMEOUT_MS,
  );
  try {
    await Promise.race([reader.cancel(), deadline]);
  } finally {
    clearTimeout(timer);
  }
};

export class JadeAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'jade';
  readonly displayName = 'Blockstream Jade';

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private session: ActiveJadeSession | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;

  isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && 'serial' in navigator
      && typeof window !== 'undefined'
      && window.isSecureContext;
  }

  isConnected(): boolean {
    return Boolean(this.session && this.connectedDevice?.connected);
  }

  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) return [];
    try {
      const ports = await navigator.serial.getPorts();
      return ports.flatMap((port, index) => {
        const info = port.getInfo();
        const model = portModel(info);
        return model ? [{
          id: `jade-${info.usbVendorId}-${info.usbProductId}-${index}`,
          type: 'jade' as const,
          name: model,
          model,
          connected: false,
        }] : [];
      });
    } catch (error) {
      log.error('Failed to enumerate Jade devices', { error });
      return [];
    }
  }

  async connect(options?: HardwareWalletConnectionOptions): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebSerial is not supported. Please use Chrome/Edge on HTTPS.');
    }
    const requested = requireConnectionOptions(options);
    await this.disconnect();
    try {
      const port = await navigator.serial.requestPort({ filters: [
        { usbVendorId: JADE_VENDOR_ID, usbProductId: JADE_PRODUCT_ID },
        { usbVendorId: JADE_PLUS_VENDOR_ID, usbProductId: JADE_PLUS_PRODUCT_ID },
      ] });
      const info = port.getInfo();
      const model = portModel(info);
      if (!model || (requested.expectedModel && requested.expectedModel !== model)) {
        throw new Error(`Selected device is not the requested ${requested.expectedModel ?? 'Jade model'}`);
      }
      await port.open(SERIAL_OPTIONS);
      if (!port.readable || !port.writable) throw new Error('Serial port not readable/writable');
      this.port = port;
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      const protocol = new JadeProtocolSession({
        reader: this.reader,
        writer: this.writer,
        invalidate: () => this.closeTransport(),
      });
      const versionResponse = await protocol.rpc('get_version_info');
      const version = responseResult<JadeVersionInfo>(versionResponse.result, 'version information');
      if (typeof version.JADE_VERSION !== 'string' || version.JADE_VERSION.length === 0) {
        throw new Error('Jade returned malformed version information');
      }
      await protocol.authenticate(requested.network, relayJadePinRequest, Math.floor(Date.now() / 1000));
      const rootResponse = await protocol.rpc('get_xpub', { network: requested.network, path: [] });
      const rootXpub = responseResult<unknown>(rootResponse.result, 'root xpub');
      const fingerprint = masterFingerprintFromRootXpub(rootXpub, requested.family);
      this.session = { protocol, fingerprint, family: requested.family, network: requested.network };
      this.connectedDevice = {
        id: `jade-${info.usbVendorId}-${info.usbProductId}`,
        type: 'jade',
        name: model,
        model,
        connected: true,
        fingerprint,
        firmwareVersion: version.JADE_VERSION,
      };
      return this.connectedDevice;
    } catch (error) {
      await this.closeTransport();
      throw this.mapConnectionError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.closeTransport();
  }

  async getXpub(path: string): Promise<XpubResult> {
    const session = this.requireSession();
    const parsed = parseCanonicalAccountPath(path);
    if (!parsed || parsed.policy.walletType !== 'single_sig' || parsed.derivationFamily !== session.family) {
      throw new Error('Jade xpub request does not match the selected single-signature network session');
    }
    const requestedPath = jadePathToArray(path);
    const xpubs: unknown[] = [];
    for (let depth = 1; depth <= requestedPath.length; depth++) {
      const response = await session.protocol.rpc('get_xpub', {
        network: session.network,
        path: requestedPath.slice(0, depth),
      });
      xpubs.push(response.result);
    }
    const xpub = assertJadeAccountXpubChain(
      xpubs,
      path,
      session.family,
      session.fingerprint,
    );
    return { xpub, fingerprint: session.fingerprint, path };
  }

  async verifyAddress(path: string, address: string): Promise<boolean> {
    const session = this.requireSession();
    const parsed = parseCanonicalAddressPath(path);
    if (!parsed || parsed.policy.walletType !== 'single_sig' || parsed.derivationFamily !== session.family) {
      throw new Error('Jade address path does not match the selected single-signature network session');
    }
    try {
      const response = await session.protocol.rpc('get_receive_address', {
        network: session.network,
        path: jadePathToArray(path),
        variant: addressVariant(parsed.policy.purpose),
      }, true);
      return response.result === address;
    } catch (error) {
      if (this.isUserRejection(error)) return false;
      throw error;
    }
  }

  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    const session = this.requireSession();
    const validated = validatePsbtSigningRequest(request, session.fingerprint);
    if (validated.context.walletType === 'multi_sig') {
      throw new Error('Jade multisig signing is not supported');
    }
    const family = chainEnvironmentToDerivationFamily(validated.network);
    if (family !== session.family) {
      throw new Error('Jade signing request does not match the selected network session');
    }
    try {
      const signedBytes = await session.protocol.signPsbt(
        session.network,
        Uint8Array.from(Buffer.from(request.psbt, 'base64')),
      );
      return validateJadeSignedPsbt(validated, signedBytes);
    } catch (error) {
      if (this.isUserRejection(error)) {
        throw new Error('Transaction rejected on Jade');
      }
      throw error;
    }
  }

  private requireSession(): ActiveJadeSession {
    if (!this.session || !this.connectedDevice?.connected) throw new Error('No authenticated Jade session');
    return this.session;
  }

  private async closeTransport(): Promise<void> {
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;
    this.session = null;
    this.connectedDevice = null;
    this.reader = null;
    this.writer = null;
    this.port = null;
    if (reader) {
      try {
        await boundedReaderCancel(reader);
      } catch (error) {
        log.warn('Error cancelling Jade reader', { error });
      }
      try {
        reader.releaseLock();
      } catch (error) {
        log.warn('Error releasing Jade reader', { error });
      }
    }
    if (writer) {
      try {
        writer.releaseLock();
      } catch (error) {
        log.warn('Error releasing Jade writer', { error });
      }
    }
    if (port) {
      try {
        await port.close();
      } catch (error) {
        log.warn('Error closing Jade port', { error });
      }
    }
  }

  private mapConnectionError(error: unknown): Error {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/denied|NotAllowed|cancelled/i.test(message)) return new Error('Access denied. Please allow device access and try again.');
    if (/busy|in use/i.test(message)) return new Error('Device is busy. Please close other applications using Jade.');
    return new Error(`Failed to connect: ${message}`);
  }

  private isUserRejection(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    return /user.cancel|user_reject/i.test(message);
  }
}
