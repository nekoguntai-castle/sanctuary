/**
 * User, Group & Device Types
 *
 * Types for users, groups, devices, preferences, and permissions.
 */

import type { DeviceRole } from '../shared/types/domain';
import type { HardwareDevice, HardwareDeviceModel } from './hardware';
import type {
  ThemeOption,
  BackgroundOption,
  TelegramConfig,
  NotificationSounds,
  SeasonalBackgrounds,
} from './ui';

// View settings for a single page/component
export interface PageViewSettings {
  layout?: string;          // 'grid' | 'table' | 'list' | 'grouped' | etc.
  sortBy?: string;          // Column to sort by (future)
  sortOrder?: 'asc' | 'desc'; // Sort direction (future)
  ownershipFilter?: 'all' | 'owned' | 'shared'; // For filtering by ownership
  walletFilter?: string;             // 'all' | 'unassigned' | wallet-id
  visibleColumns?: string[];  // Column IDs that are visible
  columnOrder?: string[];     // Column IDs in display order
}

// View settings keyed by page name (wallets, devices, transactions, etc.)
export interface ViewSettings {
  [pageKey: string]: PageViewSettings;
}

export interface UserPreferences {
  darkMode: boolean;
  unit: 'sats' | 'btc';
  fiatCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  showFiat: boolean;
  theme: ThemeOption;
  background: BackgroundOption;
  contrastLevel?: number; // -2 to +2, adjusts background contrast (0 = default)
  patternOpacity?: number; // 0 to 100, controls background visibility (default 50)
  priceProvider?: string;
  telegram?: TelegramConfig;
  notificationSounds?: NotificationSounds;
  viewSettings?: ViewSettings;
  seasonalBackgrounds?: SeasonalBackgrounds; // Custom backgrounds for each season
  favoriteBackgrounds?: BackgroundOption[]; // User's favorite backgrounds for quick access
  favoriteThemes?: ThemeOption[]; // User's favorite color themes
}

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  password?: string; // Simple mock password
  preferences?: UserPreferences;
  twoFactorEnabled?: boolean;
  usingDefaultPassword?: boolean;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

/**
 * Device account - represents one xpub at a specific derivation path
 */
export interface DeviceAccount {
  id: string;
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

export interface Device {
  id: string;
  type: HardwareDevice | string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub?: string; // Optional for backward compat, but typically present
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: HardwareDeviceModel;
  accounts?: DeviceAccount[]; // All accounts (multi-account support)
  walletCount?: number; // Number of associated wallets (list view)
  wallets?: Array<{    // Full wallet details (detail view only)
    wallet: {
      id: string;
      name: string;
      type: string;
      scriptType?: string;
    };
  }>;
  // Wallet-specific metadata (set by formatDevicesForWallet)
  accountMissing?: boolean;
  // Sharing info (present when fetching accessible devices)
  isOwner?: boolean;
  userRole?: DeviceRole;
  sharedBy?: string; // Username of owner if shared
  groupId?: string;
  groupRole?: string;
}

// DeviceRole is re-exported from shared/types/domain via index.ts

export interface DeviceShareInfo {
  group: { id: string; name: string } | null;
  users: Array<{ id: string; username: string; role: string }>;
}
