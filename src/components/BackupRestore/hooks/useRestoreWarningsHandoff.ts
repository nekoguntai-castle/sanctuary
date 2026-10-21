/**
 * Shows restore warnings stashed before the post-restore forced logout.
 *
 * Mounted from the authenticated shell, so the effect runs on each login. The
 * shell is already mounted when a restore stashes its warnings and the deps do
 * not change until a different login, so the pre-logout session never consumes
 * the hand-off. Warnings name users: only an admin sees them; anyone else
 * discards them.
 */

import { useEffect } from 'react';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { useUser } from '../../../contexts/UserContext';
import { restoreWarningNotification, takeRestoreWarnings } from './restoreWarningsHandoff';

export function useRestoreWarningsHandoff(): void {
  const { isAuthenticated, user } = useUser();
  const { addNotification } = useAppNotifications();
  const userId = user?.id;
  const isAdmin = user?.isAdmin === true;

  useEffect(() => {
    if (!isAuthenticated) return;
    const handoff = takeRestoreWarnings();
    if (!handoff || !isAdmin) return;
    handoff.warnings.forEach((warning, index) => {
      addNotification(restoreWarningNotification(handoff, warning, index));
    });
  }, [isAuthenticated, userId, isAdmin, addNotification]);
}
