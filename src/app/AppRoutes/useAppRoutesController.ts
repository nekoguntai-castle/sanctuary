import { useEffect, useState } from 'react';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useUser } from '../../../contexts/UserContext';
import { useWebSocketQueryInvalidation } from '../../../hooks/websocket';
import * as authApi from '../../api/auth';
import { createLogger } from '../../../utils/logger';
import { reloadCurrentDocument } from '../browserNavigation';
import { getAppPreferenceState } from './preferences';
import type { AppRoutesController } from './types';

const log = createLogger('App');

export function useAppRoutesController(): AppRoutesController {
  const { isAuthenticated, logout, user, updatePreferences } = useUser();
  const { notifications, removeNotification } = useNotifications();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const preferences = getAppPreferenceState(user);

  useWebSocketQueryInvalidation();

  useEffect(() => {
    if (isAuthenticated && user?.usingDefaultPassword) {
      setShowPasswordModal(true);
    }
  }, [isAuthenticated, user?.usingDefaultPassword]);

  const handlePasswordChanged = async () => {
    try {
      await authApi.getCurrentUser();
    } catch (error) {
      log.error('Failed to refresh user data', { error });
    }

    setShowPasswordModal(false);
    reloadCurrentDocument();
  };

  const toggleTheme = () => {
    updatePreferences({ darkMode: !preferences.isDarkMode });
  };

  return {
    isAuthenticated,
    logout,
    notifications,
    removeNotification,
    preferences,
    showPasswordModal,
    handlePasswordChanged,
    toggleTheme,
  };
}
