/**
 * Cross-process notification for Node Config and Electrum server changes.
 *
 * The process that serves an admin write resets its own node clients and pools;
 * this event tells every other process to do the same: workers listen in
 * ElectrumSubscriptionManager.start(), other API processes in
 * remoteElectrumConfigChanges.ts.
 */

import { createHash } from 'crypto';
import { getDistributedEventBus } from '../../infrastructure';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import type { SystemEvents } from '../../events/types';
import { createLogger, type Logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { isBitcoinNetwork } from './networks';
import type { NetworkType } from './electrumPool';

const log = createLogger('BITCOIN:SVC_ELECTRUM_CONFIG');

export const ELECTRUM_CONFIG_CHANGED_EVENT = 'system:electrumConfig.changed' as const;

export type ElectrumConfigChange = SystemEvents[typeof ELECTRUM_CONFIG_CHANGED_EVENT];

/**
 * Publish a committed config change. Best effort: the write has already
 * committed and the local process is already reset, so a publish failure is
 * logged and never fails the caller.
 */
export async function publishElectrumConfigChange(change: ElectrumConfigChange): Promise<void> {
  try {
    await getDistributedEventBus().emitAsync(ELECTRUM_CONFIG_CHANGED_EVENT, change);
  } catch (error) {
    log.error('Failed to publish Electrum config change', {
      scope: change.scope,
      network: change.network,
      error: getErrorMessage(error),
    });
  }
}

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
 * Pub/sub payloads cross a process boundary, so a process only applies an
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

/**
 * A serialized handler for config-change events: changes apply in arrival
 * order and never interleave; a malformed payload is dropped before the chain,
 * and a failed change is logged without rejecting it, so neither blocks later
 * changes. `logger` is the subscribing process's own.
 */
export function createElectrumConfigChangeHandler(
  deps: ElectrumConfigChangeDeps,
  logger: Logger,
): (change: unknown) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  return (change: unknown) => {
    if (!isElectrumConfigChange(change)) {
      logger.warn('Ignoring malformed Electrum config change', {
        scope: (change as { scope?: unknown } | null | undefined)?.scope,
      });
      return chain;
    }
    const { scope, network } = change;
    chain = chain
      .then(() => applyElectrumConfigChange(change, deps))
      .catch((error: unknown) => {
        logger.error('Failed to apply Electrum config change', {
          scope,
          network,
          error: getErrorMessage(error),
        });
      });
    return chain;
  };
}

/**
 * A digest of the stored Node Config and Electrum server settings that a
 * config change would apply. Health and capability columns, which probes
 * rewrite on their own, are left out. Null when the config cannot be read.
 */
export async function readElectrumConfigFingerprint(): Promise<string | null> {
  try {
    const config = await nodeConfigRepository.findDefaultWithServers();
    if (!config) return 'none';
    const { servers, createdAt: _createdAt, updatedAt: _updatedAt, ...settings } = config;
    const relevant = {
      settings,
      servers: servers.map(({ id, network, label, host, port, useSsl, priority, enabled, serverUsage }) => (
        { id, network, label, host, port, useSsl, priority, enabled, serverUsage }
      )),
    };
    return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
  } catch (error) {
    log.warn('Could not read the Electrum config fingerprint', { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Resync for a process that may have missed a config change (see the event
 * bus `onResync`). Reapplying is a full teardown of node clients and pools, so
 * it runs only when the stored config differs from the one this process last
 * applied; a Redis blip with no config edit costs one read. `prime()` records
 * the config in effect when the process subscribes.
 */
export function createElectrumConfigResync(
  handleChange: (change: ElectrumConfigChange) => Promise<void>,
  logger: Logger,
): { prime: () => Promise<void>; resync: () => Promise<void> } {
  let applied: string | null = null;
  return {
    prime: async () => {
      applied = await readElectrumConfigFingerprint();
    },
    resync: async () => {
      const current = await readElectrumConfigFingerprint();
      if (current !== null && current === applied) {
        logger.debug('Electrum config unchanged since last applied; nothing to resync');
        return;
      }
      logger.info('Electrum config may have changed while events were missed; reapplying');
      await handleChange({ scope: 'node-config', network: null });
      await handleChange({ scope: 'electrum-servers', network: null });
      applied = current;
    },
  };
}
