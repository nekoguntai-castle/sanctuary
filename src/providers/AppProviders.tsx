/**
 * AppProviders - Composes all context providers into a single wrapper
 *
 * Eliminates deeply nested provider trees in App.tsx.
 * Provider order matters: outer providers are available to inner ones.
 *
 * Order:
 * 1. QueryProvider - React Query cache (no dependencies)
 * 2. UserProvider - Auth state (uses QueryProvider indirectly)
 * 3. ActiveNetworkProvider - persisted network preference (depends on UserProvider)
 * 4. CurrencyProvider - BTC price & formatting (depends on UserProvider)
 * 5. NotificationProvider - Toast notifications (no context dependencies)
 * 6. AppNotificationProvider - Badge/alert notifications (no context dependencies)
 * 7. SidebarProvider - Sidebar refresh triggers (no context dependencies)
 */

import React, { ReactNode } from 'react';
import { QueryProvider } from './QueryProvider';
import { UserProvider } from '../contexts/UserContext';
import { ActiveNetworkProvider } from '../contexts/ActiveNetworkContext';
import { CurrencyProvider } from '../contexts/CurrencyContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { AppNotificationProvider } from '../contexts/AppNotificationContext';
import { SidebarProvider } from '../contexts/SidebarContext';

interface AppProvidersProps {
  children: ReactNode;
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <QueryProvider>
      <UserProvider>
        <ActiveNetworkProvider>
          <CurrencyProvider>
            <NotificationProvider>
              <AppNotificationProvider>
                <SidebarProvider>
                  {children}
                </SidebarProvider>
              </AppNotificationProvider>
            </NotificationProvider>
          </CurrencyProvider>
        </ActiveNetworkProvider>
      </UserProvider>
    </QueryProvider>
  );
};
