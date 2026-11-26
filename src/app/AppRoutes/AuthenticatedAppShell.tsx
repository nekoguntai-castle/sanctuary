import { useEffect } from 'react';
import { useRestoreWarningsHandoff } from '../../components/BackupRestore/hooks/useRestoreWarningsHandoff';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { Layout } from '../../components/Layout';
import { NotificationContainer } from '../../components/NotificationToast';
import { useWebSocketQueryInvalidation } from '../../hooks/websocket';
import { websocketClient } from '../../services/websocket';
import { AnimatedBackgroundLayer } from './AnimatedBackgroundLayer';
import { AppRouteSwitch } from './AppRouteSwitch';
import type { AppRoutesController } from './types';

interface AuthenticatedAppShellProps {
  controller: AppRoutesController;
}

export function AuthenticatedAppShell({ controller }: AuthenticatedAppShellProps) {
  useWebSocketQueryInvalidation();

  // Live updates follow the authenticated shell: logout unmounts this shell
  // and disconnects the socket, so each login connects a fresh one without
  // opening an unauthenticated socket on /login or /verify-email.
  useEffect(() => {
    websocketClient.connect();
  }, []);

  useRestoreWarningsHandoff();

  return (
    <>
      <AnimatedBackgroundLayer preferences={controller.preferences} />
      <Layout
        darkMode={controller.preferences.isDarkMode}
        toggleTheme={controller.toggleTheme}
        onLogout={controller.logout}
      >
        <AppRouteSwitch />
      </Layout>
      <NotificationContainer
        notifications={controller.notifications}
        onDismiss={controller.removeNotification}
      />
      {controller.showPasswordModal && (
        <ChangePasswordModal onPasswordChanged={controller.handlePasswordChanged} />
      )}
    </>
  );
}
