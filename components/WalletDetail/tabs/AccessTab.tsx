/**
 * AccessTab - Wallet access management with ownership, sharing, and transfers
 *
 * Provides three sub-tabs for managing wallet access:
 * - Ownership: view current owner, initiate ownership transfer
 * - Sharing: add/remove group and individual user access
 * - Transfers: view and manage pending ownership transfers
 */

import React from 'react';
import type { User } from '../../../types';
import type { WalletShareInfo } from '../../../src/api/wallets';
import type { UserGroup, SearchUser } from '../../../src/api/auth';
import type { AccessSubTab } from '../types';
import { AccessSubTabs } from './access/AccessSubTabs';
import { getWalletOwnerDisplay } from './access/accessTabData';
import { OwnershipSection } from './access/OwnershipSection';
import { SharingSection } from './access/SharingSection';
import { TransfersSection } from './access/TransfersSection';

interface AccessTabProps {
  accessSubTab: AccessSubTab;
  onAccessSubTabChange: (tab: AccessSubTab) => void;
  walletShareInfo: WalletShareInfo | null;
  userRole: string;
  user: User | null;
  onShowTransferModal: () => void;
  selectedGroupToAdd: string;
  onSelectedGroupToAddChange: (groupId: string) => void;
  groups: UserGroup[];
  sharingLoading: boolean;
  onAddGroup: (role: 'viewer' | 'signer') => void;
  onUpdateGroupRole: (role: 'viewer' | 'signer') => void;
  onRemoveGroup: () => void;
  userSearchQuery: string;
  onSearchUsers: (query: string) => void;
  searchingUsers: boolean;
  userSearchResults: SearchUser[];
  onShareWithUser: (userId: string, role: 'viewer' | 'signer') => void;
  onRemoveUserAccess: (userId: string) => void;
  walletId: string;
  onTransferComplete: () => void;
}

export const AccessTab: React.FC<AccessTabProps> = ({
  accessSubTab,
  onAccessSubTabChange,
  walletShareInfo,
  userRole,
  user,
  onShowTransferModal,
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
  walletId,
  onTransferComplete,
}) => {
  const isOwner = userRole === 'owner';
  const owner = getWalletOwnerDisplay(walletShareInfo, user);

  return (
    <div className="space-y-4">
      <AccessSubTabs activeTab={accessSubTab} onChange={onAccessSubTabChange} />
      {accessSubTab === 'ownership' && (
        <OwnershipSection
          owner={owner}
          isOwner={isOwner}
          onTransfer={onShowTransferModal}
        />
      )}
      {accessSubTab === 'sharing' && (
        <SharingSection
          walletShareInfo={walletShareInfo}
          isOwner={isOwner}
          selectedGroupToAdd={selectedGroupToAdd}
          onSelectedGroupToAddChange={onSelectedGroupToAddChange}
          groups={groups}
          sharingLoading={sharingLoading}
          onAddGroup={onAddGroup}
          onUpdateGroupRole={onUpdateGroupRole}
          onRemoveGroup={onRemoveGroup}
          userSearchQuery={userSearchQuery}
          onSearchUsers={onSearchUsers}
          searchingUsers={searchingUsers}
          userSearchResults={userSearchResults}
          onShareWithUser={onShareWithUser}
          onRemoveUserAccess={onRemoveUserAccess}
        />
      )}
      {accessSubTab === 'transfers' && (
        <TransfersSection
          walletId={walletId}
          onTransferComplete={onTransferComplete}
        />
      )}
    </div>
  );
};
