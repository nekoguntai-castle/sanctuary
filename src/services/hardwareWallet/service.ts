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
  HardwareWalletConnectionOptions,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';
import { validatePsbtSigningRequest } from './psbtAccountBinding';
import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  getHardwareWalletCapabilityRow,
  type HardwareWalletCapability,
  type HardwareWalletIdentity,
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
type CapabilityRow = NonNullable<ReturnType<typeof getHardwareWalletCapabilityRow>>;

function assertHardwareActionEnabled(
  identity: HardwareWalletIdentity,
  capability: Extract<HardwareWalletCapability, 'import' | 'account_add' | 'display' | 'sign'>
): CapabilityRow {
  const row = getHardwareWalletCapabilityRow(identity, capability);
  if (row?.enabled) return row;

  throw new Error(
    `Hardware wallet connection is temporarily unavailable (${HARDWARE_WALLET_CAPABILITY_MANIFEST_ID}): ${row?.reason ?? 'No reviewed capability row matches this device identity.'}`
  );
}

type AdapterLoader = () => Promise<DeviceAdapter>;
type ApprovedConnection = {
  type: DeviceType;
  importRowId: string;
  vendor: string;
  modelFamily: string;
  fingerprint: string;
};
declare const connectionLeaseBrand: unique symbol;
export type HardwareWalletConnectionLease = {
  readonly [connectionLeaseBrand]: true;
};
export type HardwareWalletLeasedConnection = {
  device: HardwareWalletDevice;
  lease: HardwareWalletConnectionLease;
};
class HardwareWalletLeaseError extends Error {}
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
  const attemptedNames = failures.map((failure) => failure.name).join(', ');

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
  private activeAdapter: DeviceAdapter | null = null;
  private approvedConnection: ApprovedConnection | null = null;
  private activeLease: HardwareWalletConnectionLease | null = null;
  private revokedLeases = new WeakSet<object>();
  private pendingCleanupAdapter: DeviceAdapter | null = null;
  private connectGeneration = 0;
  private connectionQueue: Promise<void> = Promise.resolve();

  /**
   * Register a device adapter
   * @param adapter The adapter to register
   */
  registerAdapter(adapter: DeviceAdapter): void {
    this.adapters.set(adapter.type, adapter);
    log.info(`Registered adapter: ${adapter.displayName}`, {
      type: adapter.type,
    });
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

    try {
      const adapter = await loader();
      this.registerAdapter(adapter);
      return adapter;
    } catch (error) {
      log.error(`Failed to lazy-load adapter: ${type}`, { error });
      return undefined;
    }
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
    return Array.from(this.adapters.values()).some((a) => a.isSupported());
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

  private async requireApprovedAdapter(
    capability: Extract<HardwareWalletCapability, 'account_add' | 'display' | 'sign'>,
  ): Promise<{ adapter: DeviceAdapter; fingerprint: string }> {
    if (!this.activeAdapter) throw new Error('No device connected');
    const adapter = this.activeAdapter;
    const device = adapter.getDevice();
    const identity: HardwareWalletIdentity = { type: adapter.type, model: device?.model };

    try {
      const row = getHardwareWalletCapabilityRow(identity, capability);
      const importRow = getHardwareWalletCapabilityRow(identity, 'import');
      const approved = this.approvedConnection;
      if (!approved) {
        assertHardwareActionEnabled(identity, capability);
        throw new HardwareWalletIdentityError(
          'Connected hardware wallet identity was not approved',
        );
      }
      const fingerprint = normalizeMasterFingerprint(
        device?.fingerprint,
        'Connected hardware wallet',
      );
      if (
        adapter.type !== approved.type
        || importRow?.id !== approved.importRowId
        || row?.vendor !== approved.vendor
        || row?.modelFamily !== approved.modelFamily
        || fingerprint !== approved.fingerprint
      ) {
        throw new HardwareWalletIdentityError(
          'Connected hardware wallet identity changed after approval',
        );
      }
      assertHardwareActionEnabled(identity, capability);
      return { adapter, fingerprint };
    } catch (error) {
      if (!(error instanceof HardwareWalletIdentityError)) throw error;
      this.activeAdapter = null;
      this.approvedConnection = null;
      this.activeLease = null;
      await adapter.disconnect().catch((disconnectError) => {
        this.pendingCleanupAdapter = adapter;
        log.warn('Error disconnecting hardware wallet after identity drift', {
          disconnectError,
        });
      });
      throw error;
    }
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
          log.warn(`Failed to get devices from ${adapter.displayName}`, {
            error,
          });
        }
      }
    }

    return allDevices;
  }

  private enqueueConnectionOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.connectionQueue.then(operation, operation);
    this.connectionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async cleanupAdapterForOwnership(
    adapter: DeviceAdapter,
    message: string,
  ): Promise<void> {
    try {
      await adapter.disconnect();
      if (this.pendingCleanupAdapter === adapter) this.pendingCleanupAdapter = null;
    } catch (error) {
      this.pendingCleanupAdapter = adapter;
      log.warn(message, { error });
      throw error;
    }
  }

  private clearActiveConnection(): DeviceAdapter | null {
    const adapter = this.activeAdapter;
    this.activeAdapter = null;
    this.approvedConnection = null;
    this.activeLease = null;
    return adapter;
  }

  private async performConnect(
    generation: number,
    type?: DeviceType,
    options?: HardwareWalletConnectionOptions,
  ): Promise<HardwareWalletLeasedConnection> {
    if (this.pendingCleanupAdapter) {
      await this.cleanupAdapterForOwnership(
        this.pendingCleanupAdapter,
        'Error retrying pending hardware wallet cleanup',
      );
    }
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

    const expectedRow = assertHardwareActionEnabled(
      { type: resolvedType, model: options?.expectedModel },
      'import',
    );

    await this.ensureAdapter(resolvedType);
    if (this.connectGeneration !== generation) {
      throw new Error('Hardware wallet connect superseded by a newer session operation');
    }
    const adapter = this.adapters.get(resolvedType);
    if (!adapter) {
      throw new Error(`No adapter registered for device type: ${resolvedType}`);
    }

    if (!adapter.isSupported()) {
      throw new Error(`${adapter.displayName} is not supported in this environment`);
    }

    const previousAdapter = this.clearActiveConnection();
    if (previousAdapter) {
      await this.cleanupAdapterForOwnership(
        previousAdapter,
        'Error disconnecting previous adapter',
      );
      if (this.connectGeneration !== generation) {
        throw new Error('Hardware wallet connect superseded by a newer session operation');
      }
    }

    let device: HardwareWalletDevice;
    try {
      device = await adapter.connect(options);
    } catch (error) {
      await this.cleanupAdapterForOwnership(
        adapter,
        'Error cleaning up failed hardware wallet connect',
      ).catch(() => undefined);
      throw error;
    }
    let fingerprint: string;
    let connectedRow: CapabilityRow;
    try {
      if (this.connectGeneration !== generation) {
        throw new Error('Hardware wallet connect superseded by a newer session operation');
      }
      fingerprint = normalizeMasterFingerprint(
        device.fingerprint,
        `Connected ${adapter.displayName}`
      );
      connectedRow = assertHardwareActionEnabled(
        { type: device.type, model: device.model },
        'import',
      );
      if (options?.expectedModel && expectedRow?.id !== connectedRow?.id) {
        throw new HardwareWalletIdentityError(
          'Connected hardware wallet model differs from the selected model'
        );
      }
    } catch (error) {
      await this.cleanupAdapterForOwnership(
        adapter,
        'Error disconnecting device with invalid identity evidence',
      ).catch(() => undefined);
      throw error;
    }
    const lease = Object.freeze({}) as HardwareWalletConnectionLease;
    this.activeAdapter = adapter;
    this.approvedConnection = {
      type: adapter.type,
      importRowId: connectedRow.id,
      vendor: connectedRow.vendor,
      modelFamily: connectedRow.modelFamily,
      fingerprint,
    };
    this.activeLease = lease;
    const validatedDevice = { ...device, fingerprint };

    log.info(`Connected to ${adapter.displayName}`, {
      deviceId: device.id,
      model: device.model,
    });

    return { device: validatedDevice, lease };
  }

  /** Connect to a device and return an opaque lease for conditional release. */
  connectWithLease(
    type?: DeviceType,
    options?: HardwareWalletConnectionOptions,
  ): Promise<HardwareWalletLeasedConnection> {
    const generation = ++this.connectGeneration;
    return this.enqueueConnectionOperation(() => this.performConnect(generation, type, options));
  }

  /**
   * Connect to a device while preserving the original device-only contract.
   */
  async connect(
    type?: DeviceType,
    options?: HardwareWalletConnectionOptions,
  ): Promise<HardwareWalletDevice> {
    const connection = await this.connectWithLease(type, options);
    return connection.device;
  }

  /** Disconnect only when the supplied lease still owns the active session. */
  releaseConnection(lease: HardwareWalletConnectionLease): Promise<void> {
    this.revokedLeases.add(lease);
    return this.enqueueConnectionOperation(async () => {
      if (lease !== this.activeLease) return;
      const adapter = this.clearActiveConnection() as DeviceAdapter;
      await this.cleanupAdapterForOwnership(
        adapter,
        'Error releasing hardware wallet connection',
      );
      log.info(`Disconnected from ${adapter.displayName}`);
    });
  }

  /**
   * Disconnect from the current device
   */
  disconnect(): Promise<void> {
    ++this.connectGeneration;
    if (!this.activeAdapter && !this.pendingCleanupAdapter) return Promise.resolve();
    return this.enqueueConnectionOperation(async () => {
      const adapter = this.clearActiveConnection() ?? this.pendingCleanupAdapter;
      if (!adapter) return;
      await this.cleanupAdapterForOwnership(
        adapter,
        'Error disconnecting hardware wallet',
      );
      log.info(`Disconnected from ${adapter.displayName}`);
    });
  }

  private enqueueLeaseOperation<T>(
    lease: HardwareWalletConnectionLease | null,
    operation: (assertOwnership: () => void) => Promise<T>,
  ): Promise<T> {
    const generation = this.connectGeneration;
    return this.enqueueConnectionOperation(async () => {
      if (!lease) throw new Error('No device connected');
      const assertOwnership = () => this.assertLeaseOwnership(lease, generation);
      assertOwnership();
      const result = await operation(assertOwnership);
      assertOwnership();
      return result;
    });
  }

  private assertLeaseOwnership(
    lease: HardwareWalletConnectionLease,
    generation: number,
  ): void {
    if (this.revokedLeases.has(lease)) {
      throw new HardwareWalletLeaseError('Hardware wallet connection lease was released');
    }
    if (lease !== this.activeLease) {
      throw new HardwareWalletLeaseError('Hardware wallet connection lease is no longer active');
    }
    if (generation !== this.connectGeneration) {
      throw new HardwareWalletLeaseError('Hardware wallet connection lease was superseded');
    }
  }

  /**
   * Get extended public key from the connected device
   * @param path BIP32 derivation path
   */
  getXpub(path: string): Promise<XpubResult> {
    return this.getXpubForLease(this.activeLease as HardwareWalletConnectionLease, path);
  }

  /** Get one xpub only while the supplied lease owns the serialized session. */
  getXpubForLease(
    lease: HardwareWalletConnectionLease,
    path: string,
  ): Promise<XpubResult> {
    return this.enqueueLeaseOperation(lease, async (assertOwnership) => {
      return this.fetchXpub(path, assertOwnership);
    });
  }

  private async fetchXpub(
    path: string,
    assertOwnership: () => void,
  ): Promise<XpubResult> {
    const { adapter, fingerprint } = await this.requireApprovedAdapter('account_add');
    assertOwnership();
    const result = await adapter.getXpub(path);
    assertOwnership();
    return validateXpubResult(result, path, fingerprint);
  }

  /**
   * Standard derivation paths to fetch for multi-account import.
   * Coin type 1 is the BIP-44 testnet-family slot used by testnet and signet.
   */
  static readonly STANDARD_PATHS = (['mainnet', 'testnet'] as const).flatMap(
    (derivationFamily: DerivationNetworkFamily) =>
      [...WALLET_POLICY_REGISTRY]
      .sort((first, second) => first.hardwareDiscoveryOrder - second.hardwareDiscoveryOrder)
        .map((policy) => ({
        path: buildCanonicalAccountPathForFamily({
          walletType: policy.walletType,
          scriptType: policy.scriptType,
          derivationFamily,
          account: 0,
        }),
        purpose: policy.accountPurpose,
        scriptType: policy.scriptType,
          name:
            derivationFamily === 'mainnet'
          ? policy.displayName
          : `Testnet-family ${policy.displayName}`,
        }))
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
    return this.getAllXpubsWithFailuresForLease(
      this.activeLease as HardwareWalletConnectionLease,
      onProgress,
    );
  }

  /** Fetch a complete standard-path batch while the exact lease owns the session queue. */
  getAllXpubsWithFailuresForLease(
    lease: HardwareWalletConnectionLease,
    onProgress?: (current: number, total: number, path: string) => void,
  ): Promise<XpubBatchResult> {
    return this.enqueueLeaseOperation(lease, async (assertOwnership) => {
      return this.fetchAllXpubsWithFailures(onProgress, assertOwnership);
    });
  }

  private async fetchAllXpubsWithFailures(
    onProgress: ((current: number, total: number, path: string) => void) | undefined,
    assertOwnership: () => void,
  ): Promise<XpubBatchResult> {
    const approved = await this.requireApprovedAdapter('account_add');
    assertOwnership();

    const results: StandardXpubResult[] = [];
    const failures: XpubFetchFailure[] = [];
    const paths = HardwareWalletService.STANDARD_PATHS;
    const connectedFingerprint = approved.fingerprint;

    for (let i = 0; i < paths.length; i++) {
      assertOwnership();
      const { path, purpose, scriptType, name } = paths[i];

      if (onProgress) {
        onProgress(i + 1, paths.length, name);
      }

      try {
        log.info(`Fetching xpub for ${name}`, { path });
        const { adapter } = await this.requireApprovedAdapter('account_add');
        assertOwnership();
        const xpubResult = await adapter.getXpub(path);
        assertOwnership();
        const validated = validateXpubResult(xpubResult, path, connectedFingerprint);
        results.push({ ...validated, purpose, scriptType });
        log.info(`Successfully fetched ${name}`, {
          fingerprint: validated.fingerprint,
        });
      } catch (error) {
        if (error instanceof HardwareWalletIdentityError || error instanceof HardwareWalletLeaseError) {
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
  signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    return this.signPSBTForLease(this.activeLease as HardwareWalletConnectionLease, request);
  }

  /** Sign only while the supplied lease owns the serialized session. */
  signPSBTForLease(
    lease: HardwareWalletConnectionLease,
    request: PSBTSignRequest,
  ): Promise<PSBTSignResponse> {
    return this.enqueueLeaseOperation(lease, async (assertOwnership) => {
      return this.performSignPSBT(request, assertOwnership);
    });
  }

  private async performSignPSBT(
    request: PSBTSignRequest,
    assertOwnership: () => void,
  ): Promise<PSBTSignResponse> {
    const { adapter, fingerprint } = await this.requireApprovedAdapter('sign');
    assertOwnership();
    validatePsbtSigningRequest(request, fingerprint);
    const result = await adapter.signPSBT(request);
    assertOwnership();
    if (!result.psbt && !result.rawTx) {
      throw new Error('Hardware signing did not produce an applicable signed PSBT or transaction');
    }
    if (request.signingContext?.walletType === 'multi_sig' && !result.psbt) {
      throw new Error('Multisig hardware signing did not produce an applicable signed PSBT');
    }
    return result;
  }

  /**
   * Verify an address on the device display
   * @param path Derivation path
   * @param address Address to verify
   */
  verifyAddress(path: string, address: string): Promise<boolean> {
    return this.verifyAddressForLease(
      this.activeLease as HardwareWalletConnectionLease,
      path,
      address,
    );
  }

  /** Verify only while the supplied lease owns the serialized session. */
  verifyAddressForLease(
    lease: HardwareWalletConnectionLease,
    path: string,
    address: string,
  ): Promise<boolean> {
    return this.enqueueLeaseOperation(lease, async (assertOwnership) => {
      return this.performVerifyAddress(path, address, assertOwnership);
    });
  }

  private async performVerifyAddress(
    path: string,
    address: string,
    assertOwnership: () => void,
  ): Promise<boolean> {
    const { adapter } = await this.requireApprovedAdapter('display');
    assertOwnership();
    if (!adapter.verifyAddress) {
      throw new Error(`${adapter.displayName} does not support address verification`);
    }
    const verified = await adapter.verifyAddress(path, address);
    assertOwnership();
    return verified;
  }

  /**
   * Full transaction signing flow
   * Creates PSBT, signs with device, and broadcasts
   */
  signTransaction(tx: TransactionForSigning): Promise<string> {
    return this.signTransactionForLease(
      this.activeLease as HardwareWalletConnectionLease,
      tx,
    );
  }

  /** Run the complete create/sign/broadcast flow under one connection lease. */
  signTransactionForLease(
    lease: HardwareWalletConnectionLease,
    tx: TransactionForSigning,
  ): Promise<string> {
    return this.enqueueLeaseOperation(lease, async (assertOwnership) => {
      const result = await this.performSignTransaction(tx, assertOwnership);
      assertOwnership();
      return result;
    });
  }

  private async performSignTransaction(
    tx: TransactionForSigning,
    assertOwnership: () => void,
  ): Promise<string> {

    // Create PSBT via backend
    const { psbt, signingContext, intentId, intentDigest } = await createPSBTForSigning(tx);
    assertOwnership();

    // Sign with connected device
    const signed = await this.performSignPSBT(
      {
        walletId: tx.walletId,
        psbt,
        signingContext,
      },
      assertOwnership,
    );
    if (!signed.psbt) {
      throw new Error('Hardware signer did not return a signed PSBT for this broadcast path');
    }

    // Raw-only hardware results are rejected by broadcastSignedTransaction.
    const result = await broadcastSignedTransaction(
      tx.walletId,
      signed.psbt,
      intentId,
      intentDigest,
      signed.rawTx
    );
    assertOwnership();

    return result.txid;
  }
}

/**
 * Create a PSBT for signing via the backend API
 */
async function createPSBTForSigning(
  tx: TransactionForSigning
): Promise<HardwarePsbtCreateResponse> {
  return apiClient.post<HardwarePsbtCreateResponse>(
    `/wallets/${tx.walletId}/psbt/create`,
    {
    recipients: [{ address: tx.recipient, amount: tx.amount }],
    feeRate: tx.feeRate,
    utxoIds: tx.utxos,
    changeAddress: tx.changeAddress,
    },
    { schema: HardwarePsbtCreateResponseSchema }
  );
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
      'Raw-only hardware broadcast is disabled until the adapter provides verifiable signing proof'
    );
  }
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/transactions/broadcast`,
    { signedPsbtBase64: psbt, intentId, intentDigest }
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
