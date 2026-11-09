/**
 * Apply Node Config / Electrum server changes made by *other* processes to
 * this API process. The process that served the admin write has already reset
 * itself, so only remote events are applied (`onRemote`), never the local echo.
 * Subscriptions are owned by the worker, so there is nothing to reconnect here.
 * A possibly missed change (see `onResync`) reapplies the whole config if the
 * stored config differs from the one in effect.
 */

import { getDistributedEventBus } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { resetNodeClient } from './nodeClient';
import { reloadElectrumServers } from './electrumPool';
import {
  ELECTRUM_CONFIG_CHANGED_EVENT,
  createElectrumConfigChangeHandler,
  createElectrumConfigResync,
} from './electrumConfigChanges';

const log = createLogger('BITCOIN:SVC_REMOTE_ELECTRUM_CONFIG');

let unsubscribers: Array<() => void> | null = null;

/** Call after Redis is initialized. Idempotent. */
export function startRemoteElectrumConfigChanges(): void {
  if (unsubscribers) return;
  const bus = getDistributedEventBus();
  const handleChange = createElectrumConfigChangeHandler({
    resetNodeClient,
    reloadElectrumServers,
    reconnectSubscriptions: () => undefined,
  }, log);
  const resync = createElectrumConfigResync(handleChange, log);
  void resync.prime();
  unsubscribers = [
    bus.onRemote(ELECTRUM_CONFIG_CHANGED_EVENT, handleChange),
    bus.onResync(resync.resync),
  ];
}

export function stopRemoteElectrumConfigChanges(): void {
  for (const unsubscribe of unsubscribers ?? []) unsubscribe();
  unsubscribers = null;
}
