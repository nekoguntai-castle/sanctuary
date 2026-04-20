import React from 'react';
import {
  adminNavGroup,
  getNavItemsBySection,
  getRequiredNavItem,
  type AppNavItem,
} from '../../src/app/appRoutes';
import { hasRequiredCapabilities } from '../../src/app/capabilities';
import { SidebarDeviceSection } from './SidebarContent/SidebarDeviceSection';
import { SidebarFooter } from './SidebarContent/SidebarFooter';
import { SidebarHeader } from './SidebarContent/SidebarHeader';
import { SidebarPrimaryNav } from './SidebarContent/SidebarPrimaryNav';
import { SidebarSystemSection } from './SidebarContent/SidebarSystemSection';
import { SidebarWalletSection } from './SidebarContent/SidebarWalletSection';
import type { SidebarContentProps } from './SidebarContent/types';

const getVisibleNavItems = (
  items: AppNavItem[],
  capabilities: SidebarContentProps['capabilities']
) => items.filter((item) => hasRequiredCapabilities(item.requiredCapabilities, capabilities));

const isNavItemVisible = (
  item: AppNavItem,
  capabilities: SidebarContentProps['capabilities']
) => hasRequiredCapabilities(item.requiredCapabilities, capabilities);

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
  capabilities,
}) => {
  const primaryNavItems = getVisibleNavItems(getNavItemsBySection('primary'), capabilities);
  const walletNavItem = getRequiredNavItem('wallets');
  const devicesNavItem = getRequiredNavItem('devices');
  const systemNavItemsBeforeAdmin = getVisibleNavItems(
    getNavItemsBySection('system').filter((item) => item.id !== 'settings'),
    capabilities
  );
  const settingsNavItem = getRequiredNavItem('settings');
  const adminNavItems = getVisibleNavItems(getNavItemsBySection('admin'), capabilities);

  return (
    <>
      <SidebarHeader />

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        <SidebarPrimaryNav items={primaryNavItems} />
        <SidebarWalletSection
          show={isNavItemVisible(walletNavItem, capabilities)}
          navItem={walletNavItem}
          wallets={wallets}
          isExpanded={expanded.wallets}
          onToggle={() => toggleSection('wallets')}
          getWalletCount={getWalletCount}
        />
        <SidebarDeviceSection
          show={isNavItemVisible(devicesNavItem, capabilities)}
          navItem={devicesNavItem}
          devices={devices}
          isExpanded={expanded.devices}
          onToggle={() => toggleSection('devices')}
          getDeviceCount={getDeviceCount}
        />
        <SidebarSystemSection
          systemNavItems={systemNavItemsBeforeAdmin}
          adminNavGroup={adminNavGroup}
          adminNavItems={adminNavItems}
          showAdminSection={!!user?.isAdmin && adminNavItems.length > 0}
          isAdminExpanded={expanded.admin}
          onAdminToggle={() => toggleSection('admin')}
          settingsNavItem={settingsNavItem}
          showSettingsNavItem={isNavItemVisible(settingsNavItem, capabilities)}
        />
      </nav>

      <SidebarFooter
        user={user}
        darkMode={darkMode}
        toggleTheme={toggleTheme}
        logout={logout}
        onVersionClick={onVersionClick}
      />
    </>
  );
};
