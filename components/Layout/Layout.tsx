import React from 'react';
import { ConsoleDrawer } from '../ConsoleDrawer';
import { SidebarContent } from './SidebarContent';
import { LayoutShell } from './LayoutShell';
import { LayoutProps } from './types';
import { useLayoutController } from './useLayoutController';

export const Layout: React.FC<LayoutProps> = ({ children, darkMode, toggleTheme }) => {
  const controller = useLayoutController();

  const sidebarContent = (
    <SidebarContent
      user={controller.user}
      wallets={controller.wallets}
      devices={controller.devices}
      expanded={controller.expanded}
      darkMode={darkMode}
      toggleTheme={toggleTheme}
      toggleSection={controller.toggleSection}
      logout={controller.logout}
      getWalletCount={controller.getWalletCount}
      getDeviceCount={controller.getDeviceCount}
      onVersionClick={controller.handleVersionClick}
      onOpenConsole={controller.openConsole}
      capabilities={controller.capabilities}
    />
  );

  return (
    <>
      <LayoutShell controller={controller} sidebarContent={sidebarContent}>
        {children}
      </LayoutShell>
      <ConsoleDrawer
        isOpen={controller.isConsoleOpen}
        onClose={controller.closeConsole}
        wallets={controller.wallets}
        isAdmin={!!controller.user?.isAdmin}
      />
    </>
  );
};
