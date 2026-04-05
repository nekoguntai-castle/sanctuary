import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, Menu, AlertTriangle } from 'lucide-react';
import { SanctuaryLogo } from '../ui/CustomIcons';
import { useUser } from '../../contexts/UserContext';
import { getDrafts } from '../../src/api/drafts';
import { useWallets } from '../../hooks/queries/useWallets';
import { useDevices } from '../../hooks/queries/useDevices';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as adminApi from '../../src/api/admin';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import { SidebarContent } from './SidebarContent';
import { AboutModal } from './AboutModal';
import { LayoutProps, ExpandedState } from './types';
import { useIntelligenceStatus } from '../../hooks/useIntelligenceStatus';

const log = createLogger('Layout');

export const Layout: React.FC<LayoutProps> = ({ children, darkMode, toggleTheme }) => {
  const { user, logout } = useUser();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { getWalletCount, getDeviceCount, addNotification, removeNotificationsByType } = useAppNotifications();

  // Auto-expand sections based on current route
  const getExpandedState = (pathname: string): ExpandedState => {
    // Check if viewing a specific wallet (not just /wallets list)
    const isInWalletDetail = pathname.match(/^\/wallets\/[^/]+/);
    // Check if viewing a specific device (not just /devices list)
    const isInDeviceDetail = pathname.match(/^\/devices\/[^/]+/);
    // Check if viewing any admin subpage
    const isInAdmin = pathname.startsWith('/admin/');

    return {
      wallets: !!isInWalletDetail,
      devices: !!isInDeviceDetail,
      admin: isInAdmin,
    };
  };

  const [expanded, setExpanded] = useState<ExpandedState>(() => getExpandedState(location.pathname));

  // Version modal state
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Update expanded state when route changes
  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  // Data for Sidebar - using React Query for automatic updates
  const { data: wallets = [] } = useWallets();
  const { data: devices = [] } = useDevices();

  // Treasury Intelligence availability check
  const { available: intelligenceAvailable } = useIntelligenceStatus();

  // Handle version click
  const handleVersionClick = async () => {
    setShowVersionModal(true);
    if (!versionInfo) {
      setVersionLoading(true);
      try {
        const info = await adminApi.checkVersion();
        setVersionInfo(info);
      } catch (error) {
        logError(log, error, 'Failed to check version');
        // Non-critical - version check failure doesn't affect functionality
      } finally {
        setVersionLoading(false);
      }
    }
  };

  // Copy address to clipboard
  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(type);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (error) {
      logError(log, error, 'Failed to copy to clipboard');
      // User will notice the copy feedback didn't appear
    }
  };

  // Fetch drafts for notifications when wallets change
  useEffect(() => {
    if (!user || wallets.length === 0) return;

    const fetchDrafts = async () => {
      for (const wallet of wallets) {
        try {
          const drafts = await getDrafts(wallet.id);
          if (drafts.length > 0) {
            addNotification({
              type: 'pending_drafts',
              scope: 'wallet',
              scopeId: wallet.id,
              severity: 'warning',
              title: `${drafts.length} pending draft${drafts.length > 1 ? 's' : ''}`,
              message: `${wallet.name}: Resume or broadcast`,
              count: drafts.length,
              actionUrl: `/wallets/${wallet.id}`,
              actionLabel: 'View Drafts',
              dismissible: true,
              persistent: false,
            });
          } else {
            removeNotificationsByType('pending_drafts', wallet.id);
          }
        } catch (err) {
          logError(log, err, 'Failed to fetch drafts for wallet', {
            context: { walletId: wallet.id },
          });
          // Non-critical - continue with other wallets
        }
      }
    };

    fetchDrafts();
  }, [user, wallets]);

  // Check Electrum/Bitcoin connection status periodically
  useEffect(() => {
    if (!user) return;

    const isAdmin = user.isAdmin;

    const checkConnection = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (status.connected) {
          // Connection is good - remove any existing error notification
          removeNotificationsByType('connection_error');
        } else {
          // Connection failed - not dismissible until resolved
          addNotification({
            type: 'connection_error',
            scope: 'global',
            severity: 'critical',
            title: 'Electrum server unreachable',
            message: status.error || 'Unable to connect to blockchain. Wallet data may be outdated.',
            // Only show admin action if user is admin
            ...(isAdmin && {
              actionUrl: '/admin/node',
              actionLabel: 'Configure Node',
            }),
            dismissible: false,
            persistent: false,
          });
        }
      } catch (error) {
        // API call itself failed - likely server issue
        addNotification({
          type: 'connection_error',
          scope: 'global',
          severity: 'critical',
          title: 'Connection error',
          message: 'Unable to check blockchain status. Server may be unavailable.',
          // Only show admin action if user is admin
          ...(isAdmin && {
            actionUrl: '/admin/node',
            actionLabel: 'Configure Node',
          }),
          dismissible: false,
          persistent: false,
        });
      }
    };

    // Check immediately on mount
    checkConnection();

    // Check every 60 seconds
    const interval = setInterval(checkConnection, 60000);

    return () => clearInterval(interval);
  }, [user, addNotification, removeNotificationsByType]);

  const toggleSection = (section: 'wallets' | 'devices' | 'admin') => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const sidebarContent = (
    <SidebarContent
      user={user}
      wallets={wallets}
      devices={devices}
      expanded={expanded}
      darkMode={darkMode}
      toggleTheme={toggleTheme}
      toggleSection={toggleSection}
      logout={logout}
      getWalletCount={getWalletCount}
      getDeviceCount={getDeviceCount}
      onVersionClick={handleVersionClick}
      intelligenceAvailable={intelligenceAvailable}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden text-sanctuary-900 dark:text-sanctuary-100 transition-colors duration-500 noise-overlay">

      {/* Sidebar Desktop - Uses Sanctuary 900 which is now correctly defined as Dark Gray in index.html */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col h-0 flex-1 border-r border-sanctuary-200 dark:border-sanctuary-800 surface-elevated">
            {sidebarContent}
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="flex flex-col flex-1 w-0 overflow-hidden bg-transparent">
        <div className="md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 surface-elevated border-b border-sanctuary-200 dark:border-sanctuary-800 flex justify-between items-center px-4 h-16">
            <div className="flex items-center">
              <SanctuaryLogo className="h-6 w-6 text-primary-700 dark:text-primary-500 mr-2" />
              <span className="text-lg font-semibold tracking-tight text-sanctuary-800 dark:text-sanctuary-200">Sanctuary</span>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 transition-colors"
            >
              <span className="sr-only">Open sidebar</span>
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
            <div className="relative flex-1 flex flex-col max-w-xs w-full surface-elevated">
               {sidebarContent}
            </div>
          </div>
        )}

        <main className="flex-1 relative overflow-y-auto focus:outline-none content-atmosphere">
          {/* Default Password Warning Banner - only for admin user */}
          {user?.isAdmin && user?.usingDefaultPassword && (
            <div className="bg-amber-500 dark:bg-amber-600">
              <div className="max-w-7xl mx-auto py-2 px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between flex-wrap">
                  <div className="flex-1 flex items-center">
                    <span className="flex p-1 rounded-lg bg-amber-600 dark:bg-amber-700">
                      <AlertTriangle className="h-5 w-5 text-white" />
                    </span>
                    <p className="ml-3 font-medium text-white text-sm">
                      <span>Security Warning: You are using the default password.</span>
                      <Link
                        to="/account"
                        className="ml-2 underline hover:text-amber-100 font-semibold"
                      >
                        Change it now →
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="py-8 px-4 sm:px-6 md:px-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Version Info Modal */}
      <AboutModal
        show={showVersionModal}
        onClose={() => setShowVersionModal(false)}
        versionInfo={versionInfo}
        versionLoading={versionLoading}
        copiedAddress={copiedAddress}
        onCopyAddress={copyToClipboard}
      />
    </div>
  );
};
