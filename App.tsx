import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { appRedirectRoutes, appRouteDefinitions, renderAppRouteElement } from './src/app/appRoutes';
import { reloadCurrentDocument } from './src/app/browserNavigation';
import { useUser } from './contexts/UserContext';
import { NotificationContainer } from './components/NotificationToast';
import { useNotifications } from './contexts/NotificationContext';
import { AppProviders } from './providers/AppProviders';
import { useWebSocketQueryInvalidation } from './hooks/websocket';
import * as authApi from './src/api/auth';
import { createLogger } from './utils/logger';
import { isAnimatedBackgroundPattern } from './themes/patterns';

const AnimatedBackground = lazy(async () => ({ default: (await import('./components/AnimatedBackground')).AnimatedBackground }));
const log = createLogger('App');

const AppRoutes: React.FC = () => {
  const { isAuthenticated, logout, user, updatePreferences } = useUser();
  const { notifications, removeNotification } = useNotifications();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Invalidate React Query cache when WebSocket events are received
  // This ensures Dashboard pending transactions update immediately
  useWebSocketQueryInvalidation();

  // Check if user is using default password and show modal
  useEffect(() => {
    if (isAuthenticated && user?.usingDefaultPassword) {
      setShowPasswordModal(true);
    }
  }, [isAuthenticated, user?.usingDefaultPassword]);

  const handlePasswordChanged = async () => {
    // Refresh user data to clear the usingDefaultPassword flag
    try {
      await authApi.getCurrentUser();
      // The user context will be updated, and the modal will close
    } catch (error) {
      log.error('Failed to refresh user data', { error });
    }
    // Force a page reload to ensure all user data is fresh
    setShowPasswordModal(false);
    reloadCurrentDocument();
  };

  if (!isAuthenticated) {
    return <Login />;
  }

  const isDarkMode = user?.preferences?.darkMode || false;
  const toggleTheme = () => {
    updatePreferences({ darkMode: !isDarkMode });
  };

  const backgroundPattern = user?.preferences?.background || 'minimal';
  const patternOpacity = user?.preferences?.patternOpacity ?? 50;
  const shouldRenderAnimatedBackground = isAnimatedBackgroundPattern(backgroundPattern);

  return (
    <>
      {/* Animated background for special patterns like sakura-petals */}
      {shouldRenderAnimatedBackground && (
        <Suspense fallback={null}>
          <AnimatedBackground
            pattern={backgroundPattern}
            darkMode={isDarkMode}
            opacity={patternOpacity}
          />
        </Suspense>
      )}
      <Layout darkMode={isDarkMode} toggleTheme={toggleTheme} onLogout={logout}>
        <Routes>
          {appRouteDefinitions.map((route) => (
            <Route key={route.id} path={route.path} element={renderAppRouteElement(route)} />
          ))}
          {appRedirectRoutes.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={<Navigate to={route.to} replace={route.replace} />}
            />
          ))}
        </Routes>
      </Layout>
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />

      {/* Force password change modal for users with default password */}
      {showPasswordModal && <ChangePasswordModal onPasswordChanged={handlePasswordChanged} />}
    </>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </HashRouter>
  );
};

export default App;
