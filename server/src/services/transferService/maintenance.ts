/**
 * Transfer Maintenance
 *
 * Background maintenance functions for the transfer system.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';

const log = createLogger('TRANSFER');

/**
 * Expire old transfers (called by maintenance job)
 */
export async function expireOldTransfers(): Promise<number> {
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      status: { in: ['pending', 'accepted'] },
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'expired',
    },
  });

  if (result.count > 0) {
    log.info('Expired stale transfers', { count: result.count });
  }

  return result.count;
}
