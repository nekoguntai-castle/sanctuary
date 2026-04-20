import type { DeviceShareInfo } from '../../../types';
import type { SearchUser } from '../../../src/api/auth';
import type { GroupDisplay, WalletInfo } from '../hooks/useDeviceData';
import { AccessTab } from '../tabs/AccessTab';
import { DetailsTab } from '../tabs/DetailsTab';
import type { DeviceDetailTab } from './types';

type DeviceDetailTabContentProps = {
  activeTab: DeviceDetailTab;
  wallets: WalletInfo[];
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
};

export function DeviceDetailTabContent({
  activeTab,
  wallets,
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
}: DeviceDetailTabContentProps) {
  if (activeTab === 'details') {
    return <DetailsTab wallets={wallets} />;
  }

  return (
    <AccessTab
      deviceId={deviceId}
      isOwner={isOwner}
      username={username}
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
      onTransfer={onTransfer}
      onTransferComplete={onTransferComplete}
    />
  );
}
