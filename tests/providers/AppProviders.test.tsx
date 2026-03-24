import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProviders } from '../../providers/AppProviders';

vi.mock('../../providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="query-provider">{children}</div>,
}));
vi.mock('../../contexts/UserContext', () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="user-provider">{children}</div>,
}));
vi.mock('../../contexts/CurrencyContext', () => ({
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="currency-provider">{children}</div>,
}));
vi.mock('../../contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="notification-provider">{children}</div>,
}));
vi.mock('../../contexts/AppNotificationContext', () => ({
  AppNotificationProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="app-notification-provider">{children}</div>,
}));
vi.mock('../../contexts/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sidebar-provider">{children}</div>,
}));

describe('AppProviders', () => {
  it('renders children inside all providers', () => {
    render(
      <AppProviders>
        <span data-testid="child">Hello</span>
      </AppProviders>,
    );

    expect(screen.getByTestId('query-provider')).toBeInTheDocument();
    expect(screen.getByTestId('user-provider')).toBeInTheDocument();
    expect(screen.getByTestId('currency-provider')).toBeInTheDocument();
    expect(screen.getByTestId('notification-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app-notification-provider')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('nests providers in the correct order (query > user > currency > notification > app-notification > sidebar)', () => {
    render(
      <AppProviders>
        <span data-testid="child">Content</span>
      </AppProviders>,
    );

    const queryProvider = screen.getByTestId('query-provider');
    const userProvider = screen.getByTestId('user-provider');
    const currencyProvider = screen.getByTestId('currency-provider');
    const notificationProvider = screen.getByTestId('notification-provider');
    const appNotificationProvider = screen.getByTestId('app-notification-provider');
    const sidebarProvider = screen.getByTestId('sidebar-provider');
    const child = screen.getByTestId('child');

    // Each provider should contain the next one in the nesting order
    expect(queryProvider).toContainElement(userProvider);
    expect(userProvider).toContainElement(currencyProvider);
    expect(currencyProvider).toContainElement(notificationProvider);
    expect(notificationProvider).toContainElement(appNotificationProvider);
    expect(appNotificationProvider).toContainElement(sidebarProvider);
    expect(sidebarProvider).toContainElement(child);
  });
});
