import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeviceAccountsSection } from './DeviceAccountsSection';
import { DeviceDetailHeader } from './DeviceDetailHeader';
import { DeviceDetailTabContent } from './DeviceDetailTabContent';
import { DeviceDetailTabs } from './DeviceDetailTabs';
import { DeviceTransferModal } from './DeviceTransferModal';
import type { DeviceDetailTab } from './types';
import type { useDeviceData } from '../hooks/useDeviceData';
import { useDeviceDeletion } from '../hooks/useDeviceDeletion';
import type { Device } from '../../../types';

type LoadedDeviceData = ReturnType<typeof useDeviceData> & { device: Device };

interface DeviceDetailContentProps {
  id: string;
  data: LoadedDeviceData;
}

export function DeviceDetailContent({ id, data }: DeviceDetailContentProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DeviceDetailTab>('details');
  const [showAddAccount, setShowAddAccount] = useState(false);

  const {
    device,
    setDevice,
    wallets,
    user,
    isEditing,
    setIsEditing,
    editLabel,
    setEditLabel,
    editModelSlug,
    setEditModelSlug,
    deviceModels,
    showTransferModal,
    setShowTransferModal,
    deviceShareInfo,
    groups,
    selectedGroupToAdd,
    setSelectedGroupToAdd,
    userSearchQuery,
    userSearchResults,
    searchingUsers,
    sharingLoading,
    isOwner,
    userRole,
    handleSave,
    cancelEdit,
    handleSearchUsers,
    handleShareWithUser,
    handleRemoveUserAccess,
    addGroup,
    removeGroup,
    handleTransferComplete,
    getDeviceDisplayName,
  } = data;

  const attachedWalletCount = Math.max(wallets.length, device.walletCount ?? 0);

  const {
    canDelete,
    deleteConfirmOpen,
    deletePending,
    deleteError,
    confirmDelete,
    requestDelete,
    cancelDelete,
  } = useDeviceDeletion({
    deviceId: device.id,
    attachedWalletCount,
    isOwner,
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <DeviceDetailHeader
        device={device}
        isEditing={isEditing}
        isOwner={isOwner}
        userRole={userRole}
        editLabel={editLabel}
        editModelSlug={editModelSlug}
        deviceModels={deviceModels}
        onBack={() => navigate('/devices')}
        onStartEditing={() => setIsEditing(true)}
        onEditLabelChange={setEditLabel}
        onEditModelSlugChange={setEditModelSlug}
        onSave={handleSave}
        onCancelEdit={cancelEdit}
        getDeviceDisplayName={getDeviceDisplayName}
        canDelete={canDelete}
        deleteConfirmOpen={deleteConfirmOpen}
        deletePending={deletePending}
        deleteError={deleteError}
        onRequestDelete={requestDelete}
        onConfirmDelete={confirmDelete}
        onCancelDelete={cancelDelete}
      >
        <DeviceAccountsSection
          deviceId={id}
          device={device}
          isOwner={isOwner}
          showAddAccount={showAddAccount}
          onShowAddAccount={() => setShowAddAccount(true)}
          onCloseAddAccount={() => setShowAddAccount(false)}
          onDeviceUpdated={setDevice}
        />
      </DeviceDetailHeader>
      <DeviceDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <DeviceDetailTabContent
        activeTab={activeTab}
        wallets={wallets}
        deviceId={id}
        isOwner={isOwner}
        username={user?.username}
        deviceShareInfo={deviceShareInfo}
        groups={groups}
        selectedGroupToAdd={selectedGroupToAdd}
        setSelectedGroupToAdd={setSelectedGroupToAdd}
        userSearchQuery={userSearchQuery}
        userSearchResults={userSearchResults}
        searchingUsers={searchingUsers}
        sharingLoading={sharingLoading}
        onSearchUsers={handleSearchUsers}
        onShareWithUser={handleShareWithUser}
        onRemoveUserAccess={handleRemoveUserAccess}
        onAddGroup={addGroup}
        onRemoveGroup={removeGroup}
        onTransfer={() => setShowTransferModal(true)}
        onTransferComplete={handleTransferComplete}
      />
      {showTransferModal && (
        <DeviceTransferModal
          device={device}
          onClose={() => setShowTransferModal(false)}
        />
      )}
    </div>
  );
}
