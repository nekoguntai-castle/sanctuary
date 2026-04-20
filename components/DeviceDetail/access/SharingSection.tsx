import React from 'react';
import type { DeviceShareInfo } from '../../../types';
import type { SearchUser } from '../../../src/api/auth';
import {
  getSharedDeviceUsers,
  hasDeviceSharedAccess,
} from './accessSectionData';
import { SharedAccessList } from './SharedAccessList';
import { SharingControls } from './SharingControls';

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
  const sharedUsers = getSharedDeviceUsers(deviceShareInfo);

  return (
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
      {isOwner && (
        <SharingControls
          deviceShareInfo={deviceShareInfo}
          groups={groups}
          selectedGroupToAdd={selectedGroupToAdd}
          setSelectedGroupToAdd={setSelectedGroupToAdd}
          userSearchQuery={userSearchQuery}
          userSearchResults={userSearchResults}
          searchingUsers={searchingUsers}
          sharingLoading={sharingLoading}
          onSearchUsers={onSearchUsers}
          onShareWithUser={onShareWithUser}
          onAddGroup={onAddGroup}
        />
      )}
      <SharedAccessList
        group={deviceShareInfo?.group}
        sharedUsers={sharedUsers}
        hasSharedAccess={hasDeviceSharedAccess(deviceShareInfo, sharedUsers)}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
        onRemoveGroup={onRemoveGroup}
        onRemoveUserAccess={onRemoveUserAccess}
      />
    </div>
  );
};
