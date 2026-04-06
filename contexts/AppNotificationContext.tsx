/**
 * App Notification Context
 *
 * Extensible notification system for displaying badges, alerts, and indicators
 * throughout the application. Supports scoped notifications (global, wallet, device)
 * and various severity levels.
 *
 * This is separate from NotificationContext which handles toast notifications.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { createLogger } from '../utils/logger';

const log = createLogger('AppNotification');

// Notification types - extensible via string union
export type NotificationType =
  | 'pending_drafts'
  | 'sync_error'
  | 'sync_in_progress'
  | 'pending_signatures'
  | 'security_alert'
  | 'update_available'
  | 'connection_error'
  | 'backup_reminder'
  | string;

// Notification scope - where the notification applies
export type NotificationScope = 'global' | 'wallet' | 'device' | 'user';

// Severity levels
export type NotificationSeverity = 'info' | 'warning' | 'critical';

// Main notification interface
export interface AppNotification {
  id: string;
  type: NotificationType;
  scope: NotificationScope;
  scopeId?: string;           // wallet/device/user ID for scoped notifications
  severity: NotificationSeverity;
  title: string;
  message?: string;
  count?: number;             // For badge display (e.g., "3 drafts")
  actionUrl?: string;         // URL to navigate to for resolution
  actionLabel?: string;       // Button text for action
  dismissible: boolean;
  persistent: boolean;        // Survives page refresh (stored in localStorage)
  createdAt: Date;
  expiresAt?: Date;           // Auto-dismiss after this time
  metadata?: Record<string, any>; // Additional data
}

// Notification input (for creating new notifications)
export interface CreateNotificationInput {
  type: NotificationType;
  scope: NotificationScope;
  scopeId?: string;
  severity?: NotificationSeverity;
  title: string;
  message?: string;
  count?: number;
  actionUrl?: string;
  actionLabel?: string;
  dismissible?: boolean;
  persistent?: boolean;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

// Context value interface
interface AppNotificationContextValue {
  // All notifications
  notifications: AppNotification[];

  // Filtered getters
  getGlobalNotifications: () => AppNotification[];
  getWalletNotifications: (walletId: string) => AppNotification[];
  getDeviceNotifications: (deviceId: string) => AppNotification[];
  getNotificationsByType: (type: NotificationType) => AppNotification[];

  // Counts for badges
  getGlobalCount: () => number;
  getWalletCount: (walletId: string) => number;
  getDeviceCount: (deviceId: string) => number;
  getTotalCount: () => number;

  // Check for specific notification types
  hasNotificationType: (type: NotificationType, scopeId?: string) => boolean;

  // CRUD operations
  addNotification: (input: CreateNotificationInput) => string;
  updateNotification: (id: string, updates: Partial<CreateNotificationInput>) => void;
  removeNotification: (id: string) => void;
  removeNotificationsByType: (type: NotificationType, scopeId?: string) => void;
  clearAllNotifications: () => void;
  clearScopedNotifications: (scope: NotificationScope, scopeId?: string) => void;

  // Dismiss (for user-dismissible notifications)
  dismissNotification: (id: string) => void;

  // Panel state
  isPanelOpen: boolean;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

const AppNotificationContext = createContext<AppNotificationContextValue | undefined>(undefined);

const STORAGE_KEY = 'sanctuary_app_notifications';

// Generate unique ID
const generateId = (): string => {
  return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Load notifications from localStorage
const loadNotifications = (): AppNotification[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as Array<Omit<AppNotification, 'createdAt' | 'expiresAt'> & { createdAt: string; expiresAt?: string }>;
    return parsed.map((n) => ({
      ...n,
      createdAt: new Date(n.createdAt),
      expiresAt: n.expiresAt ? new Date(n.expiresAt) : undefined,
    })).filter((n: AppNotification) => {
      // Filter out expired notifications
      if (n.expiresAt && new Date() > n.expiresAt) return false;
      return true;
    });
  } catch (err) {
    log.error('Failed to load notifications', { error: err });
    return [];
  }
};

// Save notifications to localStorage
const saveNotifications = (notifications: AppNotification[]): void => {
  try {
    const toSave = notifications.filter(n => n.persistent);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (err) {
    log.error('Failed to save notifications', { error: err });
  }
};

export const AppNotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Load persistent notifications on mount
  useEffect(() => {
    const loaded = loadNotifications();
    if (loaded.length > 0) {
      setNotifications(loaded);
    }
  }, []);

  // Save persistent notifications when they change
  useEffect(() => {
    saveNotifications(notifications);
  }, [notifications]);

  // Clean up expired notifications periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setNotifications(prev => prev.filter(n => {
        if (n.expiresAt && new Date() > n.expiresAt) return false;
        return true;
      }));
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Filtered getters
  const getGlobalNotifications = useCallback(() => {
    return notifications.filter(n => n.scope === 'global');
  }, [notifications]);

  const getWalletNotifications = useCallback((walletId: string) => {
    return notifications.filter(n => n.scope === 'wallet' && n.scopeId === walletId);
  }, [notifications]);

  const getDeviceNotifications = useCallback((deviceId: string) => {
    return notifications.filter(n => n.scope === 'device' && n.scopeId === deviceId);
  }, [notifications]);

  const getNotificationsByType = useCallback((type: NotificationType) => {
    return notifications.filter(n => n.type === type);
  }, [notifications]);

  // Counts
  const getGlobalCount = useCallback(() => {
    return notifications
      .filter(n => n.scope === 'global')
      .reduce((sum, n) => sum + (n.count || 1), 0);
  }, [notifications]);

  const getWalletCount = useCallback((walletId: string) => {
    return notifications
      .filter(n => n.scope === 'wallet' && n.scopeId === walletId)
      .reduce((sum, n) => sum + (n.count || 1), 0);
  }, [notifications]);

  const getDeviceCount = useCallback((deviceId: string) => {
    return notifications
      .filter(n => n.scope === 'device' && n.scopeId === deviceId)
      .reduce((sum, n) => sum + (n.count || 1), 0);
  }, [notifications]);

  const getTotalCount = useCallback(() => {
    return notifications.reduce((sum, n) => sum + (n.count || 1), 0);
  }, [notifications]);

  // Check for notification type
  const hasNotificationType = useCallback((type: NotificationType, scopeId?: string) => {
    return notifications.some(n => {
      if (n.type !== type) return false;
      if (scopeId && n.scopeId !== scopeId) return false;
      return true;
    });
  }, [notifications]);

  // CRUD operations
  const addNotification = useCallback((input: CreateNotificationInput): string => {
    const id = generateId();
    const notification: AppNotification = {
      id,
      type: input.type,
      scope: input.scope,
      scopeId: input.scopeId,
      severity: input.severity || 'info',
      title: input.title,
      message: input.message,
      count: input.count,
      actionUrl: input.actionUrl,
      actionLabel: input.actionLabel,
      dismissible: input.dismissible ?? true,
      persistent: input.persistent ?? false,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      metadata: input.metadata,
    };

    setNotifications(prev => {
      // Check if similar notification exists (same type + scopeId)
      const existingIndex = prev.findIndex(n =>
        n.type === notification.type && n.scopeId === notification.scopeId
      );

      if (existingIndex >= 0) {
        // Update existing notification
        const updated = [...prev];
        updated[existingIndex] = {
          ...notification,
          id: prev[existingIndex].id, // Keep original ID
        };
        return updated;
      }

      return [...prev, notification];
    });

    return id;
  }, []);

  const updateNotification = useCallback((id: string, updates: Partial<CreateNotificationInput>) => {
    setNotifications(prev => prev.map(n => {
      if (n.id !== id) return n;
      return {
        ...n,
        ...updates,
        // Don't allow changing scope or type
        scope: n.scope,
        type: n.type,
      };
    }));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const removeNotificationsByType = useCallback((type: NotificationType, scopeId?: string) => {
    setNotifications(prev => prev.filter(n => {
      if (n.type !== type) return true;
      if (scopeId && n.scopeId !== scopeId) return true;
      return false;
    }));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const clearScopedNotifications = useCallback((scope: NotificationScope, scopeId?: string) => {
    setNotifications(prev => prev.filter(n => {
      if (n.scope !== scope) return true;
      if (scopeId && n.scopeId !== scopeId) return true;
      return false;
    }));
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => {
      if (n.id !== id) return true;
      return !n.dismissible;
    }));
  }, []);

  // Panel controls
  const togglePanel = useCallback(() => setIsPanelOpen(prev => !prev), []);
  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => setIsPanelOpen(false), []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<AppNotificationContextValue>(() => ({
    notifications,
    getGlobalNotifications,
    getWalletNotifications,
    getDeviceNotifications,
    getNotificationsByType,
    getGlobalCount,
    getWalletCount,
    getDeviceCount,
    getTotalCount,
    hasNotificationType,
    addNotification,
    updateNotification,
    removeNotification,
    removeNotificationsByType,
    clearAllNotifications,
    clearScopedNotifications,
    dismissNotification,
    isPanelOpen,
    togglePanel,
    openPanel,
    closePanel,
  }), [
    notifications,
    getGlobalNotifications,
    getWalletNotifications,
    getDeviceNotifications,
    getNotificationsByType,
    getGlobalCount,
    getWalletCount,
    getDeviceCount,
    getTotalCount,
    hasNotificationType,
    addNotification,
    updateNotification,
    removeNotification,
    removeNotificationsByType,
    clearAllNotifications,
    clearScopedNotifications,
    dismissNotification,
    isPanelOpen,
    togglePanel,
    openPanel,
    closePanel,
  ]);

  return (
    <AppNotificationContext.Provider value={value}>
      {children}
    </AppNotificationContext.Provider>
  );
};

// Hook to use app notifications
export const useAppNotifications = (): AppNotificationContextValue => {
  const context = useContext(AppNotificationContext);
  if (!context) {
    throw new Error('useAppNotifications must be used within an AppNotificationProvider');
  }
  return context;
};

// Convenience hook for wallet-specific notifications
export const useWalletNotifications = (walletId: string) => {
  const ctx = useAppNotifications();
  return {
    notifications: ctx.getWalletNotifications(walletId),
    count: ctx.getWalletCount(walletId),
    add: (input: Omit<CreateNotificationInput, 'scope' | 'scopeId'>) =>
      ctx.addNotification({ ...input, scope: 'wallet', scopeId: walletId }),
    remove: (type: NotificationType) => ctx.removeNotificationsByType(type, walletId),
    clear: () => ctx.clearScopedNotifications('wallet', walletId),
  };
};

// Convenience hook for device-specific notifications
export const useDeviceNotifications = (deviceId: string) => {
  const ctx = useAppNotifications();
  return {
    notifications: ctx.getDeviceNotifications(deviceId),
    count: ctx.getDeviceCount(deviceId),
    add: (input: Omit<CreateNotificationInput, 'scope' | 'scopeId'>) =>
      ctx.addNotification({ ...input, scope: 'device', scopeId: deviceId }),
    remove: (type: NotificationType) => ctx.removeNotificationsByType(type, deviceId),
    clear: () => ctx.clearScopedNotifications('device', deviceId),
  };
};

export default AppNotificationContext;
