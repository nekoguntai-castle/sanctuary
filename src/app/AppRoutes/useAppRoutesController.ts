import { useEffect } from 'react';
import { useNotifications } from '../../contexts/NotificationContext';
import { useUser } from '../../contexts/UserContext';
import { useWebSocketQueryInvalidation } from '../../hooks/websocket';
import { websocketClient } from '../../services/websocket';
import * as authApi from '../../api/auth';
import { createLogger } from '../../utils/logger';
import { reloadCurrentDocument } from '../browserNavigation';
import { getAppPreferenceState } from './preferences';
import type { AppRoutesController } from './types';

const log = createLogger('App');

export function useAppRoutesController(): AppRoutesController {
  const { isAuthenticated, isLoading, logout, user, updatePreferences } = useUser();
  const { notifications, removeNotification } = useNotifications();
  // Derived, not stored: a stored flag outlives the session that set it, so the
  // next user to log in on this tab would inherit the forced modal.
  const showPasswordModal = isAuthenticated && user?.usingDefaultPassword === true;
  const preferences = getAppPreferenceState(user);

  useWebSocketQueryInvalidation();

  // Live updates follow the session: logout disconnects the socket, so each
  // login (whichever page it lands on) connects a fresh one.
  useEffect(() => {
    if (isAuthenticated) websocketClient.connect();
  }, [isAuthenticated]);

  const handlePasswordChanged = async () => {
    try {
      await authApi.getCurrentUser();
    } catch (error) {
      log.error('Failed to refresh user data', { error });
    }

    // The reload re-runs the session bootstrap, which clears the modal.
    reloadCurrentDocument();
  };

  const toggleTheme = () => {
    updatePreferences({ darkMode: !preferences.isDarkMode });
  };

  return {
    isAuthenticated,
    isLoading,
    logout,
    notifications,
    removeNotification,
    preferences,
    showPasswordModal,
    handlePasswordChanged,
    toggleTheme,
  };
}
