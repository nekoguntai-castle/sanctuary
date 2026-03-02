/**
 * useWalletSharing Hook
 *
 * Manages wallet sharing state and actions: user search, share with user / group,
 * role management, device share prompt, and removal of access.
 * Extracted from WalletDetail.tsx to isolate sharing concerns.
 */

import { useState } from 'react';
import * as walletsApi from '../../../src/api/wallets';
import * as devicesApi from '../../../src/api/devices';
import * as authApi from '../../../src/api/auth';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import type { Wallet, Device } from '../../../types';
import type { DeviceSharePromptState } from '../types';

const log = createLogger('useWalletSharing');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletSharingParams {
  /** Wallet ID */
  walletId: string | undefined;
  /** Current wallet object (needed for guard checks) */
  wallet: Wallet | null;
  /** Devices associated with this wallet (used for device sharing) */
  devices: Device[];
  /** Current wallet share information */
  walletShareInfo: walletsApi.WalletShareInfo | null;
  /** Available groups for sharing */
  groups: authApi.UserGroup[];
  /** Callback to refresh wallet data after sharing changes */
  onDataRefresh: () => Promise<void>;
  /** Setter for walletShareInfo on parent (will be removed once state moves entirely here) */
  setWalletShareInfo: (info: walletsApi.WalletShareInfo | null) => void;
  /** Setter for wallet on parent (for handleTransferComplete) */
  setWallet: (wallet: Wallet | null) => void;
}

export interface UseWalletSharingReturn {
  // User search
  userSearchQuery: string;
  userSearchResults: authApi.SearchUser[];
  searchingUsers: boolean;
  handleSearchUsers: (query: string) => void;

  // Group sharing
  selectedGroupToAdd: string;
  setSelectedGroupToAdd: (groupId: string) => void;
  addGroup: (role?: 'viewer' | 'signer') => Promise<void>;
  updateGroupRole: (role: 'viewer' | 'signer') => Promise<void>;
  removeGroup: () => Promise<void>;

  // User sharing
  sharingLoading: boolean;
  handleShareWithUser: (userId: string, role?: 'viewer' | 'signer') => Promise<void>;
  handleRemoveUserAccess: (userId: string) => Promise<void>;

  // Device share prompt
  deviceSharePrompt: DeviceSharePromptState;
  handleShareDevicesWithUser: () => Promise<void>;
  dismissDeviceSharePrompt: () => void;

  // Transfer
  handleTransferComplete: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_DEVICE_SHARE: DeviceSharePromptState = {
  show: false,
  targetUserId: '',
  targetUsername: '',
  devices: [],
};

export function useWalletSharing({
  walletId,
  wallet,
  walletShareInfo,
  setWalletShareInfo,
  setWallet,
}: UseWalletSharingParams): UseWalletSharingReturn {
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification } = useAppNotifications();

  // User search state
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  // Group selection state
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');

  // Sharing loading state (shared across group/user operations)
  const [sharingLoading, setSharingLoading] = useState(false);

  // Device share prompt state
  const [deviceSharePrompt, setDeviceSharePrompt] = useState<DeviceSharePromptState>(EMPTY_DEVICE_SHARE);

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const refreshShareInfo = async (id: string) => {
    const shareInfo = await walletsApi.getWalletShareInfo(id);
    setWalletShareInfo(shareInfo);
  };

  // -----------------------------------------------------------------------
  // Group operations
  // -----------------------------------------------------------------------

