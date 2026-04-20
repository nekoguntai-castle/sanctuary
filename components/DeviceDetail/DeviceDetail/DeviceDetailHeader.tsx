import type React from 'react';
import { ArrowLeft, ChevronDown, Edit2, Save, Users, X } from 'lucide-react';
import type { Device, HardwareDevice, HardwareDeviceModel } from '../../../types';
import { getDeviceIcon } from '../../ui/CustomIcons';

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
  children,
}: DeviceDetailHeaderProps) {
  return (
    <>
      <BackToDevicesButton onBack={onBack} />
      <div className="surface-elevated rounded-xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex items-start space-x-6">
          <DeviceIconPanel deviceType={device.type} />
          <div className="flex-1">
            <div className="flex items-center justify-between">
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
              <DeviceFingerprint fingerprint={device.fingerprint} />
            </div>
            {children}
          </div>
        </div>
      </div>
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

type DeviceTitleAreaProps = Omit<DeviceDetailHeaderProps, 'onBack' | 'children'>;

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

function DeviceFingerprint({ fingerprint }: { fingerprint: string }) {
  return (
    <div className="text-right">
      <div className="text-xs text-sanctuary-400 uppercase tracking-wide">Master Fingerprint</div>
      <div className="text-xl font-mono text-sanctuary-700 dark:text-sanctuary-300">{fingerprint}</div>
    </div>
  );
}
