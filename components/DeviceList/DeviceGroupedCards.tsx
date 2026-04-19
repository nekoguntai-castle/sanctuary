import React from 'react';
import { Edit2, HardDrive, Save, Trash2, Users, X } from 'lucide-react';
import type { Device, HardwareDevice, HardwareDeviceModel } from '../../types';
import { getDeviceIcon, getWalletIcon } from '../ui/CustomIcons';
import { EXCLUSIVE_BADGE_CLASS } from './types';
import type { DeviceGroupedDeleteState, DeviceGroupedEditState } from './types';

export function DeviceTypeGroupCard({
  type,
  devices,
  editState,
  deleteState,
  deviceModels,
  getDeviceDisplayName,
  getWalletCount,
  handleEdit,
  handleSave,
  handleDelete,
  walletFilter,
  exclusiveDeviceIds,
  onOpenDevice,
}: {
  type: string;
  devices: Device[];
  editState: DeviceGroupedEditState;
  deleteState: DeviceGroupedDeleteState;
  deviceModels: HardwareDeviceModel[];
  getDeviceDisplayName: (type: string) => string;
  getWalletCount: (device: Device) => number;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  handleDelete: (device: Device) => void;
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
  onOpenDevice: (deviceId: string) => void;
}) {
  const deviceType = type as HardwareDevice;

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-secondary flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-white dark:bg-sanctuary-700 rounded-lg shadow-sm text-sanctuary-600 dark:text-sanctuary-300">
            {getDeviceIcon(deviceType, 'w-6 h-6')}
          </div>
          <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{getDeviceDisplayName(type)}</h3>
        </div>
        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
          {devices.length}
        </span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
        <ul className="space-y-3">
          {devices.map(device => (
            <GroupedDeviceCard
              key={device.id}
              device={device}
              editState={editState}
              deleteState={deleteState}
              deviceModels={deviceModels}
              walletCount={getWalletCount(device)}
              handleEdit={handleEdit}
              handleSave={handleSave}
              handleDelete={handleDelete}
              walletFilter={walletFilter}
              exclusiveDeviceIds={exclusiveDeviceIds}
              onOpenDevice={onOpenDevice}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function GroupedDeviceCard({
  device,
  editState,
  deleteState,
  deviceModels,
  walletCount,
  handleEdit,
  handleSave,
  handleDelete,
  walletFilter,
  exclusiveDeviceIds,
  onOpenDevice,
}: {
  device: Device;
  editState: DeviceGroupedEditState;
  deleteState: DeviceGroupedDeleteState;
  deviceModels: HardwareDeviceModel[];
  walletCount: number;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  handleDelete: (device: Device) => void;
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
  onOpenDevice: (deviceId: string) => void;
}) {
  const isEditing = editState.editingId === device.id;

  return (
    <li
      onClick={() => onOpenDevice(device.id)}
      className="p-3 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-600 transition-colors surface-elevated cursor-pointer"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <DeviceTitleBlock
            device={device}
            isEditing={isEditing}
            walletCount={walletCount}
            editState={editState}
            deviceModels={deviceModels}
            handleEdit={handleEdit}
            handleSave={handleSave}
            onDeletePrompt={() => deleteState.setDeleteConfirmId(device.id)}
          />
          <div className="text-xs font-mono text-sanctuary-500">{device.fingerprint}</div>
        </div>

        {deleteState.deleteConfirmId === device.id && (
          <DeleteConfirmation
            device={device}
            onConfirm={handleDelete}
            onCancel={() => {
              deleteState.setDeleteConfirmId(null);
              deleteState.setDeleteError(null);
            }}
          />
        )}
      </div>

      <DeviceWalletBadges
        device={device}
        walletCount={walletCount}
        walletFilter={walletFilter}
        exclusiveDeviceIds={exclusiveDeviceIds}
      />
    </li>
  );
}

function DeviceTitleBlock({
  device,
  isEditing,
  walletCount,
  editState,
  deviceModels,
  handleEdit,
  handleSave,
  onDeletePrompt,
}: {
  device: Device;
  isEditing: boolean;
  walletCount: number;
  editState: DeviceGroupedEditState;
  deviceModels: HardwareDeviceModel[];
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  onDeletePrompt: () => void;
}) {
  if (isEditing) {
    return (
      <DeviceEditForm
        device={device}
        editState={editState}
        deviceModels={deviceModels}
        onSave={handleSave}
      />
    );
  }

  return (
    <DeviceDisplayName
      device={device}
      walletCount={walletCount}
      onEdit={() => handleEdit(device)}
      onDeletePrompt={onDeletePrompt}
    />
  );
}

function DeviceEditForm({
  device,
  editState,
  deviceModels,
  onSave,
}: {
  device: Device;
  editState: DeviceGroupedEditState;
  deviceModels: HardwareDeviceModel[];
  onSave: (device: Device) => void;
}) {
  return (
    <div className="flex flex-col space-y-1 mb-1" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center space-x-1">
        <input
          type="text"
          value={editState.editValue}
          onChange={(event) => editState.setEditValue(event.target.value)}
          className="w-full px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
          autoFocus
        />
        <button onClick={() => onSave(device)} className="p-1 text-emerald-600" aria-label="Save device">
          <Save className="w-3 h-3" />
        </button>
        <button onClick={() => editState.setEditingId(null)} className="p-1 text-rose-600" aria-label="Cancel editing">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center space-x-1">
        <label className="text-[10px] text-sanctuary-500">Type:</label>
        <select
          value={editState.editType}
          onChange={(event) => editState.setEditType(event.target.value)}
          className="flex-1 px-1 py-0.5 text-[10px] border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
        >
          <option value="">Unknown Device</option>
          {deviceModels.map(model => (
            <option key={model.slug} value={model.slug}>
              {model.manufacturer} {model.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function DeviceDisplayName({
  device,
  walletCount,
  onEdit,
  onDeletePrompt,
}: {
  device: Device;
  walletCount: number;
  onEdit: () => void;
  onDeletePrompt: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center group">
        <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate mr-2">{device.label}</span>
        {device.isOwner && (
          <DeviceOwnerActions
            canDelete={walletCount === 0}
            onEdit={onEdit}
            onDeletePrompt={onDeletePrompt}
          />
        )}
      </div>
      {!device.isOwner && device.sharedBy && (
        <span className="text-[10px] text-sanctuary-400 flex items-center gap-1">
          <Users className="w-2.5 h-2.5" />
          Shared by {device.sharedBy}
        </span>
      )}
    </div>
  );
}

function DeviceOwnerActions({
  canDelete,
  onEdit,
  onDeletePrompt,
}: {
  canDelete: boolean;
  onEdit: () => void;
  onDeletePrompt: () => void;
}) {
  return (
    <>
      <button onClick={(event) => { event.stopPropagation(); onEdit(); }} className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity">
        <Edit2 className="w-3 h-3" />
      </button>
      {canDelete && (
        <button
          onClick={(event) => { event.stopPropagation(); onDeletePrompt(); }}
          className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-rose-600 transition-opacity ml-1"
          title="Delete device"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </>
  );
}

function DeleteConfirmation({
  device,
  onConfirm,
  onCancel,
}: {
  device: Device;
  onConfirm: (device: Device) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center space-x-1" onClick={(event) => event.stopPropagation()}>
      <span className="text-[10px] text-rose-600">Delete?</span>
      <button
        onClick={() => onConfirm(device)}
        className="px-1 py-0.5 text-[10px] bg-rose-600 text-white rounded hover:bg-rose-700"
      >
        Yes
      </button>
      <button
        onClick={onCancel}
        className="px-1 py-0.5 text-[10px] bg-sanctuary-200 dark:bg-sanctuary-700 rounded hover:bg-sanctuary-300"
      >
        No
      </button>
    </div>
  );
}

function DeviceWalletBadges({
  device,
  walletCount,
  walletFilter,
  exclusiveDeviceIds,
}: {
  device: Device;
  walletCount: number;
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
}) {
  const showExclusive = walletFilter !== 'all' && walletFilter !== 'unassigned' && exclusiveDeviceIds.has(device.id);

  return (
    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-sanctuary-50 dark:border-sanctuary-800">
      {renderWalletBadges(device, walletCount)}
      {showExclusive && (
        <span className={EXCLUSIVE_BADGE_CLASS}>
          Exclusive
        </span>
      )}
    </div>
  );
}

function renderWalletBadges(device: Device, walletCount: number): React.ReactNode {
  if (device.wallets && device.wallets.length > 0) {
    return device.wallets.map(walletDevice => (
      <WalletAssociationBadge
        key={walletDevice.wallet.id}
        wallet={walletDevice.wallet}
      />
    ));
  }

  if (walletCount > 0) {
    return <WalletCountBadge walletCount={walletCount} />;
  }

  return <span className="text-[10px] text-sanctuary-300">Unused</span>;
}

function WalletAssociationBadge({
  wallet,
}: {
  wallet: {
    id: string;
    name: string;
    type?: string;
  };
}) {
  const walletType = wallet.type || 'single_sig';

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center ${walletBadgeClass(walletType)}`}>
      {getWalletIcon(walletType, 'w-2 h-2 mr-1 flex-shrink-0')}
      {wallet.name}
    </span>
  );
}

function WalletCountBadge({ walletCount }: { walletCount: number }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center bg-primary-100 text-primary-800 border border-primary-200 dark:bg-primary-500/10 dark:text-primary-300 dark:border-primary-500/20">
      <HardDrive className="w-2 h-2 mr-1 flex-shrink-0" />
      {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
    </span>
  );
}

function walletBadgeClass(walletType: string): string {
  return walletType === 'multi_sig'
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
}
