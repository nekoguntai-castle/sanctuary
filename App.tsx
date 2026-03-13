import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { ChangePasswordModal } from './components/ChangePasswordModal';

// Lazy-loaded routes for code splitting
// These are loaded on-demand to reduce initial bundle size
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const WalletList = lazy(() => import('./components/WalletList').then(m => ({ default: m.WalletList })));
const WalletDetail = lazy(() => import('./components/WalletDetail').then(m => ({ default: m.WalletDetail })));
const SendTransactionPage = lazy(() => import('./components/send').then(m => ({ default: m.SendTransactionPage })));
const CreateWallet = lazy(() => import('./components/CreateWallet').then(m => ({ default: m.CreateWallet })));
const ImportWallet = lazy(() => import('./components/ImportWallet').then(m => ({ default: m.ImportWallet })));
const DeviceList = lazy(() => import('./components/DeviceList').then(m => ({ default: m.DeviceList })));
const DeviceDetail = lazy(() => import('./components/DeviceDetail').then(m => ({ default: m.DeviceDetail })));
const ConnectDevice = lazy(() => import('./components/ConnectDevice').then(m => ({ default: m.ConnectDevice })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const Account = lazy(() => import('./components/Account').then(m => ({ default: m.Account })));
const NodeConfig = lazy(() => import('./components/NodeConfig').then(m => ({ default: m.NodeConfig })));
const UsersGroups = lazy(() => import('./components/UsersGroups').then(m => ({ default: m.UsersGroups })));
const SystemSettings = lazy(() => import('./components/SystemSettings').then(m => ({ default: m.SystemSettings })));
const Variables = lazy(() => import('./components/Variables').then(m => ({ default: m.Variables })));
const BackupRestore = lazy(() => import('./components/BackupRestore').then(m => ({ default: m.BackupRestore })));
const AuditLogs = lazy(() => import('./components/AuditLogs').then(m => ({ default: m.AuditLogs })));
const AISettings = lazy(() => import('./components/AISettings'));
const Monitoring = lazy(() => import('./components/Monitoring'));
const FeatureFlags = lazy(() => import('./components/FeatureFlags').then(m => ({ default: m.FeatureFlags })));
const AnimatedBackground = lazy(() => import('./components/AnimatedBackground').then(m => ({ default: m.AnimatedBackground })));
import { CurrencyProvider } from './contexts/CurrencyContext';
import { UserProvider, useUser } from './contexts/UserContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { AppNotificationProvider } from './contexts/AppNotificationContext';
import { SidebarProvider } from './contexts/SidebarContext';
import { NotificationContainer } from './components/NotificationToast';
import { useNotifications } from './contexts/NotificationContext';
import { QueryProvider } from './providers/QueryProvider';
import { useWebSocketQueryInvalidation } from './hooks/websocket';
import * as authApi from './src/api/auth';
import { createLogger } from './utils/logger';
import { isAnimatedPattern } from './components/animatedPatterns';

const log = createLogger('App');

// Loading fallback for lazy-loaded routes
const RouteLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400" />
  </div>
);

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
    window.location.reload();
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
  const shouldRenderAnimatedBackground = isAnimatedPattern(backgroundPattern);

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
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Core routes */}
            <Route path="/" element={<Dashboard />} />
            <Route path="/wallets" element={<WalletList />} />
            <Route path="/wallets/:id" element={<WalletDetail />} />

            {/* Lazy-loaded routes - loaded on-demand */}
            <Route path="/wallets/create" element={<CreateWallet />} />
            <Route path="/wallets/import" element={<ImportWallet />} />
            <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
            <Route path="/devices" element={<DeviceList />} />
            <Route path="/devices/connect" element={<ConnectDevice />} />
            <Route path="/devices/:id" element={<DeviceDetail />} />
            <Route path="/account" element={<Account />} />
            <Route path="/settings" element={<Settings />} />

            {/* Admin routes - lazy-loaded */}
            <Route path="/admin/node-config" element={<NodeConfig />} />
            <Route path="/admin/users-groups" element={<UsersGroups />} />
            <Route path="/admin/settings" element={<SystemSettings />} />
            <Route path="/admin/variables" element={<Variables />} />
            <Route path="/admin/backup" element={<BackupRestore />} />
            <Route path="/admin/audit-logs" element={<AuditLogs />} />
            <Route path="/admin/ai" element={<AISettings />} />
            <Route path="/admin/monitoring" element={<Monitoring />} />
            <Route path="/admin/feature-flags" element={<FeatureFlags />} />
            <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
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
      <QueryProvider>
        <UserProvider>
          <CurrencyProvider>
            <NotificationProvider>
              <AppNotificationProvider>
                <SidebarProvider>
                  <AppRoutes />
                </SidebarProvider>
              </AppNotificationProvider>
            </NotificationProvider>
          </CurrencyProvider>
        </UserProvider>
      </QueryProvider>
    </HashRouter>
  );
};

export default App;
