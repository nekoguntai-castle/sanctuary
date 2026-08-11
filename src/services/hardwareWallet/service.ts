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

import {
  type DeviceAccountPurpose as DeviceAccountPurposeValue,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import {
  WALLET_POLICY_REGISTRY,
  buildCanonicalAccountPathForFamily,
  type DerivationNetworkFamily,
} from '@sanctuary/shared/constants/walletPolicy';
import { createLogger } from '../../utils/logger';
import apiClient from '../../api/client';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';
import { validatePsbtSigningRequest } from './psbtAccountBinding';
import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  HARDWARE_WALLET_CAPABILITY_ROWS,
  type HardwareWalletVendor,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import {
  HardwareWalletIdentityError,
  normalizeMasterFingerprint,
  validateXpubResult,
} from './identity';
import {
  HardwarePsbtCreateResponseSchema,
  type HardwarePsbtCreateResponse,
} from '@sanctuary/shared/schemas/bitcoinResponses';

const log = createLogger('HardwareWalletService');

function assertHardwareActionEnabled(
  type: DeviceType,
  capability: 'import' | 'account_add' | 'display' | 'sign'
): void {
  const vendor = type as HardwareWalletVendor;
  const blockedRow = HARDWARE_WALLET_CAPABILITY_ROWS.find(
    row => row.vendor === vendor && row.capability === capability
  );
  if (!blockedRow) return;

  throw new Error(
    `Hardware wallet connection is temporarily unavailable (${HARDWARE_WALLET_CAPABILITY_MANIFEST_ID}): ${blockedRow.reason}`
  );
}
type AdapterLoader = () => Promise<DeviceAdapter>;
export type StandardXpubResult = XpubResult & {
  purpose: DeviceAccountPurposeValue;
  scriptType: WalletScriptTypeValue;
};
export type XpubFetchFailure = {
  name: string;
  path: string;
  message: string;
};
export type XpubBatchResult = {
  results: StandardXpubResult[];
  failures: XpubFetchFailure[];
  totalPaths: number;
};

function getXpubFetchErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function getMostCommonFailure(failures: XpubFetchFailure[]): string {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.message, (counts.get(failure.message) ?? 0) + 1);
  }

  let mostCommon = failures[0]?.message ?? 'Unknown error';
  let highestCount = 0;
  for (const [message, count] of counts.entries()) {
    if (count > highestCount) {
      mostCommon = message;
      highestCount = count;
    }
  }

  return mostCommon;
}

