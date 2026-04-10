import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded routes for code splitting
// These are loaded on-demand to reduce initial bundle size
const Dashboard = lazy(async () => ({ default: (await import('./components/Dashboard')).Dashboard }));
const WalletList = lazy(async () => ({ default: (await import('./components/WalletList')).WalletList }));
const WalletDetail = lazy(async () => ({ default: (await import('./components/WalletDetail')).WalletDetail }));
const SendTransactionPage = lazy(async () => ({ default: (await import('./components/send')).SendTransactionPage }));
const CreateWallet = lazy(async () => ({ default: (await import('./components/CreateWallet')).CreateWallet }));
const ImportWallet = lazy(async () => ({ default: (await import('./components/ImportWallet')).ImportWallet }));
const DeviceList = lazy(async () => ({ default: (await import('./components/DeviceList')).DeviceList }));
const DeviceDetail = lazy(async () => ({ default: (await import('./components/DeviceDetail')).DeviceDetail }));
const ConnectDevice = lazy(async () => ({ default: (await import('./components/ConnectDevice')).ConnectDevice }));
const Settings = lazy(async () => ({ default: (await import('./components/Settings')).Settings }));
const Account = lazy(async () => ({ default: (await import('./components/Account')).Account }));
const NodeConfig = lazy(async () => ({ default: (await import('./components/NodeConfig')).NodeConfig }));
const UsersGroups = lazy(async () => ({ default: (await import('./components/UsersGroups')).UsersGroups }));
const SystemSettings = lazy(async () => ({ default: (await import('./components/SystemSettings')).SystemSettings }));
const Variables = lazy(async () => ({ default: (await import('./components/Variables')).Variables }));
const BackupRestore = lazy(async () => ({ default: (await import('./components/BackupRestore')).BackupRestore }));
const AuditLogs = lazy(async () => ({ default: (await import('./components/AuditLogs')).AuditLogs }));
const AISettings = lazy(() => import('./components/AISettings'));
const Monitoring = lazy(() => import('./components/Monitoring'));
const FeatureFlags = lazy(async () => ({ default: (await import('./components/FeatureFlags')).FeatureFlags }));
const Intelligence = lazy(async () => ({ default: (await import('./components/Intelligence')).Intelligence }));
const AnimatedBackground = lazy(async () => ({ default: (await import('./components/AnimatedBackground')).AnimatedBackground }));
import { useUser } from './contexts/UserContext';
import { NotificationContainer } from './components/NotificationToast';
import { useNotifications } from './contexts/NotificationContext';
import { AppProviders } from './providers/AppProviders';
import { useWebSocketQueryInvalidation } from './hooks/websocket';
import * as authApi from './src/api/auth';
import { createLogger } from './utils/logger';
import { isAnimatedPattern } from './components/animatedPatterns';
import { DashboardSkeleton, WalletDetailSkeleton, ListSkeleton, SettingsSkeleton } from './components/ui/Skeleton';

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
        <Routes>
          {/* Core routes with page-specific skeletons */}
          <Route path="/" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Dashboard /></Suspense></ErrorBoundary>} />
          <Route path="/wallets" element={<ErrorBoundary><Suspense fallback={<ListSkeleton />}><WalletList /></Suspense></ErrorBoundary>} />
          <Route path="/wallets/:id" element={<ErrorBoundary><Suspense fallback={<WalletDetailSkeleton />}><WalletDetail /></Suspense></ErrorBoundary>} />

          {/* Lazy-loaded routes */}
          <Route path="/wallets/create" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><CreateWallet /></Suspense></ErrorBoundary>} />
          <Route path="/wallets/import" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><ImportWallet /></Suspense></ErrorBoundary>} />
          <Route path="/wallets/:id/send" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><SendTransactionPage /></Suspense></ErrorBoundary>} />
          <Route path="/devices" element={<ErrorBoundary><Suspense fallback={<ListSkeleton />}><DeviceList /></Suspense></ErrorBoundary>} />
          <Route path="/devices/connect" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><ConnectDevice /></Suspense></ErrorBoundary>} />
          <Route path="/devices/:id" element={<ErrorBoundary><Suspense fallback={<WalletDetailSkeleton />}><DeviceDetail /></Suspense></ErrorBoundary>} />
          <Route path="/account" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><Account /></Suspense></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><Settings /></Suspense></ErrorBoundary>} />
          <Route path="/intelligence" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Intelligence /></Suspense></ErrorBoundary>} />

          {/* Admin routes - lazy-loaded */}
          <Route path="/admin/node-config" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><NodeConfig /></Suspense></ErrorBoundary>} />
          <Route path="/admin/users-groups" element={<ErrorBoundary><Suspense fallback={<ListSkeleton />}><UsersGroups /></Suspense></ErrorBoundary>} />
          <Route path="/admin/settings" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><SystemSettings /></Suspense></ErrorBoundary>} />
          <Route path="/admin/variables" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><Variables /></Suspense></ErrorBoundary>} />
          <Route path="/admin/backup" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><BackupRestore /></Suspense></ErrorBoundary>} />
          <Route path="/admin/audit-logs" element={<ErrorBoundary><Suspense fallback={<ListSkeleton />}><AuditLogs /></Suspense></ErrorBoundary>} />
          <Route path="/admin/ai" element={<ErrorBoundary><Suspense fallback={<SettingsSkeleton />}><AISettings /></Suspense></ErrorBoundary>} />
          <Route path="/admin/monitoring" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Monitoring /></Suspense></ErrorBoundary>} />
          <Route path="/admin/feature-flags" element={<ErrorBoundary><Suspense fallback={<ListSkeleton />}><FeatureFlags /></Suspense></ErrorBoundary>} />
          <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
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
