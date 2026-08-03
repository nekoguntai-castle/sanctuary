import type React from 'react';
import { ArrowLeft, ChevronDown, Edit2, Save, Trash2, Users, X } from 'lucide-react';
import type { Device, HardwareDevice, HardwareDeviceModel } from '../../../types';
import { Button } from '../../ui/Button';
import { getDeviceIcon } from '../../ui/CustomIcons';
import { Card } from '../../ui/Card';

type DeviceDetailHeaderProps = {
  device: Device;
  isEditing: boolean;
  isOwner: boolean;
  userRole: string;
  editLabel: string;
  editModelSlug: string;
  deviceModels: HardwareDeviceModel[];
  onBack: () => void;
  onStartEditing: () => void;
  onEditLabelChange: (label: string) => void;
  onEditModelSlugChange: (slug: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  getDeviceDisplayName: (type: string) => string;
  canDelete: boolean;
  deleteConfirmOpen: boolean;
  deletePending: boolean;
  deleteError: string | null;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  children?: React.ReactNode;
};

export function DeviceDetailHeader({
  device,
  isEditing,
  isOwner,
  userRole,
  editLabel,
  editModelSlug,
  deviceModels,
  onBack,
  onStartEditing,
  onEditLabelChange,
  onEditModelSlugChange,
  onSave,
  onCancelEdit,
  getDeviceDisplayName,
  canDelete,
  deleteConfirmOpen,
  deletePending,
  deleteError,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  children,
}: DeviceDetailHeaderProps) {
  return (
    <>
      <BackToDevicesButton onBack={onBack} />
      <Card padding="lg">
        <div className="flex items-start space-x-6">
          <DeviceIconPanel deviceType={device.type} />
          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <DeviceTitleArea
                device={device}
                isEditing={isEditing}
                isOwner={isOwner}
                userRole={userRole}
                editLabel={editLabel}
                editModelSlug={editModelSlug}
                deviceModels={deviceModels}
                onStartEditing={onStartEditing}
                onEditLabelChange={onEditLabelChange}
                onEditModelSlugChange={onEditModelSlugChange}
                onSave={onSave}
                onCancelEdit={onCancelEdit}
                getDeviceDisplayName={getDeviceDisplayName}
              />
              <DeviceHeaderActions
                canDelete={canDelete}
                deleteConfirmOpen={deleteConfirmOpen}
                deletePending={deletePending}
                deleteError={deleteError}
                fingerprint={device.fingerprint}
                onRequestDelete={onRequestDelete}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
              />
            </div>
            {children}
          </div>
        </div>
      </Card>
    </>
  );
}

function BackToDevicesButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
    >
      <ArrowLeft className="w-4 h-4 mr-1" />
      Back to Devices
    </button>
  );
}

function DeviceIconPanel({ deviceType }: { deviceType: Device['type'] }) {
  return (
    <div className="p-4 rounded-lg surface-secondary text-sanctuary-600 dark:text-sanctuary-300">
      {getDeviceIcon(deviceType as HardwareDevice, 'w-12 h-12')}
    </div>
  );
}

type DeviceTitleAreaProps = Omit<
  DeviceDetailHeaderProps,
  | 'onBack'
  | 'children'
  | 'canDelete'
  | 'deleteConfirmOpen'
  | 'deletePending'
  | 'deleteError'
  | 'onRequestDelete'
  | 'onConfirmDelete'
  | 'onCancelDelete'
>;

function DeviceTitleArea({
  device,
  isEditing,
  isOwner,
  userRole,
  editLabel,
  editModelSlug,
  deviceModels,
  onStartEditing,
  onEditLabelChange,
  onEditModelSlugChange,
  onSave,
  onCancelEdit,
  getDeviceDisplayName,
}: DeviceTitleAreaProps) {
  return (
    <div>
      <div className="flex items-center space-x-2">
        {isEditing ? (
          <DeviceTitleEditor
            editLabel={editLabel}
            onEditLabelChange={onEditLabelChange}
            onSave={onSave}
            onCancelEdit={onCancelEdit}
          />
        ) : (
          <DeviceTitleReadOnly
            device={device}
            isOwner={isOwner}
            userRole={userRole}
            onStartEditing={onStartEditing}
          />
        )}
      </div>
      <SharedByIndicator device={device} isOwner={isOwner} />
      {isEditing ? (
        <DeviceTypeEditor
          editModelSlug={editModelSlug}
          deviceModels={deviceModels}
          onEditModelSlugChange={onEditModelSlugChange}
        />
      ) : (
        <p className="text-sanctuary-500 mt-1 text-sm">{getDeviceDisplayName(device.type)}</p>
      )}
    </div>
  );
}