function buildAllXpubsFailedMessage(failures: XpubFetchFailure[], totalPaths: number): string {
  const commonFailure = getMostCommonFailure(failures);
  const attemptedNames = failures.map(failure => failure.name).join(', ');

  return [
    `Failed to fetch any xpubs from device after trying ${failures.length}/${totalPaths} standard account paths.`,
    `Most common error: ${commonFailure}.`,
    `Tried: ${attemptedNames}.`,
    'Check that the device is unlocked, the Bitcoin app is open, Ledger Live is closed, and public-key export prompts are approved.',
  ].join(' ');
}

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
    let resolvedType = type;

    // If no type specified and only one adapter, use it
    if (!resolvedType) {
      if (this.adapters.size === 1) {
        // size === 1 guarantees the iterator yields a value
        resolvedType = this.adapters.keys().next().value as DeviceType;
      } else {
        throw new Error('Device type must be specified when multiple adapters are registered');
      }
    }

    assertHardwareActionEnabled(resolvedType, 'import');

    await this.ensureAdapter(resolvedType);
    const adapter = this.adapters.get(resolvedType);
    if (!adapter) {
      throw new Error(`No adapter registered for device type: ${resolvedType}`);
    }

    if (!adapter.isSupported()) {
      throw new Error(`${adapter.displayName} is not supported in this environment`);
    }

    // Clear the active identity before reconnecting so a failed same-adapter
    // attempt cannot leave a stale device session addressable through the service.
    const previousAdapter = this.activeAdapter;
    this.activeAdapter = null;
    if (previousAdapter && previousAdapter !== adapter) {
      try {
        await previousAdapter.disconnect();
      } catch (error) {
        log.warn('Error disconnecting previous adapter', { error });
      }
    }

    // Connect with the new adapter
    const device = await adapter.connect();
    let fingerprint: string;
    try {
      fingerprint = normalizeMasterFingerprint(device.fingerprint, `Connected ${adapter.displayName}`);
    } catch (error) {
      await adapter.disconnect().catch(disconnectError => {
        log.warn('Error disconnecting device with invalid identity evidence', { disconnectError });
      });
      throw error;
    }
    this.activeAdapter = adapter;
    const validatedDevice = { ...device, fingerprint };

    log.info(`Connected to ${adapter.displayName}`, {
      deviceId: device.id,
      model: device.model,
    });

    return validatedDevice;
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
    assertHardwareActionEnabled(this.activeAdapter.type, 'account_add');
    const connectedFingerprint = normalizeMasterFingerprint(
      this.activeAdapter.getDevice()?.fingerprint,
      'Connected hardware wallet'
    );
    const result = await this.activeAdapter.getXpub(path);
    return validateXpubResult(result, path, connectedFingerprint);
  }

  /**
   * Standard derivation paths to fetch for multi-account import.
   * Coin type 1 is the BIP-44 testnet-family slot used by testnet and signet.
   */
  static readonly STANDARD_PATHS = (['mainnet', 'testnet'] as const).flatMap(
    (derivationFamily: DerivationNetworkFamily) => [...WALLET_POLICY_REGISTRY]
      .sort((first, second) => first.hardwareDiscoveryOrder - second.hardwareDiscoveryOrder)
      .map(policy => ({
        path: buildCanonicalAccountPathForFamily({
          walletType: policy.walletType,
          scriptType: policy.scriptType,
          derivationFamily,
          account: 0,
        }),
        purpose: policy.accountPurpose,
        scriptType: policy.scriptType,
        name: derivationFamily === 'mainnet'
          ? policy.displayName
          : `Testnet-family ${policy.displayName}`,
      })),
  );

  /**
   * Get all standard xpubs from the connected device
   * Fetches multiple derivation paths for comprehensive account import
   * @param onProgress Optional callback for progress updates
   * @returns Array of xpub results with account metadata
   */
  async getAllXpubs(
    onProgress?: (current: number, total: number, path: string) => void
  ): Promise<StandardXpubResult[]> {
    const batch = await this.getAllXpubsWithFailures(onProgress);
    return batch.results;
  }

  /**
   * Get all standard xpubs and the paths that were skipped by the device.
   * This preserves partial success while letting UI flows explain missing
   * network-family accounts instead of silently treating the import as complete.
   */
  async getAllXpubsWithFailures(
    onProgress?: (current: number, total: number, path: string) => void
  ): Promise<XpubBatchResult> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    assertHardwareActionEnabled(this.activeAdapter.type, 'account_add');

    const results: StandardXpubResult[] = [];
    const failures: XpubFetchFailure[] = [];
    const paths = HardwareWalletService.STANDARD_PATHS;
    const connectedFingerprint = normalizeMasterFingerprint(
      this.activeAdapter.getDevice()?.fingerprint,
      'Connected hardware wallet'
    );

    for (let i = 0; i < paths.length; i++) {
      const { path, purpose, scriptType, name } = paths[i];

      if (onProgress) {
        onProgress(i + 1, paths.length, name);
      }

      try {
        log.info(`Fetching xpub for ${name}`, { path });
        const xpubResult = await this.activeAdapter.getXpub(path);
        const validated = validateXpubResult(xpubResult, path, connectedFingerprint);
        results.push({ ...validated, purpose, scriptType });
        log.info(`Successfully fetched ${name}`, { fingerprint: validated.fingerprint });
      } catch (error) {
        if (error instanceof HardwareWalletIdentityError) {
          throw error;
        }
        const message = getXpubFetchErrorMessage(error);
        // Log but continue - some paths may not be supported by all devices
        failures.push({ name, path, message });
        log.warn(`Failed to fetch ${name}, skipping`, { path, error: message });
      }
    }

    if (results.length === 0) {
      throw new Error(buildAllXpubsFailedMessage(failures, paths.length));
    }

    if (failures.length > 0) {
      log.warn('Some xpub paths were skipped', {
        fetched: results.length,
        failed: failures.length,
        failures,
      });
    }

    return { results, failures, totalPaths: paths.length };
  }

  /**
   * Sign a PSBT with the connected device
   * @param request PSBT signing request
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    assertHardwareActionEnabled(this.activeAdapter.type, 'sign');
    const connectedFingerprint = this.activeAdapter.getDevice()?.fingerprint;
    validatePsbtSigningRequest(request, connectedFingerprint);
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
    assertHardwareActionEnabled(this.activeAdapter.type, 'display');
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
    const { psbt, signingContext, intentId, intentDigest } = await createPSBTForSigning(tx);

    // Sign with connected device
    const signed = await this.signPSBT({ walletId: tx.walletId, psbt, signingContext });

    // Raw-only hardware results are rejected by broadcastSignedTransaction.
    const result = await broadcastSignedTransaction(
      tx.walletId,
      signed.psbt,
      intentId,
      intentDigest,
      signed.rawTx,
    );

    return result.txid;
  }
}

/**
 * Create a PSBT for signing via the backend API
 */
async function createPSBTForSigning(
  tx: TransactionForSigning
): Promise<HardwarePsbtCreateResponse> {
  return apiClient.post<HardwarePsbtCreateResponse>(`/wallets/${tx.walletId}/psbt/create`, {
    recipients: [{ address: tx.recipient, amount: tx.amount }],
    feeRate: tx.feeRate,
    utxoIds: tx.utxos,
    changeAddress: tx.changeAddress,
  }, { schema: HardwarePsbtCreateResponseSchema });
}

/**
 * Broadcast a signed transaction to the Bitcoin network
 */
async function broadcastSignedTransaction(
  walletId: string,
  psbt: string,
  intentId: string,
  intentDigest: string,
  rawTx?: string
): Promise<{ txid: string }> {
  if (rawTx) {
    throw new Error(
      'Raw-only hardware broadcast is disabled until the adapter provides verifiable signing proof',
    );
  }
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/transactions/broadcast`,
    { signedPsbtBase64: psbt, intentId, intentDigest },
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
