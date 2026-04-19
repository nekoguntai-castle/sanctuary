import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import type { AppNotification } from '../../contexts/AppNotificationContext';
import { createLogger } from '../../utils/logger';

const log = createLogger('NotificationPanel');

interface UseNotificationPanelControllerParams {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}

export interface NotificationPanelController {
  panelRef: RefObject<HTMLDivElement | null>;
  notifications: AppNotification[];
  totalCount: number;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  handleNavigate: (url: string) => void;
}

export function useNotificationPanelController({
  isOpen,
  onClose,
  anchorRef,
}: UseNotificationPanelControllerParams): NotificationPanelController {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const { notifications, dismissNotification, clearAllNotifications, getTotalCount } =
    useAppNotifications();

  usePanelDismissal({ isOpen, onClose, anchorRef, panelRef });

  return {
    panelRef,
    notifications,
    totalCount: getTotalCount(),
    dismissNotification,
    clearAllNotifications,
    handleNavigate: (url) => {
      log.debug('Navigating to action URL', { url });
      onClose();
      setTimeout(() => {
        navigate(url, { state: { activeTab: 'drafts' } });
      }, 0);
    },
  };
}

function usePanelDismissal({
  isOpen,
  onClose,
  anchorRef,
  panelRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  useOutsideClickDismissal({ isOpen, onClose, anchorRef, panelRef });
  useEscapeDismissal({ isOpen, onClose });
}

function useOutsideClickDismissal({
  isOpen,
  onClose,
  anchorRef,
  panelRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose, anchorRef, panelRef]);
}

function useEscapeDismissal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);
}
