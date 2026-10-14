/**
 * Approval Notifications
 *
 * Dispatches notifications for approval workflow events.
 * Uses the existing notification channel registry pattern.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('VAULT_POLICY:SVC_APPROVAL_NOTIFY');

/**
 * Notify relevant users that an approval was resolved.
 */
export async function notifyApprovalResolved(
  walletId: string,
  draftId: string,
  resolution: 'approved' | 'rejected' | 'vetoed' | 'overridden',
  resolvedByUserId: string | null
): Promise<void> {
  log.debug('Sending approval resolved notification', { walletId, draftId, resolution });

  // For now, log the resolution. Full channel integration comes when
  // the notification channel interface is extended with approval-specific methods.
  log.info('Approval resolved', { walletId, draftId, resolution, resolvedByUserId });
}
