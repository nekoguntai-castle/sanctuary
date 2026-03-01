/**
 * Electrum Client Module
 *
 * Barrel file that re-exports the public API. External importers that
 * previously imported from `services/bitcoin/electrum` (the single file)
 * will now resolve to this directory's index.ts with the same exports.
 */

import { ElectrumClient } from './electrumClient';

export { ElectrumClient } from './electrumClient';
export default ElectrumClient;

// Re-export types that are part of the public API
export type {
  ScriptPubKey,
  PrevOut,
  TransactionInput,
  TransactionOutput,
  TransactionDetails,
  ElectrumConfig,
  ProxyConfig,
  BitcoinNetwork,
} from './types';

// ==============================================================================
// NETWORK-KEYED CLIENT REGISTRY
// ==============================================================================

// Network-keyed client registry (replaces singleton pattern)
const electrumClients = new Map<string, ElectrumClient>();

/**
 * Get Electrum client instance for a specific network
 * @param network Bitcoin network (mainnet, testnet, signet, or regtest)
 *
 * Note: The client is created without explicitConfig, so connect() will load
 * per-network config from the database.
 */
export function getElectrumClientForNetwork(network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): ElectrumClient {
  if (!electrumClients.has(network)) {
    // Create client without explicitConfig - connect() will load per-network config from database
    const client = new ElectrumClient();
    client.setNetwork(network);
    electrumClients.set(network, client);
  }
  return electrumClients.get(network)!;
}

/**
 * Get Electrum client instance (backward compatibility - defaults to mainnet)
 */
export function getElectrumClient(): ElectrumClient {
  return getElectrumClientForNetwork('mainnet');
}

/**
 * Close Electrum connection for a specific network
 */
export function closeElectrumClientForNetwork(network: 'mainnet' | 'testnet' | 'signet' | 'regtest'): void {
  const client = electrumClients.get(network);
  if (client) {
    client.disconnect();
    electrumClients.delete(network);
  }
}

/**
 * Close Electrum connection (backward compatibility - closes mainnet)
 */
export function closeElectrumClient(): void {
  closeElectrumClientForNetwork('mainnet');
}

/**
 * Close all Electrum connections
 */
export function closeAllElectrumClients(): void {
  for (const [_network, client] of electrumClients.entries()) {
    client.disconnect();
  }
  electrumClients.clear();
}

/**
 * Reset Electrum client (alias for closeElectrumClient)
 */
export function resetElectrumClient(): void {
  closeElectrumClient();
}
