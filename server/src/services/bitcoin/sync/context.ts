/**
 * Sync Context Factory
 *
 * Creates and initializes the SyncContext for pipeline execution.
 */

import type { Address, Wallet } from '../../../generated/prisma/client';
import type { NodeClientInterface } from '../nodeClient';
import type { SyncContext, SyncStats, BitcoinNetwork } from './types';

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
}): SyncContext {
  const { walletId, wallet, network, client, addresses, currentBlockHeight, viaTor = false } = params;

  // Build address lookup structures
  const walletAddressSet = new Set(addresses.map(a => a.address));
  const addressMap = new Map(addresses.map(a => [a.address, a]));
  const addressToDerivationPath = new Map<string, string>();
  for (const addr of addresses) {
    if (addr.derivationPath) {
      addressToDerivationPath.set(addr.address, addr.derivationPath);
    }
  }

  return {
    // Identifiers
    walletId,
    wallet,
    network,

    // Services
    client,

    // Input data
    addresses,
    walletAddressSet,
    addressMap,
    addressToDerivationPath,

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
    successfullyFetchedAddresses: new Set(),
    allUtxoKeys: new Set(),
    utxoDataMap: new Map(),

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
    successfullyFetchedAddresses: new Set(),
    allUtxoKeys: new Set(),
    utxoDataMap: new Map(),
    newTransactions: [],
    newAddresses: [],
    stats: createSyncStats(),
    startTime: Date.now(),
    currentBlockHeight: 800000,
    viaTor: false,
    completedPhases: [],
  };

  return { ...defaultContext, ...overrides };
}
