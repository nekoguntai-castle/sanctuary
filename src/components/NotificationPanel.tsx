/**
 * Notification Panel Component
 *
 * A dropdown/slide-out panel showing all app notifications.
 */

import { useRef } from 'react';
import type { RefObject } from 'react';
import { Bell } from 'lucide-react';
import { useAppNotifications } from '../contexts/AppNotificationContext';
import { NotificationPanelFrame } from './NotificationPanel/NotificationPanelFrame';
import {
  getBadgeColorClass,
  getHighestNotificationSeverity,
} from './NotificationPanel/notificationPanelHelpers';
import { useNotificationPanelController } from './NotificationPanel/useNotificationPanelController';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}

export function NotificationPanel({ isOpen, onClose, anchorRef }: NotificationPanelProps) {
  const controller = useNotificationPanelController({ isOpen, onClose, anchorRef });

  if (!isOpen) return null;

  return <NotificationPanelFrame controller={controller} onClose={onClose} />;
}

/**
 * Notification Bell Button with Panel
 *
 * A button with badge that opens the notification panel.
 */
export function NotificationBell() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { getTotalCount, isPanelOpen, togglePanel, closePanel, notifications } =
    useAppNotifications();
  const totalCount = getTotalCount();
  const severity = getHighestNotificationSeverity(notifications);
  const hasCritical = severity === 'critical';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={togglePanel}
        className="relative p-2 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {totalCount > 0 && (
          <span
            className={`
              absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center
              rounded-full text-[10px] font-bold text-white px-1
              ${getBadgeColorClass(severity)}
              ${hasCritical ? 'animate-pulse' : ''}
            `}
          >
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>
      <NotificationPanel
        isOpen={isPanelOpen}
        onClose={closePanel}
        anchorRef={buttonRef}
      />
    </div>
  );
}

export default NotificationPanel;
