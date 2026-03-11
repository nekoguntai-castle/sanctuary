/**
 * Hardware Wallet Service
 *
 * Main service class that manages hardware wallet connections using a registry pattern.
 * Supports multiple device types through pluggable adapters.
 *
 * To add support for a new device:
 * 1. Create an adapter implementing DeviceAdapter interface
 * 2. Register it with service.registerAdapter(new MyDeviceAdapter())
 */

import { createLogger } from '../../utils/logger';
import apiClient from '../../src/api/client';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';

const log = createLogger('HardwareWalletService');
type AdapterLoader = () => Promise<DeviceAdapter>;

/**
 * Hardware Wallet Service
 *
 * Manages device adapters and routes operations to the correct implementation.
 */
export class HardwareWalletService {
  private adapters: Map<DeviceType, DeviceAdapter> = new Map();
  private adapterLoaders: Map<DeviceType, AdapterLoader> = new Map();
  private adapterLoadPromises: Map<DeviceType, Promise<DeviceAdapter | undefined>> = new Map();
  private activeAdapter: DeviceAdapter | null = null;

  /**
   * Register a device adapter
   * @param adapter The adapter to register
   */
  registerAdapter(adapter: DeviceAdapter): void {
    this.adapters.set(adapter.type, adapter);
    log.info(`Registered adapter: ${adapter.displayName}`, { type: adapter.type });
  }

  /**
   * Register a lazy adapter loader. The adapter will only be imported/instantiated
   * when the device type is first used.
   */
  registerAdapterLoader(type: DeviceType, loader: AdapterLoader): void {
    this.adapterLoaders.set(type, loader);
  }

  private async ensureAdapter(type: DeviceType): Promise<DeviceAdapter | undefined> {
    const existing = this.adapters.get(type);
    if (existing) return existing;

    const loader = this.adapterLoaders.get(type);
    if (!loader) return undefined;

    if (!this.adapterLoadPromises.has(type)) {
      this.adapterLoadPromises.set(
        type,
        (async () => {
          try {
            const adapter = await loader();
            this.registerAdapter(adapter);
            return adapter;
          } catch (error) {
            log.error(`Failed to lazy-load adapter: ${type}`, { error });
            return undefined;
          } finally {
            this.adapterLoadPromises.delete(type);
          }
        })()
      );
    }

    return this.adapterLoadPromises.get(type);
  }

  /**
   * Get all registered adapters
   */
  getRegisteredAdapters(): DeviceAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get adapter for a specific device type
   */
  getAdapter(type: DeviceType): DeviceAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Check if a device type is supported
   * @param type Optional device type - if not specified, checks if any adapter is available
   */
  isSupported(type?: DeviceType): boolean {
    if (type) {
      const adapter = this.adapters.get(type);
      return adapter ? adapter.isSupported() : false;
    }
    // Check if any adapter is supported
    return Array.from(this.adapters.values()).some(a => a.isSupported());
  }

  /**
   * Check if a device is currently connected
   */
  isConnected(): boolean {
    return this.activeAdapter?.isConnected() ?? false;
  }

  /**
   * Get the currently connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.activeAdapter?.getDevice() ?? null;
  }

  /**
   * Get all authorized devices (from all adapters that support it)
   */
  async getDevices(): Promise<HardwareWalletDevice[]> {
    const allDevices: HardwareWalletDevice[] = [];

    for (const adapter of this.adapters.values()) {
      if (adapter.getAuthorizedDevices) {
        try {
          const devices = await adapter.getAuthorizedDevices();
          allDevices.push(...devices);
        } catch (error) {
          log.warn(`Failed to get devices from ${adapter.displayName}`, { error });
        }
      }
    }

    return allDevices;
  }

