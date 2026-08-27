/**
 * Sync Context Factory
 *
 * Creates and initializes the SyncContext for pipeline execution.
 */

import type { Address, Wallet } from '../../../generated/prisma/client';
import type { NodeClientInterface } from '../nodeClient';
import { addressToOutputScript } from '../utils';
import type { SyncContext, SyncStats, BitcoinNetwork } from './types';
import type { WalletSyncMutationFence } from '../../../repositories/types';
import type { SyncAttemptRuntime } from './attemptRuntime';

/**
 * Give one address row the ownership anchor the evidence phases require.
 *
 * Canonical rows carry a persisted `scriptPubKey`. Rows that predate the
 * canonical-evidence migrations carry none and no migration backfills them, so
 * derive the script from the stored address instead. The output script is a
 * pure function of the address, computed locally from data we already hold —
 * it introduces no remote input and asserts no canonical provenance. This
 * restores the pre-canonical ownership test (an output is ours when it pays an
 * address we hold) for wallets that never opted in, while canonical wallets
 * keep the strictly stronger descriptor-derived evidence untouched.
 *
 * Derived scripts stay context-local and are never persisted: writing one alone
 * would violate `addresses_canonical_coordinate_complete_check`, which demands
 * the whole coordinate set or none of it.
 */
function withOwnershipScript(address: Address, network: BitcoinNetwork): Address {
  if (address.scriptPubKey) return address;
  try {
    return {
      ...address,
      scriptPubKey: addressToOutputScript(address.address, network).toString('hex'),
    };
  } catch {
    // An address we cannot decode gets no anchor, so the evidence phases keep
    // failing it closed rather than guessing at ownership.
    return address;
  }
}

/**
 * Create initial empty sync stats
 */
export function createSyncStats(): SyncStats {
  return {
    historiesFetched: 0,
    transactionsProcessed: 0,
    newTransactionsCreated: 0,
    utxosFetched: 0,
    utxosCreated: 0,
    utxosMarkedSpent: 0,
    addressesUpdated: 0,
    newAddressesGenerated: 0,
    correctedConsolidations: 0,
  };
}

/**
 * Create a new SyncContext for pipeline execution
 */
export function createSyncContext(params: {
  walletId: string;
  wallet: Wallet;
  network: BitcoinNetwork;
  client: NodeClientInterface;
  addresses: Address[];
  currentBlockHeight: number;
  viaTor?: boolean;
  mutationFence?: WalletSyncMutationFence;
  attemptRuntime?: SyncAttemptRuntime;
}): SyncContext {
  const {
    walletId, wallet, network, client, currentBlockHeight, viaTor = false,
    mutationFence, attemptRuntime,
  } = params;
  const addresses = params.addresses.map(address => withOwnershipScript(address, network));

  // Build address lookup structures
  const walletAddressSet = new Set(addresses.map(a => a.address));
  const addressMap = new Map(addresses.map(a => [a.address, a]));
  const addressToDerivationPath = new Map<string, string>();
  const walletScriptToAddress = new Map<string, Address>();
  for (const addr of addresses) {
    if (addr.derivationPath) {
      addressToDerivationPath.set(addr.address, addr.derivationPath);
    }
    if (addr.scriptPubKey) {
      walletScriptToAddress.set(addr.scriptPubKey.toLowerCase(), addr);
    }
  }

  return {
    // Identifiers
    walletId,
    wallet,
    network,
    mutationFence,
    attemptRuntime,

    // Services
    client,

    // Input data
    addresses,
    walletAddressSet,
    addressMap,
    addressToDerivationPath,
    walletScriptToAddress,

    // Phase outputs (initialized empty)
    historyResults: new Map(),
    allTxids: new Set(),
    existingTxMap: new Map(),
    existingTxidSet: new Set(),
    classificationRepairTxids: new Set(),
    ioRepairTxids: new Set(),
    newTxids: [],
    txDetailsCache: new Map(),
    txHeightMap: new Map(),

    // UTXO phase data
    utxoResults: [],
    allUtxoKeys: new Set(),
    utxoDataMap: new Map(),
    authenticatedSpentOutpointKeys: new Set(),

    // Results
    newTransactions: [],
    newAddresses: [],

    // Tracking
    stats: createSyncStats(),
    startTime: Date.now(),
    currentBlockHeight,
    viaTor,

    // Phase tracking
    completedPhases: [],
    rejectedEvidenceCount: 0,
    rejectedEvidenceReasons: new Map(),
  };
}

/**
 * Create a minimal context for testing
 */
export function createTestContext(overrides: Partial<SyncContext>): SyncContext {
  const defaultContext: SyncContext = {
    walletId: 'test-wallet-id',
    wallet: { id: 'test-wallet-id', network: 'mainnet' } as Wallet,
    network: 'mainnet',
    client: {} as NodeClientInterface,
    addresses: [],
    walletAddressSet: new Set(),
    addressMap: new Map(),
    addressToDerivationPath: new Map(),
    walletScriptToAddress: new Map(),
    historyResults: new Map(),
    allTxids: new Set(),
    existingTxMap: new Map(),
    existingTxidSet: new Set(),
    classificationRepairTxids: new Set(),
    ioRepairTxids: new Set(),
    newTxids: [],
    txDetailsCache: new Map(),
    txHeightMap: new Map(),
    utxoResults: [],
    allUtxoKeys: new Set(),
    utxoDataMap: new Map(),
    authenticatedSpentOutpointKeys: new Set(),
    newTransactions: [],
    newAddresses: [],
    stats: createSyncStats(),
    startTime: Date.now(),
    currentBlockHeight: 800000,
    viaTor: false,
    completedPhases: [],
    rejectedEvidenceCount: 0,
    rejectedEvidenceReasons: new Map(),
  };

  return { ...defaultContext, ...overrides };
}
