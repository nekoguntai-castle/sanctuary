/**
 * useWalletSharing Hook
 *
 * Manages wallet sharing state and actions: user search, share with user / group,
 * role management, device share prompt, and removal of access.
 * Extracted from WalletDetail.tsx to isolate sharing concerns.
 */

import { useLayoutEffect, useState } from 'react';
import * as walletsApi from '../../../api/wallets';
import * as devicesApi from '../../../api/devices';
import * as authApi from '../../../api/auth';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import type { Wallet, Device } from '../../../types';
import type { DeviceSharePromptState } from '../types';
import type { WalletShareRole } from '@sanctuary/shared/constants/walletRoles';
import type { RouteToken } from '../../../hooks/requestOwnership';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';

const log = createLogger('useWalletSharing');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletSharingParams {
  /** Wallet ID */
  walletId: string | undefined;
  ownershipKey?: string;
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
  handleSearchUsers: (query: string) => Promise<void>;

  // Group sharing
  selectedGroupToAdd: string;
  setSelectedGroupToAdd: (groupId: string) => void;
  addGroup: (role?: WalletShareRole) => Promise<void>;
  updateGroupRole: (role: WalletShareRole) => Promise<void>;
  removeGroup: () => Promise<void>;

  // User sharing
  sharingLoading: boolean;
  handleShareWithUser: (userId: string, role?: WalletShareRole) => Promise<void>;
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
  ownershipKey = walletId ?? '',
  wallet,
  walletShareInfo,
  setWalletShareInfo,
  setWallet,
}: UseWalletSharingParams): UseWalletSharingReturn {
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification } = useAppNotifications();
  const ownership = useWalletRouteOwnership(ownershipKey);

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

  useLayoutEffect(() => {
    setUserSearchQuery('');
    setUserSearchResults([]);
    setSearchingUsers(false);
    setSelectedGroupToAdd('');
    setSharingLoading(false);
    setDeviceSharePrompt(EMPTY_DEVICE_SHARE);
  }, [ownershipKey]);

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const owns = (token: RouteToken, id: string) => (
    id === walletId && ownership.isRouteOwner(token)
  );

  const refreshShareInfo = async (id: string, token: RouteToken) => {
    const shareInfo = await walletsApi.getWalletShareInfo(id);
    if (owns(token, id)) setWalletShareInfo(shareInfo);
    return shareInfo;
  };

  // -----------------------------------------------------------------------
  // Group operations
  // -----------------------------------------------------------------------

  const addGroup = async (role: WalletShareRole = 'viewer') => {
    if (!wallet || !selectedGroupToAdd || !walletId) return;
    const id = walletId;
    const groupId = selectedGroupToAdd;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(id, { groupId, role });
      await refreshShareInfo(id, token);
      if (owns(token, id)) setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { error: err });
      if (owns(token, id)) handleError(err, 'Share Failed');
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  const updateGroupRole = async (role: WalletShareRole) => {
    if (!wallet || !walletShareInfo?.group || !walletId) return;
    const id = walletId;
    const groupId = walletShareInfo.group.id;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(id, { groupId, role });
      await refreshShareInfo(id, token);
    } catch (err) {
      log.error('Failed to update group role', { error: err });
      if (owns(token, id)) handleError(err, 'Update Role Failed');
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  const removeGroup = async () => {
    if (!wallet || !walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      setSharingLoading(true);
      // Setting groupId to null removes group access
      await walletsApi.shareWalletWithGroup(id, { groupId: null });
      await refreshShareInfo(id, token);
    } catch (err) {
      log.error('Failed to remove group', { error: err });
      if (owns(token, id)) handleError(err, 'Remove Group Failed');
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // User operations
  // -----------------------------------------------------------------------

  const handleShareWithUser = async (targetUserId: string, role: WalletShareRole = 'viewer') => {
    if (!walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      setSharingLoading(true);
      const result = await walletsApi.shareWalletWithUser(id, { targetUserId, role });

      // Refresh share info
      const shareInfo = await refreshShareInfo(id, token);
      if (!owns(token, id)) return;

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
      if (owns(token, id)) handleError(err, 'Share Failed');
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  const handleShareDevicesWithUser = async () => {
    if (!deviceSharePrompt.show || !walletId) return;
    const id = walletId;
    const prompt = deviceSharePrompt;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    setSharingLoading(true);
    try {
      // allSettled turns per-device failures into data; no request rejection escapes.
      const results = await Promise.allSettled(
        prompt.devices.map(device => Promise.resolve().then(() =>
          devicesApi.shareDeviceWithUser(device.id, { targetUserId: prompt.targetUserId })
        ))
      );

      if (!owns(token, id)) return;
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
          addAppNotification({
            type: 'warning',
            scope: 'global',
            severity: 'warning',
            title: 'Partial Success',
            message: `Shared ${successes.length} of ${results.length} devices. ${failures.length} failed.`,
          });
        } else {
          handleError(failures[0].reason, 'Device Share Failed');
        }
      }

      setDeviceSharePrompt(EMPTY_DEVICE_SHARE);
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  const dismissDeviceSharePrompt = () => {
    setDeviceSharePrompt(EMPTY_DEVICE_SHARE);
  };

  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      setSharingLoading(true);
      await walletsApi.removeUserFromWallet(id, targetUserId);
      await refreshShareInfo(id, token);
    } catch (err) {
      log.error('Failed to remove user', { error: err });
      if (owns(token, id)) handleError(err, 'Remove User Failed');
    } finally {
      if (owns(token, id)) setSharingLoading(false);
    }
  };

  const handleSearchUsers = async (query: string) => {
    const id = walletId;
    const token = ownership.beginFetch(ownershipKey);
    if (!ownership.isFetchOwner(token) || id !== walletId) return;
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      setSearchingUsers(false);
      return;
    }
    try {
      setSearchingUsers(true);
      const results = await authApi.searchUsers(query);
      if (!ownership.isFetchOwner(token) || id !== walletId) return;
      // Filter out users who already have access
      const existingUserIds = walletShareInfo?.users.map(u => u.id) || [];
      setUserSearchResults(results.filter(u => !existingUserIds.includes(u.id)));
    } catch (err) {
      logError(log, err, 'Failed to search users');
      if (ownership.isFetchOwner(token) && id === walletId) {
        handleError(err, 'Failed to Search Users');
      }
    } finally {
      if (ownership.isFetchOwner(token) && id === walletId) setSearchingUsers(false);
    }
  };

  // Reload wallet data after transfer actions
  const handleTransferComplete = async () => {
    if (!walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;
    try {
      const walletData = await walletsApi.getWallet(id);
      if (owns(token, id)) setWallet(walletData);
      await refreshShareInfo(id, token);
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
