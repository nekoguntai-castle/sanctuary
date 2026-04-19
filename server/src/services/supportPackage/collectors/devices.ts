/**
 * Devices Collector
 *
 * Aggregate hardware-wallet device inventory: counts by type and model,
 * sharing totals, and account/wallet association counts. No fingerprints,
 * xpubs, or labels — those are identifying.
 */

import { deviceRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('devices', async () => {
  try {
    const stats = await deviceRepository.getSupportStats();
    return stats as unknown as Record<string, unknown>;
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
