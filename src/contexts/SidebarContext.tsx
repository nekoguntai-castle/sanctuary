/**
 * Sidebar Context
 *
 * Provides a mechanism to trigger sidebar data refresh from anywhere in the app.
 * Used when wallets or devices are created/deleted to update the sidebar.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SidebarContextValue {
  /** Increment to trigger a sidebar data refresh */
  refreshKey: number;
  /** Call this to refresh sidebar data (wallets, devices) */
  refreshSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export const SidebarProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshSidebar = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  return (
    <SidebarContext.Provider value={{ refreshKey, refreshSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = (): SidebarContextValue => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export default SidebarContext;