  /**
   * Connect to a device
   * @param type Device type to connect to
   */
  async connect(type?: DeviceType): Promise<HardwareWalletDevice> {
    // If no type specified and only one adapter, use it
    if (!type) {
      if (this.adapters.size === 1) {
        type = this.adapters.keys().next().value;
      } else {
        throw new Error('Device type must be specified when multiple adapters are registered');
      }
    }

    await this.ensureAdapter(type);
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for device type: ${type}`);
    }

    if (!adapter.isSupported()) {
      throw new Error(`${adapter.displayName} is not supported in this environment`);
    }

    // Disconnect any active adapter
    if (this.activeAdapter && this.activeAdapter !== adapter) {
      try {
        await this.activeAdapter.disconnect();
      } catch (error) {
        log.warn('Error disconnecting previous adapter', { error });
      }
    }

    // Connect with the new adapter
    const device = await adapter.connect();
    this.activeAdapter = adapter;

    log.info(`Connected to ${adapter.displayName}`, {
      deviceId: device.id,
      model: device.model,
    });

    return device;
  }

  /**
   * Disconnect from the current device
   */
  async disconnect(): Promise<void> {
    if (this.activeAdapter) {
      await this.activeAdapter.disconnect();
      log.info(`Disconnected from ${this.activeAdapter.displayName}`);
      this.activeAdapter = null;
    }
  }

  /**
   * Get extended public key from the connected device
   * @param path BIP32 derivation path
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    return this.activeAdapter.getXpub(path);
  }

  /**
   * Standard derivation paths to fetch for multi-account import
   */
  static readonly STANDARD_PATHS = [
    { path: "m/84'/0'/0'", purpose: 'single_sig' as const, scriptType: 'native_segwit' as const, name: 'Native SegWit (BIP-84)' },
    { path: "m/86'/0'/0'", purpose: 'single_sig' as const, scriptType: 'taproot' as const, name: 'Taproot (BIP-86)' },
    { path: "m/49'/0'/0'", purpose: 'single_sig' as const, scriptType: 'nested_segwit' as const, name: 'Nested SegWit (BIP-49)' },
    { path: "m/44'/0'/0'", purpose: 'single_sig' as const, scriptType: 'legacy' as const, name: 'Legacy (BIP-44)' },
    { path: "m/48'/0'/0'/2'", purpose: 'multisig' as const, scriptType: 'native_segwit' as const, name: 'Multisig Native SegWit (BIP-48)' },
    { path: "m/48'/0'/0'/1'", purpose: 'multisig' as const, scriptType: 'nested_segwit' as const, name: 'Multisig Nested SegWit (BIP-48)' },
  ];

  /**
   * Get all standard xpubs from the connected device
   * Fetches multiple derivation paths for comprehensive account import
   * @param onProgress Optional callback for progress updates
   * @returns Array of xpub results with account metadata
   */
  async getAllXpubs(
    onProgress?: (current: number, total: number, path: string) => void
  ): Promise<Array<XpubResult & { purpose: 'single_sig' | 'multisig'; scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy' }>> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }

    const results: Array<XpubResult & { purpose: 'single_sig' | 'multisig'; scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy' }> = [];
    const paths = HardwareWalletService.STANDARD_PATHS;

    for (let i = 0; i < paths.length; i++) {
      const { path, purpose, scriptType, name } = paths[i];

      if (onProgress) {
        onProgress(i + 1, paths.length, name);
      }

      try {
        log.info(`Fetching xpub for ${name}`, { path });
        const xpubResult = await this.activeAdapter.getXpub(path);
        results.push({
          ...xpubResult,
          purpose,
          scriptType,
        });
        log.info(`Successfully fetched ${name}`, { fingerprint: xpubResult.fingerprint });
      } catch (error) {
        // Log but continue - some paths may not be supported by all devices
        log.warn(`Failed to fetch ${name}, skipping`, { path, error });
      }
    }

    if (results.length === 0) {
      throw new Error('Failed to fetch any xpubs from device');
    }

    return results;
  }

  /**
   * Sign a PSBT with the connected device
   * @param request PSBT signing request
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    return this.activeAdapter.signPSBT(request);
  }

  /**
   * Verify an address on the device display
   * @param path Derivation path
   * @param address Address to verify
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    if (!this.activeAdapter.verifyAddress) {
      throw new Error(`${this.activeAdapter.displayName} does not support address verification`);
    }
    return this.activeAdapter.verifyAddress(path, address);
  }

  /**
   * Full transaction signing flow
   * Creates PSBT, signs with device, and broadcasts
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('No device connected');
    }

    // Create PSBT via backend
    const { psbt, inputPaths } = await createPSBTForSigning(tx);

    // Sign with connected device
    const signed = await this.signPSBT({ psbt, inputPaths });

    // Broadcast - use rawTx if available (Trezor), otherwise use signed PSBT
    const result = await broadcastSignedTransaction(tx.walletId, signed.psbt, signed.rawTx);

    return result.txid;
  }
}

/**
 * Create a PSBT for signing via the backend API
 */
async function createPSBTForSigning(
  tx: TransactionForSigning
): Promise<{ psbt: string; fee: number; inputPaths: string[] }> {
  const response = await apiClient.post<{
    psbt: string;
    fee: number;
    inputPaths: string[];
  }>(`/wallets/${tx.walletId}/psbt/create`, {
    recipients: [{ address: tx.recipient, amount: tx.amount }],
    feeRate: tx.feeRate,
    utxoIds: tx.utxos,
    changeAddress: tx.changeAddress,
  });

  return response;
}

/**
 * Broadcast a signed transaction to the Bitcoin network
 */
async function broadcastSignedTransaction(
  walletId: string,
  psbt: string,
  rawTx?: string
): Promise<{ txid: string }> {
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/psbt/broadcast`,
    {
      signedPsbt: psbt,
      rawTxHex: rawTx, // For Trezor
    }
  );

  return response;
}

/**
 * Create and configure the default service instance
 */
export function createHardwareWalletService(): HardwareWalletService {
  const service = new HardwareWalletService();

  // Adapters are registered lazily in index.ts to avoid circular imports
  // and to allow tree-shaking of unused adapters

  return service;
}
