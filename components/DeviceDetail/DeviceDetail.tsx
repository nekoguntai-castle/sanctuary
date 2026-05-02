import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DeviceAccountsSection } from './DeviceDetail/DeviceAccountsSection';
import { DeviceDetailHeader } from './DeviceDetail/DeviceDetailHeader';
import {
  DeviceDetailLoadingState,
  DeviceDetailNotFoundState,
} from './DeviceDetail/DeviceDetailStates';
import { DeviceDetailTabContent } from './DeviceDetail/DeviceDetailTabContent';
import { DeviceDetailTabs } from './DeviceDetail/DeviceDetailTabs';
import { DeviceTransferModal } from './DeviceDetail/DeviceTransferModal';
import type { DeviceDetailTab } from './DeviceDetail/types';
import { useDeviceData } from './hooks/useDeviceData';
import { deleteDevice } from '../../src/api/devices';
import { extractErrorMessage } from '../../utils/errorHandler';
import { createLogger } from '../../utils/logger';

const log = createLogger('DeviceDetail');

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DeviceDetailTab>('details');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    device,
    setDevice,
    wallets,
    loading,
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
  } = useDeviceData(id);

  if (loading) return <DeviceDetailLoadingState />;
  if (!device) return <DeviceDetailNotFoundState />;

  const attachedWalletCount = Math.max(wallets.length, device.walletCount ?? 0);
  const canDeleteDevice = isOwner && attachedWalletCount === 0;

  const handleDeleteDevice = async () => {
    try {
      setDeletePending(true);
      setDeleteError(null);
      await deleteDevice(device.id);
      navigate('/devices', { replace: true });
    } catch (error) {
      log.error('Failed to delete device', { error });
      setDeleteError(extractErrorMessage(error, 'Failed to delete device'));
      setDeletePending(false);
    }
  };

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
        canDelete={canDeleteDevice}
        deleteConfirmOpen={deleteConfirmOpen}
        deletePending={deletePending}
        deleteError={deleteError}
        onRequestDelete={() => {
          setDeleteConfirmOpen(true);
          setDeleteError(null);
        }}
        onConfirmDelete={handleDeleteDevice}
        onCancelDelete={() => {
          setDeleteConfirmOpen(false);
          setDeleteError(null);
        }}
      >
        <DeviceAccountsSection
          deviceId={id!}
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
        deviceId={id!}
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
      {showTransferModal && <DeviceTransferModal device={device} onClose={() => setShowTransferModal(false)} />}
    </div>
  );
};
