/**
 * DeviceSharing Component
 *
 * UI for managing device sharing with users and groups.
 * Similar to wallet sharing but simpler (only owner/viewer roles).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, User as UserIcon, Shield, Trash2, X } from 'lucide-react';
import { DeviceShareInfo, DeviceRole } from '../types';
import * as devicesApi from '../src/api/devices';
import * as authApi from '../src/api/auth';
import * as adminApi from '../src/api/admin';
import { useUser } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';
import { useLoadingState } from '../hooks/useLoadingState';

const log = createLogger('DeviceSharing');

// Simplified group type for display (works with both UserGroup and AdminGroup)
interface GroupDisplay {
  id: string;
  name: string;
}

interface DeviceSharingProps {
  deviceId: string;
  isOwner: boolean;
  userRole: DeviceRole;
  onShareInfoChange?: (shareInfo: DeviceShareInfo) => void;
}

export const DeviceSharing: React.FC<DeviceSharingProps> = ({
  deviceId,
  isOwner,
  userRole,
  onShareInfoChange,
}) => {
  const { user } = useUser();
  const [shareInfo, setShareInfo] = useState<DeviceShareInfo | null>(null);
  const [groups, setGroups] = useState<GroupDisplay[]>([]);

  // Loading states using hook
  const { loading, error: loadError, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: sharingLoading, error: sharingError, execute: runSharing } = useLoadingState();

  // Combined error display
  const error = loadError || sharingError;

  // Group selection
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');

  // User search
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const fetchShareInfo = useCallback(async () => {
    const info = await devicesApi.getDeviceShareInfo(deviceId);
    setShareInfo(info);
    onShareInfoChange?.(info);
  }, [deviceId, onShareInfoChange]);

  const fetchGroups = useCallback(async () => {
    // Admins can see all groups; regular users only see their groups
    const userGroups = user?.isAdmin
      ? await adminApi.getGroups()
      : await authApi.getUserGroups();
    setGroups(userGroups);
  }, [user?.isAdmin]);

  useEffect(() => {
    runLoad(async () => {
      await Promise.all([fetchShareInfo(), fetchGroups()]);
    });
  }, [deviceId, user?.isAdmin]);

  // User search handler
  const handleSearchUsers = useCallback(async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const results = await authApi.searchUsers(query);
      // Filter out users who already have access
      const existingUserIds = new Set(shareInfo?.users.map(u => u.id) || []);
      setUserSearchResults(results.filter(u => !existingUserIds.has(u.id)));
    } catch (err) {
      log.error('Failed to search users', { err });
    } finally {
      setSearchingUsers(false);
    }
  }, [shareInfo]);

  // Share with user
  const handleShareWithUser = async (targetUserId: string) => {
    const result = await runSharing(async () => {
      await devicesApi.shareDeviceWithUser(deviceId, { targetUserId });
      await fetchShareInfo();
    });

    if (result !== null) {
      setUserSearchQuery('');
      setUserSearchResults([]);
    }
  };

  // Remove user access
  const handleRemoveUserAccess = async (targetUserId: string) => {
    await runSharing(async () => {
      await devicesApi.removeUserFromDevice(deviceId, targetUserId);
      await fetchShareInfo();
    });
  };

  // Share with group
  const handleAddGroup = async () => {
    const result = await runSharing(async () => {
      await devicesApi.shareDeviceWithGroup(deviceId, { groupId: selectedGroupToAdd });
      await fetchShareInfo();
    });

    if (result !== null) {
      setSelectedGroupToAdd('');
    }
  };

  // Remove group access
  const handleRemoveGroup = async () => {
    await runSharing(async () => {
      await devicesApi.shareDeviceWithGroup(deviceId, { groupId: null });
      await fetchShareInfo();
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="surface-elevated rounded-xl p-6 h-32 border border-sanctuary-200 dark:border-sanctuary-800" />
        <div className="surface-elevated rounded-xl p-6 h-48 border border-sanctuary-200 dark:border-sanctuary-800" />
        <div className="surface-elevated rounded-xl p-6 h-48 border border-sanctuary-200 dark:border-sanctuary-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Your Access Section */}
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium mb-4 flex items-center">
          <Shield className="w-5 h-5 mr-2 text-primary-500" />
          Your Access
        </h3>
        <div className="flex items-center justify-between p-4 surface-secondary rounded-lg">
          <div className="flex items-center">
            <div className="h-10 w-10 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-lg font-bold text-sanctuary-600 dark:text-sanctuary-300">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-4">
              <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {user?.username || 'You'}
              </p>
              <p className="text-xs text-sanctuary-500 capitalize">{userRole || 'Unknown'} Access</p>
            </div>
          </div>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
            userRole === 'owner'
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
              : 'bg-sanctuary-100 text-sanctuary-700 dark:bg-sanctuary-700 dark:text-sanctuary-300'
          }`}>
            {isOwner ? 'Full Control' : 'Read Only'}
          </span>
        </div>
      </div>

      {/* Ownership Section */}
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium mb-4 flex items-center">
          <Shield className="w-5 h-5 mr-2 text-primary-500" />
          Ownership
        </h3>
        <div className="flex items-center p-4 surface-secondary rounded-lg">
          <div className="flex items-center">
            <div className="h-10 w-10 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-lg font-bold text-sanctuary-600 dark:text-sanctuary-300">
              {shareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-4">
              <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {shareInfo?.users.find(u => u.role === 'owner')?.username || user?.username || 'You'}
              </p>
              <p className="text-xs text-sanctuary-500">Device Owner</p>
            </div>
          </div>
        </div>
      </div>

      {/* Group Sharing Section */}
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium flex items-center">
            <Users className="w-5 h-5 mr-2 text-primary-500" />
            Group Access
          </h3>
        </div>

        {/* Share with Group - only for owners */}
        {isOwner && !shareInfo?.group && (
          <div className="mb-6 p-4 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
            <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">Share with Group</p>
            <div className="flex space-x-2">
              <select
                value={selectedGroupToAdd}
                onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                className="flex-1 text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-3 py-2"
              >
                <option value="">Select Group...</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                onClick={handleAddGroup}
                disabled={!selectedGroupToAdd || sharingLoading}
                className="text-xs px-3 py-2 rounded-lg bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
              >
                Add as Viewer
              </button>
            </div>
            {groups.length === 0 && (
              <p className="text-xs text-sanctuary-400 mt-2">You are not a member of any groups yet.</p>
            )}
          </div>
        )}

        {/* Current Group */}
        {shareInfo?.group ? (
          <div className="border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg overflow-hidden">
            <div className="surface-secondary px-4 py-3 border-b border-sanctuary-200 dark:border-sanctuary-700 flex justify-between items-center">
              <div className="flex items-center">
                <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100 mr-2">{shareInfo.group.name}</span>
                <span className="text-xs px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                  Viewer
                </span>
              </div>
              {isOwner && (
                <button
                  onClick={handleRemoveGroup}
                  disabled={sharingLoading}
                  className="text-xs text-rose-500 hover:text-rose-700 flex items-center px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </button>
              )}
            </div>
            <div className="p-4 bg-sanctuary-50 dark:bg-sanctuary-900">
              <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                All members of this group have <span className="font-medium">Viewer</span> access to this device.
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-sanctuary-500 text-sm">
            Not shared with any group.
          </div>
        )}
      </div>

      {/* Individual User Sharing Section */}
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium flex items-center">
            <UserIcon className="w-5 h-5 mr-2 text-primary-500" />
            Individual Access
          </h3>
        </div>

        {/* Search and Add User - only for owners */}
        {isOwner && (
          <div className="mb-6 p-4 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
            <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">Share with User</p>
            <div className="relative">
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => handleSearchUsers(e.target.value)}
                placeholder="Search users by username..."
                className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-3 py-2"
              />
              {searchingUsers && (
                <div className="absolute right-3 top-2.5">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                </div>
              )}

              {/* Search Results Dropdown */}
              {userSearchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {userSearchResults.map(u => (
                    <div
                      key={u.id}
                      className="px-3 py-2 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center">
                        <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{u.username}</span>
                      </div>
                      <button
                        onClick={() => handleShareWithUser(u.id)}
                        disabled={sharingLoading}
                        className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                      >
                        Add as Viewer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current Users */}
        {shareInfo && shareInfo.users.filter(u => u.role !== 'owner').length > 0 ? (
          <div className="space-y-2">
            {shareInfo.users.filter(u => u.role !== 'owner').map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 surface-secondary rounded-lg">
                <div className="flex items-center">
                  <div className="h-8 w-8 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-sm font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-3">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{u.username}</p>
                    <p className="text-xs text-sanctuary-500 capitalize">{u.role}</p>
                  </div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleRemoveUserAccess(u.id)}
                    disabled={sharingLoading}
                    className="text-xs text-rose-500 hover:text-rose-700 flex items-center px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                  >
                    <X className="w-3 h-3 mr-1" /> Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-sanctuary-500 text-sm">
            Not shared with any individual users.
          </div>
        )}
      </div>
    </div>
  );
};
