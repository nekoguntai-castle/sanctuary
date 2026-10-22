/**
 * Apply a Node Config / Electrum server change published by the API process.
 */

import type { NetworkType } from '../../services/bitcoin/electrumPool';
import { isBitcoinNetwork } from '../../services/bitcoin/networks';
import type { ElectrumConfigChange } from '../../services/bitcoin/electrumConfigChanges';

export interface ElectrumConfigChangeDeps {
  resetNodeClient: (network?: NetworkType) => Promise<void>;
  reloadElectrumServers: (network?: NetworkType) => Promise<void>;
  reconnectSubscriptions: (network?: NetworkType) => void;
}

const ELECTRUM_CONFIG_CHANGE_SCOPES: ReadonlySet<unknown> = new Set<ElectrumConfigChange['scope']>([
  'node-config',
  'electrum-servers',
]);

/**
 * Pub/sub payloads cross a process boundary, so the worker only applies an
 * object carrying a scope it knows.
 */
export function isElectrumConfigChange(value: unknown): value is ElectrumConfigChange {
  return typeof value === 'object'
    && value !== null
    && ELECTRUM_CONFIG_CHANGE_SCOPES.has((value as { scope?: unknown }).scope);
}

/**
 * Electrum server list edits reload the named pool and leave subscriptions
 * alone, because the subscription client reads node_config only. A node-config
 * change resets the named network's node client and reconnects its owned
 * subscription. A missing or unknown network means every network.
 */
export async function applyElectrumConfigChange(
  change: ElectrumConfigChange,
  deps: ElectrumConfigChangeDeps,
): Promise<void> {
  const network = isBitcoinNetwork(change.network) ? change.network : undefined;
  if (change.scope === 'electrum-servers') {
    await deps.reloadElectrumServers(network);
    return;
  }
  await deps.resetNodeClient(network);
  deps.reconnectSubscriptions(network);
}
