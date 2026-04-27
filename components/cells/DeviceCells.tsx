/**
 * Device Cell Renderers
 *
 * Cell components for the DeviceList ConfigurableTable.
 * Uses a factory pattern to inject shared dependencies (device models, editing state, handlers).
 */

import React from 'react';
import { HardwareDevice, HardwareDeviceModel, Device } from '../../types';
import { Edit2, Save, X, Trash2, Users, HardDrive } from 'lucide-react';
import { getDeviceIcon, getWalletIcon } from '../ui/CustomIcons';
import type { CellRendererProps } from '../ui/ConfigurableTable';
import { EXCLUSIVE_BADGE_CLASS } from '../DeviceList/types';
import {
  canDeleteDevice,
  getAccountBadgeClass,
  getDeviceWalletCount,
  getWalletBadgeClass,
  hasExclusiveBadge,
} from './DeviceCellHelpers';

// Extended device type with wallet count for display
export interface DeviceWithWallets extends Device {
  // walletCount comes from API, fallback to computed from wallets array
}

// Edit state interface
interface EditState {
  editingId: string | null;
  editValue: string;
  editType: string;
  setEditingId: (id: string | null) => void;
  setEditValue: (value: string) => void;
  setEditType: (type: string) => void;
}

// Delete state interface
interface DeleteState {
  deleteConfirmId: string | null;
  deleteError: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  setDeleteError: (error: string | null) => void;
}

// Handlers interface
interface DeviceHandlers {
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  handleDelete: (device: Device) => void;
}

// Get display name helper
interface DeviceModelsHelper {
  getDeviceDisplayName: (type: string) => string;
  deviceModels: HardwareDeviceModel[];
}

// Filter context for wallet filter + exclusive badge
interface FilterContext {
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
}

/**
 * Create device cell renderers with injected dependencies
 */
export function createDeviceCellRenderers(
  editState: EditState,
  deleteState: DeleteState,
  handlers: DeviceHandlers,
  modelsHelper: DeviceModelsHelper,
  filterContext?: FilterContext
) {
  const { editingId, editValue, editType, setEditingId, setEditValue, setEditType } = editState;
  const { deleteConfirmId, deleteError, setDeleteConfirmId, setDeleteError } = deleteState;
  const { handleEdit, handleSave, handleDelete } = handlers;
  const { getDeviceDisplayName, deviceModels } = modelsHelper;

  // Label Cell - Icon + label (editable) + shared info
  const LabelCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    const isEditing = editingId === device.id;

    return (
      <div className="flex items-center">
        <div className="flex-shrink-0 h-8 w-8 rounded-full surface-secondary flex items-center justify-center text-sanctuary-600 dark:text-sanctuary-300">
          {getDeviceIcon(device.type as HardwareDevice, "w-4 h-4")}
        </div>
        <div className="ml-4">
          {isEditing ? (
            <div className="flex flex-col space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Label"
                  className="px-2 py-1 text-sm border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                  autoFocus
                />
                <button
                  onClick={() => handleSave(device)}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors"
                  aria-label="Save device"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors"
                  aria-label="Cancel editing"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-xs text-sanctuary-500">Type:</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
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
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center group">
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {device.label}
                </span>
                {device.isOwner && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(device);
                    }}
                    className="ml-2 opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              {!device.isOwner && device.sharedBy && (
                <span className="text-xs text-sanctuary-400 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  Shared by {device.sharedBy}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Type Cell - Device model name
  const TypeCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    return (
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
        {getDeviceDisplayName(device.type)}
      </span>
    );
  };

  // Fingerprint Cell - Monospace display
  const FingerprintCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    return (
      <span className="font-mono text-xs surface-secondary px-2 py-1 rounded text-sanctuary-600 dark:text-sanctuary-400">
        {device.fingerprint}
      </span>
    );
  };

  // Accounts Cell - Shows derivation paths with singlesig/multisig tags
  // Color coded: warning (amber) for multisig, success (green) for single-sig
  // Note: Dark mode uses inverted color scales in this theme (low numbers are dark, high numbers are light)
  const AccountsCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    const accounts = device.accounts || [];

    if (accounts.length === 0) {
      // Fallback to legacy derivation path display
      if (device.derivationPath) {
        const isMultisig = device.derivationPath.includes("48'");
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono ${getAccountBadgeClass(isMultisig ? 'multisig' : 'single_sig')}`}>
            {device.derivationPath}
          </span>
        );
      }
      return <span className="text-xs text-sanctuary-400">None</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {accounts.map((account) => (
          <span
            key={account.id}
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono ${getAccountBadgeClass(account.purpose)}`}
            title={`${account.purpose === 'multisig' ? 'Multisig' : 'Single-sig'} (${account.scriptType})`}
          >
            {account.derivationPath}
          </span>
        ))}
      </div>
    );
  };

  // Wallets Cell - Shows wallet names (supports multiple wallets per device)
  // Color coded: warning (amber) for multisig, success (green) for single-sig
  const WalletsCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    const wallets = device.wallets || [];
    const count = getDeviceWalletCount(device);
    const isExclusive = hasExclusiveBadge(filterContext, device.id);

    if (count === 0) {
      return <span className="text-xs text-sanctuary-400">Unused</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {wallets.map((wd) => {
          const walletType = wd.wallet.type || 'single_sig';
          return (
            <span
              key={wd.wallet.id}
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getWalletBadgeClass(walletType)}`}
            >
              {getWalletIcon(walletType, 'w-3 h-3 mr-1 flex-shrink-0')}
              {wd.wallet.name}
            </span>
          );
        })}
        {/* Fallback if wallets array is empty but count > 0 (legacy data) */}
        {wallets.length === 0 && count > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 border border-primary-200 dark:bg-primary-500/10 dark:text-primary-300 dark:border-primary-500/20">
            <HardDrive className="w-3 h-3 mr-1" />
            {count} {count === 1 ? 'wallet' : 'wallets'}
          </span>
        )}
        {isExclusive && (
          <span className={EXCLUSIVE_BADGE_CLASS}>
            Exclusive
          </span>
        )}
      </div>
    );
  };

  // Actions Cell - Delete button with confirmation
  const ActionsCell: React.FC<CellRendererProps<DeviceWithWallets>> = ({ item: device }) => {
    // Only show delete for owned devices with no wallets
    if (!canDeleteDevice(device)) {
      return null;
    }

    return (
      <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
        {deleteConfirmId === device.id ? (
          <div className="flex items-center space-x-2 bg-rose-50 dark:bg-rose-900/30 p-2 rounded-lg">
            <span className="text-xs text-rose-700 dark:text-rose-300">Delete?</span>
            <button
              onClick={() => handleDelete(device)}
              className="px-2 py-1 text-xs bg-rose-600 text-white rounded hover:bg-rose-700 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => {
                setDeleteConfirmId(null);
                setDeleteError(null);
              }}
              className="px-2 py-1 text-xs bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300 rounded hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setDeleteConfirmId(device.id)}
            className="p-2 text-sanctuary-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
            title="Delete device"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {deleteError && deleteConfirmId === device.id && (
          <div className="absolute right-0 top-full mt-1 p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-xs rounded shadow-lg z-10 whitespace-nowrap">
            {deleteError}
          </div>
        )}
      </div>
    );
  };

  return {
    label: LabelCell,
    type: TypeCell,
    fingerprint: FingerprintCell,
    accounts: AccountsCell,
    wallets: WalletsCell,
    actions: ActionsCell,
  };
}
