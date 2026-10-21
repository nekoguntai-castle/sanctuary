import { useRestoreWarningsHandoff } from '../../components/BackupRestore/hooks/useRestoreWarningsHandoff';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { Layout } from '../../components/Layout';
import { NotificationContainer } from '../../components/NotificationToast';
import { AnimatedBackgroundLayer } from './AnimatedBackgroundLayer';
import { AppRouteSwitch } from './AppRouteSwitch';
import type { AppRoutesController } from './types';

interface AuthenticatedAppShellProps {
  controller: AppRoutesController;
}

export function AuthenticatedAppShell({ controller }: AuthenticatedAppShellProps) {
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
