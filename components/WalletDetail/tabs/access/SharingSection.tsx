import React from 'react';
import type { UserGroup, SearchUser } from '../../../../src/api/auth';
import type { WalletShareInfo } from '../../../../src/api/wallets';
import {
  getSharedUsers,
  hasSharedAccess,
  type WalletAccessRole,
} from './accessTabData';
import { SharedAccessList } from './SharedAccessList';
import { SharingControls } from './SharingControls';

interface SharingSectionProps {
  walletShareInfo: WalletShareInfo | null;
  isOwner: boolean;
  selectedGroupToAdd: string;
  onSelectedGroupToAddChange: (groupId: string) => void;
  groups: UserGroup[];
  sharingLoading: boolean;
  onAddGroup: (role: WalletAccessRole) => void;
  onUpdateGroupRole: (role: WalletAccessRole) => void;
  onRemoveGroup: () => void;
  userSearchQuery: string;
  onSearchUsers: (query: string) => void;
  searchingUsers: boolean;
  userSearchResults: SearchUser[];
  onShareWithUser: (userId: string, role: WalletAccessRole) => void;
  onRemoveUserAccess: (userId: string) => void;
}

export const SharingSection: React.FC<SharingSectionProps> = ({
  walletShareInfo,
  isOwner,
  selectedGroupToAdd,
  onSelectedGroupToAddChange,
  groups,
  sharingLoading,
  onAddGroup,
  onUpdateGroupRole,
  onRemoveGroup,
  userSearchQuery,
  onSearchUsers,
  searchingUsers,
  userSearchResults,
  onShareWithUser,
  onRemoveUserAccess,
}) => {
  const sharedUsers = getSharedUsers(walletShareInfo);

  return (
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
      {isOwner && (
        <SharingControls
          walletShareInfo={walletShareInfo}
          groups={groups}
          selectedGroupToAdd={selectedGroupToAdd}
          onSelectedGroupToAddChange={onSelectedGroupToAddChange}
          sharingLoading={sharingLoading}
          onAddGroup={onAddGroup}
          userSearchQuery={userSearchQuery}
          onSearchUsers={onSearchUsers}
          searchingUsers={searchingUsers}
          userSearchResults={userSearchResults}
          onShareWithUser={onShareWithUser}
        />
      )}
      <SharedAccessList
        walletShareInfo={walletShareInfo}
        sharedUsers={sharedUsers}
        hasSharedAccess={hasSharedAccess(walletShareInfo, sharedUsers)}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
        onUpdateGroupRole={onUpdateGroupRole}
        onRemoveGroup={onRemoveGroup}
        onShareWithUser={onShareWithUser}
        onRemoveUserAccess={onRemoveUserAccess}
      />
    </div>
  );
};
