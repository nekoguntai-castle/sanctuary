/**
 * Cross-process notification for Node Config and Electrum server changes.
 *
 * The API process resets its own node clients and pools after an admin write;
 * this event tells every worker process to do the same (the worker listens in
 * ElectrumSubscriptionManager.start()).
 */

import { getDistributedEventBus } from '../../infrastructure';
import type { SystemEvents } from '../../events/types';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

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
