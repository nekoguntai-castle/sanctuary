import React from 'react';
import type { UserGroup, SearchUser } from '../../../../src/api/auth';
import type { WalletShareInfo } from '../../../../src/api/wallets';
import type { WalletAccessRole } from './accessTabData';
import { UserSharingSearch } from './UserSharingSearch';

interface GroupSharingPickerProps {
  hasExistingGroup: boolean;
  groups: UserGroup[];
  selectedGroupToAdd: string;
  onSelectedGroupToAddChange: (groupId: string) => void;
  sharingLoading: boolean;
  onAddGroup: (role: WalletAccessRole) => void;
}

const GroupSharingPicker: React.FC<GroupSharingPickerProps> = ({
  hasExistingGroup,
  groups,
  selectedGroupToAdd,
  onSelectedGroupToAddChange,
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
        onChange={(event) => onSelectedGroupToAddChange(event.target.value)}
        className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-md px-2 py-1.5"
      >
        <option value="">Add group...</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}</option>
        ))}
      </select>
      {selectedGroupToAdd && (
        <>
          <button
            onClick={() => onAddGroup('viewer')}
            disabled={sharingLoading}
            className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
          >
            Viewer
          </button>
          <button
            onClick={() => onAddGroup('signer')}
            disabled={sharingLoading}
            className="text-xs px-2 py-1 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 transition-colors disabled:opacity-50"
          >
            Signer
          </button>
        </>
      )}
    </div>
  );
};

interface SharingControlsProps {
  walletShareInfo: WalletShareInfo | null;
  groups: UserGroup[];
  selectedGroupToAdd: string;
  onSelectedGroupToAddChange: (groupId: string) => void;
  sharingLoading: boolean;
  onAddGroup: (role: WalletAccessRole) => void;
  userSearchQuery: string;
  onSearchUsers: (query: string) => void;
  searchingUsers: boolean;
  userSearchResults: SearchUser[];
  onShareWithUser: (userId: string, role: WalletAccessRole) => void;
}

export const SharingControls: React.FC<SharingControlsProps> = ({
  walletShareInfo,
  groups,
  selectedGroupToAdd,
  onSelectedGroupToAddChange,
  sharingLoading,
  onAddGroup,
  userSearchQuery,
  onSearchUsers,
  searchingUsers,
  userSearchResults,
  onShareWithUser,
}) => (
  <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
    <div className="flex flex-wrap gap-2">
      <GroupSharingPicker
        hasExistingGroup={Boolean(walletShareInfo?.group)}
        groups={groups}
        selectedGroupToAdd={selectedGroupToAdd}
        onSelectedGroupToAddChange={onSelectedGroupToAddChange}
        sharingLoading={sharingLoading}
        onAddGroup={onAddGroup}
      />
      <UserSharingSearch
        query={userSearchQuery}
        onSearchUsers={onSearchUsers}
        searchingUsers={searchingUsers}
        userSearchResults={userSearchResults}
        sharingLoading={sharingLoading}
        onShareWithUser={onShareWithUser}
      />
    </div>
  </div>
);
