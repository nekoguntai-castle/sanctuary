import React from 'react';
import type { SearchUser } from '../../../src/api/auth';
import type { DeviceShareInfo } from '../../../types';

interface GroupDisplay {
  id: string;
  name: string;
}

interface GroupSharingPickerProps {
  hasExistingGroup: boolean;
  groups: GroupDisplay[];
  selectedGroupToAdd: string;
  setSelectedGroupToAdd: (id: string) => void;
  sharingLoading: boolean;
  onAddGroup: () => void;
}

const GroupSharingPicker: React.FC<GroupSharingPickerProps> = ({
  hasExistingGroup,
  groups,
  selectedGroupToAdd,
  setSelectedGroupToAdd,
  sharingLoading,
  onAddGroup,
}) => {
  if (hasExistingGroup) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedGroupToAdd}
        onChange={(event) => setSelectedGroupToAdd(event.target.value)}
        className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-md px-2 py-1.5"
      >
        <option value="">Add group...</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}</option>
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
  );
};

interface UserSharingSearchProps {
  userSearchQuery: string;
  userSearchResults: SearchUser[];
  searchingUsers: boolean;
  sharingLoading: boolean;
  onSearchUsers: (query: string) => void;
  onShareWithUser: (userId: string) => void;
}

const UserSharingSearch: React.FC<UserSharingSearchProps> = ({
  userSearchQuery,
  userSearchResults,
  searchingUsers,
  sharingLoading,
  onSearchUsers,
  onShareWithUser,
}) => (
  <div className="flex-1 min-w-[200px] relative">
    <input
      type="text"
      value={userSearchQuery}
      onChange={(event) => onSearchUsers(event.target.value)}
      placeholder="Add user..."
      className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-md px-2 py-1.5"
    />
    {searchingUsers && (
      <div className="absolute right-2 top-2">
        <div className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent" />
      </div>
    )}
    {userSearchResults.length > 0 && (
      <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
        {userSearchResults.map((user) => (
          <div key={user.id} className="px-2 py-1.5 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 flex items-center justify-between">
            <div className="flex items-center">
              <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm">{user.username}</span>
            </div>
            <button
              onClick={() => onShareWithUser(user.id)}
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
);

interface SharingControlsProps {
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
  onAddGroup: () => void;
}

export const SharingControls: React.FC<SharingControlsProps> = ({
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
  onAddGroup,
}) => (
  <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
    <div className="flex flex-wrap gap-2">
      <GroupSharingPicker
        hasExistingGroup={Boolean(deviceShareInfo?.group)}
        groups={groups}
        selectedGroupToAdd={selectedGroupToAdd}
        setSelectedGroupToAdd={setSelectedGroupToAdd}
        sharingLoading={sharingLoading}
        onAddGroup={onAddGroup}
      />
      <UserSharingSearch
        userSearchQuery={userSearchQuery}
        userSearchResults={userSearchResults}
        searchingUsers={searchingUsers}
        sharingLoading={sharingLoading}
        onSearchUsers={onSearchUsers}
        onShareWithUser={onShareWithUser}
      />
    </div>
  </div>
);
