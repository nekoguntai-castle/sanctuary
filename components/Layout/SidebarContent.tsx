import React from 'react';
import {
  LayoutDashboard,
  Wallet as WalletIcon,
  Settings,
  LogOut,
  Moon,
  Sun,
  Cpu,
  Users,
  UserCircle,
  Server,
  Shield,
  Cog,
  Database,
  FileText,
  Brain,
  Activity,
  ToggleLeft,
} from 'lucide-react';
import { SanctuaryLogo, getWalletIcon, getDeviceIcon } from '../ui/CustomIcons';
import { WalletType, isMultisigType } from '../../types';
import { Wallet as ApiWallet } from '../../src/api/wallets';
import { Device as ApiDevice } from '../../src/api/devices';
import { version } from '../../package.json';
import { NotificationBell } from '../NotificationPanel';
import { NavItem } from './NavItem';
import { SubNavItem } from './SubNavItem';
import { ExpandedState } from './types';
import { EmptyState } from '../ui/EmptyState';
import { BlockHeightIndicator } from './BlockHeightIndicator';

interface SidebarContentProps {
  user: { username: string; isAdmin?: boolean } | null;
  wallets: ApiWallet[];
  devices: ApiDevice[];
  expanded: ExpandedState;
  darkMode: boolean;
  toggleTheme: () => void;
  toggleSection: (section: 'wallets' | 'devices' | 'admin') => void;
  logout: () => void;
  getWalletCount: (walletId: string) => number;
  getDeviceCount: (deviceId: string) => number;
  onVersionClick: () => void;
  intelligenceAvailable?: boolean;
}

export const SidebarContent: React.FC<SidebarContentProps> = ({
  user,
  wallets,
  devices,
  expanded,
  darkMode,
  toggleTheme,
  toggleSection,
  logout,
  getWalletCount,
  getDeviceCount,
  onVersionClick,
  intelligenceAvailable,
}) => {
  return (
    <>
      <div className="flex items-center h-20 flex-shrink-0 px-6 border-b border-sanctuary-200 dark:border-sanctuary-800">
        <SanctuaryLogo className="h-8 w-8 text-primary-700 dark:text-primary-500 mr-3" />
        <span className="text-xl font-semibold tracking-tight text-sanctuary-800 dark:text-sanctuary-200">Sanctuary</span>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" />

        {intelligenceAvailable && (
          <NavItem to="/intelligence" icon={Brain} label="Intelligence" />
        )}

        {/* Wallets Section */}
        <div className="pt-5 pb-1.5">
          <div className="px-4 text-[9px] font-semibold text-sanctuary-400 dark:text-sanctuary-500 uppercase tracking-[0.15em]">
            Wallets
          </div>
        </div>
        <div className="space-y-1">
          <NavItem
            to="/wallets"
            icon={WalletIcon}
            label="Wallets"
            hasSubmenu
            isOpen={expanded.wallets}
            onToggle={() => toggleSection('wallets')}
          />
          {expanded.wallets && (
            <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
              {wallets.length === 0 && (
                 <EmptyState compact title="No wallets created" actionLabel="Create wallet" actionTo="/wallets/create" />
              )}
              {[...wallets].sort((a, b) => a.name.localeCompare(b.name)).map(w => {
                const isMultisig = isMultisigType(w.type);
                const walletType = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;
                // Use semantic colors (success/warning) to respect theme settings
                const activeColor = isMultisig ? 'text-warning-700 dark:text-warning-400' : 'text-success-700 dark:text-success-400';
                const walletNotifCount = getWalletCount(w.id);
                const syncStatus = w.syncInProgress ? 'syncing' as const
                  : w.lastSyncStatus === 'success' ? 'synced' as const
                  : w.lastSyncStatus === 'failed' ? 'error' as const
                  : 'pending' as const;
                return (
                  <SubNavItem
                    key={w.id}
                    to={`/wallets/${w.id}`}
                    label={w.name}
                    icon={getWalletIcon(walletType, `w-3 h-3 ${isMultisig ? 'text-warning-500' : 'text-success-500'}`)}
                    activeColorClass={activeColor}
                    badgeCount={walletNotifCount}
                    badgeSeverity="warning"
                    statusDot={syncStatus}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Devices Section */}
        <div className="pt-4 pb-1.5">
          <div className="px-4 text-[9px] font-semibold text-sanctuary-400 dark:text-sanctuary-500 uppercase tracking-[0.15em]">
            Hardware
          </div>
        </div>
        <div className="space-y-1">
           <NavItem
              to="/devices"
              icon={Cpu}
              label="Devices"
              hasSubmenu
              isOpen={expanded.devices}
              onToggle={() => toggleSection('devices')}
            />
            {expanded.devices && (
              <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
                 {devices.length === 0 && (
                    <EmptyState compact title="No devices connected" actionLabel="Connect device" actionTo="/devices/connect" />
                 )}
                 {[...devices].sort((a, b) => a.label.localeCompare(b.label)).map(d => {
                   const deviceNotifCount = getDeviceCount(d.id);
                   return (
                     <SubNavItem
                       key={d.id}
                       to={`/devices/${d.id}`}
                       label={d.label}
                       icon={getDeviceIcon(d.type, "w-3 h-3 text-sanctuary-400")}
                       badgeCount={deviceNotifCount}
                       badgeSeverity="warning"
                     />
                   );
                 })}
              </div>
            )}
        </div>

        <div className="pt-6 pb-2">
          <div className="px-4 text-xs font-semibold text-sanctuary-400 uppercase tracking-wider">
            System
          </div>
        </div>
        <NavItem to="/account" icon={UserCircle} label="Account" />
        {user?.isAdmin && (
          <div className="space-y-1 pt-2">
            <NavItem
              to="/admin"
              icon={Shield}
              label="Administration"
              hasSubmenu
              isOpen={expanded.admin}
              onToggle={() => toggleSection('admin')}
            />
            {expanded.admin && (
              <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
                <SubNavItem
                  to="/admin/node-config"
                  label="Node Config"
                  icon={<Server className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/settings"
                  label="System Settings"
                  icon={<Cog className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/variables"
                  label="Variables"
                  icon={<Cog className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/users-groups"
                  label="Users & Groups"
                  icon={<Users className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/backup"
                  label="Backup & Restore"
                  icon={<Database className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/audit-logs"
                  label="Audit Logs"
                  icon={<FileText className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/ai"
                  label="AI Assistant"
                  icon={<Brain className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/monitoring"
                  label="Monitoring"
                  icon={<Activity className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/feature-flags"
                  label="Feature Flags"
                  icon={<ToggleLeft className="w-3 h-3" />}
                />
              </div>
            )}
          </div>
        )}
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </nav>

      <div className="flex-shrink-0 border-t border-sanctuary-200 dark:border-sanctuary-800">
        {/* User profile row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-sanctuary-800 flex items-center justify-center text-xs font-semibold text-primary-700 dark:text-primary-400 uppercase">
              {user?.username?.charAt(0) || '?'}
            </div>
            <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">{user?.username}</span>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg text-sanctuary-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {/* Utility row */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="h-4 w-4 theme-toggle-icon" /> : <Moon className="h-4 w-4 theme-toggle-icon" />}
            </button>
            <NotificationBell />
          </div>
          <div className="flex items-center gap-3">
            <BlockHeightIndicator />
            <button
              onClick={onVersionClick}
              className="text-[11px] text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors cursor-pointer"
              title="Version info & support"
            >
              v{version}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
