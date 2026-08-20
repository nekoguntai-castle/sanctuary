/**
 * Layout Module Types
 *
 * Shared types for the Layout component and its subcomponents.
 */

export interface LayoutProps {
  children: React.ReactNode;
  darkMode: boolean;
  toggleTheme: () => void;
  onLogout: () => void;
}

export interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hasSubmenu?: boolean;
  isOpen?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
}

export interface SubNavItemProps {
  to: string;
  label: string;
  icon?: React.ReactNode;
  activeColorClass?: string;
  badgeCount?: number;
  badgeSeverity?: 'info' | 'warning' | 'critical';
  statusDot?: 'synced' | 'syncing' | 'resyncing' | 'retrying' | 'stale' | 'error' | 'pending';
  /** Human-readable explanation for the dot; the enum name is not one. */
  statusDotTitle?: string;
}

export interface ExpandedState {
  wallets: boolean;
  devices: boolean;
  admin: boolean;
}
