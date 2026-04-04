/**
 * Audit Log Collector
 *
 * Collects recent audit log statistics: event counts by category and action,
 * and total failed events. Helps diagnose "I tried X and nothing happened"
 * by revealing whether the action was attempted and whether it succeeded.
 */

import { auditService } from '../../auditService';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('auditLog', async () => {
  try {
    const stats = await auditService.getStats(7);
    return {
      periodDays: 7,
      ...stats,
    };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
