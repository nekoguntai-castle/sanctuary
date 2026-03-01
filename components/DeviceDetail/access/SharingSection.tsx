import React from 'react';
import { Users, X } from 'lucide-react';
import type { DeviceShareInfo } from '../../../types';
import type { SearchUser } from '../../../src/api/auth';

interface GroupDisplay {
  id: string;
  name: string;
}

interface SharingSectionProps {
  isOwner: boolean;
  deviceShareInfo: DeviceShareInfo | null;
  groups: GroupDisplay[];
  selectedGroupToAdd: string;
  setSelectedGroupToAdd: (id: string) => void;
  userSearchQuery: string;
  userSearchResults: SearchUser[];
  searchingUsers: boolean;
  sharingLoading: boolean;
  onSearchUsers: (query: string) => void;
  onShareWithUser: (userId: string) => void;
  onRemoveUserAccess: (userId: string) => void;
  onAddGroup: () => void;
  onRemoveGroup: () => void;
}

export const SharingSection: React.FC<SharingSectionProps> = ({
  isOwner,
  deviceShareInfo,
  groups,
  selectedGroupToAdd,
  setSelectedGroupToAdd,
  userSearchQuery,
  userSearchResults,
  searchingUsers,
  sharingLoading,
  onSearchUsers,
  onShareWithUser,
  onRemoveUserAccess,
  onAddGroup,
  onRemoveGroup,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
      {/* Add sharing controls - only for owners */}
      {isOwner && (
        <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
          <div className="flex flex-wrap gap-2">
            {/* Group sharing */}
            {!deviceShareInfo?.group && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedGroupToAdd}
                  onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                  className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                >
                  <option value="">Add group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                {selectedGroupToAdd && (
                  <button
                    onClick={onAddGroup}
                    disabled={sharingLoading}
                    className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                  >
                    Add as Viewer
                  </button>
                )}
              </div>
            )}
            {/* User sharing */}
            <div className="flex-1 min-w-[200px] relative">
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => onSearchUsers(e.target.value)}
                placeholder="Add user..."
                className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
              />
              {searchingUsers && (
                <div className="absolute right-2 top-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                </div>
              )}
              {userSearchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {userSearchResults.map(u => (
                    <div key={u.id} className="px-2 py-1.5 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm">{u.username}</span>
                      </div>
                      <button
                        onClick={() => onShareWithUser(u.id)}
                        disabled={sharingLoading}
                        className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50"
                      >
                        Add as Viewer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Current shared access */}
      <div className="space-y-2">
        {/* Group */}
        {deviceShareInfo?.group && (
          <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
            <div className="flex items-center">
              <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
              <span className="text-sm font-medium">{deviceShareInfo.group.name}</span>
              <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                Viewer
              </span>
            </div>
            {isOwner && (
              <button
                onClick={onRemoveGroup}
                disabled={sharingLoading}
                className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Individual users */}
        {deviceShareInfo?.users.filter(u => u.role !== 'owner').map(u => (
          <div key={u.id} className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
            <div className="flex items-center">
              <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                {u.username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium">{u.username}</span>
              <span className="ml-2 text-xs text-sanctuary-500 capitalize">{u.role}</span>
            </div>
            {isOwner && (
              <button
                onClick={() => onRemoveUserAccess(u.id)}
                disabled={sharingLoading}
                className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}

        {/* Empty state */}
        {!deviceShareInfo?.group && (!deviceShareInfo?.users || deviceShareInfo.users.filter(u => u.role !== 'owner').length === 0) && (
          <div className="text-center py-6 text-sanctuary-400 text-sm">
            Not shared with anyone yet.
          </div>
        )}
      </div>
    </div>
  );
};
