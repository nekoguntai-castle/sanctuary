import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Notification, generateNotificationId } from '../components/NotificationToast';

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Track timeouts for cleanup
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Track recently shown transaction notifications to prevent duplicates
  const recentTxidsRef = useRef<Set<string>>(new Set());
  // Track dedupe cleanup timeouts separately
  const dedupeTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current.clear();
      dedupeTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      dedupeTimeoutsRef.current.clear();
      recentTxidsRef.current.clear();
    };
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    // Clear the timeout if it exists
    const timeout = timeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    // Deduplicate transaction/confirmation notifications by txid
    const txid = notification.data?.txid;
    if (txid && (notification.type === 'transaction' || notification.type === 'confirmation')) {
      const dedupeKey = `${notification.type}:${txid}:${notification.data?.confirmations || 0}`;
      if (recentTxidsRef.current.has(dedupeKey)) {
        return; // Skip duplicate
      }
      recentTxidsRef.current.add(dedupeKey);
      // Clean up after 30 seconds to allow future notifications for same tx
      const dedupeTimeout = setTimeout(() => {
        recentTxidsRef.current.delete(dedupeKey);
        dedupeTimeoutsRef.current.delete(dedupeKey);
      }, 30000);
      dedupeTimeoutsRef.current.set(dedupeKey, dedupeTimeout);
    }

    const id = generateNotificationId();
    const newNotification: Notification = {
      ...notification,
      id,
    };

    setNotifications((prev) => [...prev, newNotification]);

    // Auto-remove after duration if specified
    if (notification.duration) {
      const timeout = setTimeout(() => {
        removeNotification(id);
      }, notification.duration);
      timeoutsRef.current.set(id, timeout);
    }
  }, [removeNotification]);

  const clearAll = useCallback(() => {
    // Clear all timeouts
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current.clear();
    setNotifications([]);
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        removeNotification,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
};
