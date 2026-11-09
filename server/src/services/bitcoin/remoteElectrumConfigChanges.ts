/**
 * Apply Node Config / Electrum server changes made by *other* processes to
 * this API process. The process that served the admin write has already reset
 * itself, so only remote events are applied (`onRemote`), never the local echo.
 * Subscriptions are owned by the worker, so there is nothing to reconnect here.
 */

import { getDistributedEventBus } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { resetNodeClient } from './nodeClient';
import { reloadElectrumServers } from './electrumPool';
import {
  ELECTRUM_CONFIG_CHANGED_EVENT,
  createElectrumConfigChangeHandler,
} from './electrumConfigChanges';

const log = createLogger('BITCOIN:SVC_REMOTE_ELECTRUM_CONFIG');

let unsubscribe: (() => void) | null = null;

/** Call after Redis is initialized. Idempotent. */
export function startRemoteElectrumConfigChanges(): void {
  if (unsubscribe) return;
  unsubscribe = getDistributedEventBus().onRemote(
    ELECTRUM_CONFIG_CHANGED_EVENT,
    createElectrumConfigChangeHandler({
      resetNodeClient,
      reloadElectrumServers,
      reconnectSubscriptions: () => undefined,
    }, log),
  );
}

export function stopRemoteElectrumConfigChanges(): void {
  unsubscribe?.();
  unsubscribe = null;
}