function DeviceTitleEditor({
  editLabel,
  onEditLabelChange,
  onSave,
  onCancelEdit,
}: Pick<DeviceDetailHeaderProps, 'editLabel' | 'onEditLabelChange' | 'onSave' | 'onCancelEdit'>) {
  return (
    <div className="flex items-center space-x-2">
      <input
        value={editLabel}
        onChange={event => onEditLabelChange(event.target.value)}
        className="px-2 py-1 border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted text-xl font-light focus:outline-none"
      />
      <button onClick={onSave} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors" aria-label="Save label">
        <Save className="w-5 h-5" />
      </button>
      <button onClick={onCancelEdit} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors" aria-label="Cancel editing">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function DeviceTitleReadOnly({
  device,
  isOwner,
  userRole,
  onStartEditing,
}: {
  device: Device;
  isOwner: boolean;
  userRole: string;
  onStartEditing: () => void;
}) {
  return (
    <>
      <h1 className="text-3xl font-medium text-sanctuary-900 dark:text-sanctuary-50">{device.label}</h1>
      <DeviceRoleBadge userRole={userRole} />
      {isOwner && (
        <button onClick={onStartEditing} className="text-sanctuary-400 hover:text-sanctuary-600 p-1" aria-label="Edit label">
          <Edit2 className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

function DeviceRoleBadge({ userRole }: { userRole: string }) {
  const owner = userRole === 'owner';
  const className = owner
    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
    : 'bg-sanctuary-100 text-sanctuary-700 dark:bg-sanctuary-700 dark:text-sanctuary-300';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {owner ? 'Owner' : 'Viewer'}
    </span>
  );
}

function SharedByIndicator({ device, isOwner }: { device: Device; isOwner: boolean }) {
  if (isOwner || !device.sharedBy) {
    return null;
  }

  return (
    <span className="text-xs text-sanctuary-400 flex items-center gap-1 mt-1">
      <Users className="w-3 h-3" />
      Shared by {device.sharedBy}
    </span>
  );
}

function DeviceTypeEditor({
  editModelSlug,
  deviceModels,
  onEditModelSlugChange,
}: Pick<DeviceDetailHeaderProps, 'editModelSlug' | 'deviceModels' | 'onEditModelSlugChange'>) {
  return (
    <div className="mt-2">
      <label className="text-xs text-sanctuary-500 uppercase mb-1 block">Device Type</label>
      <div className="relative">
        <select
          value={editModelSlug}
          onChange={event => onEditModelSlugChange(event.target.value)}
          className="w-full px-3 py-2 pr-8 border border-sanctuary-300 dark:border-sanctuary-700 rounded-md surface-muted text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
        >
          <option value="">Unknown Device</option>
          {deviceModels.map(model => (
            <option key={model.slug} value={model.slug}>
              {model.manufacturer} {model.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
      </div>
    </div>
  );
}

function DeviceHeaderActions({
  canDelete,
  deleteConfirmOpen,
  deletePending,
  deleteError,
  fingerprint,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  canDelete: boolean;
  deleteConfirmOpen: boolean;
  deletePending: boolean;
  deleteError: string | null;
  fingerprint: string;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-2 min-w-fit">
      <div className="flex items-start gap-3">
        {canDelete && (
          <DeviceDeleteAction
            deleteConfirmOpen={deleteConfirmOpen}
            deletePending={deletePending}
            onRequestDelete={onRequestDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
          />
        )}
        <DeviceFingerprint fingerprint={fingerprint} />
      </div>
      {deleteError && (
        <p className="max-w-xs text-right text-xs text-rose-600 dark:text-rose-300">{deleteError}</p>
      )}
    </div>
  );
}

function DeviceDeleteAction({
  deleteConfirmOpen,
  deletePending,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  deleteConfirmOpen: boolean;
  deletePending: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  if (deleteConfirmOpen) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
        <span className="text-rose-700 dark:text-rose-200">Delete?</span>
        <Button
          onClick={onConfirmDelete}
          disabled={deletePending}
          variant="danger"
          size="sm"
          className="px-2 py-1"
          aria-label="Confirm delete device"
        >
          {deletePending ? 'Deleting' : 'Delete'}
        </Button>
        <Button
          onClick={onCancelDelete}
          disabled={deletePending}
          variant="secondary"
          size="sm"
          className="px-2 py-1"
          aria-label="Cancel delete device"
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={onRequestDelete}
      variant="ghost"
      size="sm"
      className="p-2 text-sanctuary-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
      aria-label="Delete device"
      title="Delete device"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function DeviceFingerprint({ fingerprint }: { fingerprint: string }) {
  return (
    <div className="text-right">
      <div className="text-xs text-sanctuary-400 uppercase tracking-wide">Master Fingerprint</div>
      <div className="text-xl font-mono text-sanctuary-700 dark:text-sanctuary-300">{fingerprint}</div>
    </div>
  );
}
