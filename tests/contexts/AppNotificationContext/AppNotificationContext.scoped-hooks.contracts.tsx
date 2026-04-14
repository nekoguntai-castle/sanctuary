import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAppNotifications,
  useDeviceNotifications,
  useWalletNotifications,
} from '../../../contexts/AppNotificationContext';
import { wrapper } from './AppNotificationContextTestHarness';

export const registerAppNotificationScopedHookContracts = () => {
describe('useWalletNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should return wallet-specific notifications and counts', () => {
    const { result } = renderHook(
      () => {
        const appNotifs = useAppNotifications();
        const walletNotifs = useWalletNotifications('wallet-123');
        return { appNotifs, walletNotifs };
      },
      { wrapper }
    );

    act(() => {
      result.current.appNotifs.addNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: 'wallet-123',
        title: 'Draft',
        count: 2,
      });
    });

    expect(result.current.walletNotifs.notifications).toHaveLength(1);
    expect(result.current.walletNotifs.count).toBe(2);
  });

  it('should add wallet-scoped notification', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-456');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'pending_signatures',
        title: 'Needs Signature',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].scope).toBe('wallet');
    expect(result.current.notifications[0].scopeId).toBe('wallet-456');
  });

  it('should remove notification by type from wallet', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-789');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'pending_drafts',
        title: 'Draft',
      });
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      result.current.remove('pending_drafts');
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('should clear all wallet notifications', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-abc');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({ type: 'pending_drafts', title: 'Draft 1' });
      result.current.add({ type: 'sync_error', title: 'Error' });
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.notifications).toHaveLength(0);
  });
});

describe('useDeviceNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should return device-specific notifications and counts', () => {
    const { result } = renderHook(
      () => {
        const appNotifs = useAppNotifications();
        const deviceNotifs = useDeviceNotifications('device-123');
        return { appNotifs, deviceNotifs };
      },
      { wrapper }
    );

    act(() => {
      result.current.appNotifs.addNotification({
        type: 'connection_error',
        scope: 'device',
        scopeId: 'device-123',
        title: 'Connection Error',
      });
    });

    expect(result.current.deviceNotifs.notifications).toHaveLength(1);
    expect(result.current.deviceNotifs.count).toBe(1);
  });

  it('should add device-scoped notification', () => {
    const { result } = renderHook(
      () => useDeviceNotifications('device-456'),
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'backup_reminder',
        title: 'Backup Device',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].scope).toBe('device');
    expect(result.current.notifications[0].scopeId).toBe('device-456');
  });

  it('should clear all device notifications', () => {
    const { result } = renderHook(
      () => useDeviceNotifications('device-xyz'),
      { wrapper }
    );

    act(() => {
      result.current.add({ type: 'connection_error', title: 'Error' });
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('should remove only notifications of a given type for the device scope', () => {
    const { result } = renderHook(
      () => useDeviceNotifications('device-remove'),
      { wrapper }
    );

    act(() => {
      result.current.add({ type: 'connection_error', title: 'Error 1' });
      result.current.add({ type: 'backup_reminder', title: 'Reminder' });
    });

    expect(result.current.notifications).toHaveLength(2);

    act(() => {
      result.current.remove('connection_error');
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].type).toBe('backup_reminder');
  });
});
};