  const addGroup = async (role: 'viewer' | 'signer' = 'viewer') => {
    if (!wallet || !selectedGroupToAdd || !walletId) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(walletId, { groupId: selectedGroupToAdd, role });
      await refreshShareInfo(walletId);
      setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { error: err });
      handleError(err, 'Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const updateGroupRole = async (role: 'viewer' | 'signer') => {
    if (!wallet || !walletShareInfo?.group || !walletId) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(walletId, { groupId: walletShareInfo.group.id, role });
      await refreshShareInfo(walletId);
    } catch (err) {
      log.error('Failed to update group role', { error: err });
      handleError(err, 'Update Role Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const removeGroup = async () => {
    if (!wallet || !walletId) return;
    try {
      setSharingLoading(true);
      // Setting groupId to null removes group access
      await walletsApi.shareWalletWithGroup(walletId, { groupId: null });
      await refreshShareInfo(walletId);
    } catch (err) {
      log.error('Failed to remove group', { error: err });
      handleError(err, 'Remove Group Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // User operations
  // -----------------------------------------------------------------------

  const handleShareWithUser = async (targetUserId: string, role: 'viewer' | 'signer' = 'viewer') => {
    if (!walletId) return;
    try {
      setSharingLoading(true);
      const result = await walletsApi.shareWalletWithUser(walletId, { targetUserId, role });

      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(walletId);
      setWalletShareInfo(shareInfo);

      // If there are devices to share, show the prompt
      if (result.devicesToShare && result.devicesToShare.length > 0) {
        const targetUsername = userSearchResults.find(u => u.id === targetUserId)?.username
          || shareInfo.users.find(u => u.id === targetUserId)?.username
          || 'this user';

        setDeviceSharePrompt({
          show: true,
          targetUserId,
          targetUsername,
          devices: result.devicesToShare,
        });
      }

      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (err) {
      log.error('Failed to share with user', { error: err });
      handleError(err, 'Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleShareDevicesWithUser = async () => {
    if (!deviceSharePrompt.show) return;
    try {
      setSharingLoading(true);
      // Share all devices with the user using allSettled to handle partial failures
      const results = await Promise.allSettled(
        deviceSharePrompt.devices.map(device =>
          devicesApi.shareDeviceWithUser(device.id, { targetUserId: deviceSharePrompt.targetUserId })
        )
      );

      // Check for failures
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const successes = results.filter(r => r.status === 'fulfilled');

      if (failures.length > 0) {
        log.warn('Some devices failed to share', {
          total: results.length,
          succeeded: successes.length,
          failed: failures.length,
          errors: failures.map(f => f.reason?.message || 'Unknown error'),
        });

        if (successes.length > 0) {
          // Partial success - show warning
          addAppNotification({
            type: 'warning',
            scope: 'global',
            severity: 'warning',
            title: 'Partial Success',
            message: `Shared ${successes.length} of ${results.length} devices. ${failures.length} failed.`,
          });
        } else {
          // Complete failure
          handleError(failures[0].reason, 'Device Share Failed');
        }
      }

      setDeviceSharePrompt(EMPTY_DEVICE_SHARE);
    } catch (err) {
      log.error('Failed to share devices', { error: err });
      handleError(err, 'Device Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const dismissDeviceSharePrompt = () => {
    setDeviceSharePrompt(EMPTY_DEVICE_SHARE);
  };

  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!walletId) return;
    try {
      setSharingLoading(true);
      await walletsApi.removeUserFromWallet(walletId, targetUserId);
      await refreshShareInfo(walletId);
    } catch (err) {
      log.error('Failed to remove user', { error: err });
      handleError(err, 'Remove User Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleSearchUsers = async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }
    try {
      setSearchingUsers(true);
      const results = await authApi.searchUsers(query);
      // Filter out users who already have access
      const existingUserIds = walletShareInfo?.users.map(u => u.id) || [];
      setUserSearchResults(results.filter(u => !existingUserIds.includes(u.id)));
    } catch (err) {
      logError(log, err, 'Failed to search users');
      handleError(err, 'Failed to Search Users');
    } finally {
      setSearchingUsers(false);
    }
  };

  // Reload wallet data after transfer actions
  const handleTransferComplete = async () => {
    if (!walletId) return;
    try {
      const walletData = await walletsApi.getWallet(walletId);
      setWallet(walletData);
      await refreshShareInfo(walletId);
    } catch (err) {
      log.error('Failed to reload wallet after transfer', { error: err });
    }
  };

  return {
    // User search
    userSearchQuery,
    userSearchResults,
    searchingUsers,
    handleSearchUsers,

    // Group sharing
    selectedGroupToAdd,
    setSelectedGroupToAdd,
    addGroup,
    updateGroupRole,
    removeGroup,

    // User sharing
    sharingLoading,
    handleShareWithUser,
    handleRemoveUserAccess,

    // Device share prompt
    deviceSharePrompt,
    handleShareDevicesWithUser,
    dismissDeviceSharePrompt,

    // Transfer
    handleTransferComplete,
  };
}
