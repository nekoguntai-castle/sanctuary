import React, { useState } from 'react';
import type { DeviceShareInfo } from '../../../types';
import type { SearchUser } from '../../../src/api/auth';
import { OwnershipSection } from '../access/OwnershipSection';
import { SharingSection } from '../access/SharingSection';
import { TransfersSection } from '../access/TransfersSection';

interface GroupDisplay {
  id: string;
  name: string;
}

interface AccessTabProps {
  deviceId: string;
  isOwner: boolean;
  username: string | undefined;
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
  onTransfer: () => void;
  onTransferComplete: () => void;
}

export const AccessTab: React.FC<AccessTabProps> = ({
  deviceId,
  isOwner,
  username,
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
  onTransfer,
  onTransferComplete,
}) => {
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
        {(['ownership', 'sharing', 'transfers'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setAccessSubTab(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
              accessSubTab === tab
                ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Ownership Sub-tab */}
      {accessSubTab === 'ownership' && (
        <OwnershipSection
          deviceShareInfo={deviceShareInfo}
          username={username}
          isOwner={isOwner}
          onTransfer={onTransfer}
        />
      )}

      {/* Sharing Sub-tab */}
      {accessSubTab === 'sharing' && (
        <SharingSection
          isOwner={isOwner}
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
          onRemoveUserAccess={onRemoveUserAccess}
          onAddGroup={onAddGroup}
          onRemoveGroup={onRemoveGroup}
        />
      )}

      {/* Transfers Sub-tab */}
      {accessSubTab === 'transfers' && (
        <TransfersSection
          deviceId={deviceId}
          onTransferComplete={onTransferComplete}
        />
      )}
    </div>
  );
};
