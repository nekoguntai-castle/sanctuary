/**
 * DeviceList Grouped View
 *
 * Displays devices grouped by type in a card layout.
 */

import React from 'react';
import { HardDrive, Edit2, Save, X, Trash2, Users } from 'lucide-react';
import { HardwareDevice, HardwareDeviceModel, Device } from '../../types';
import { getDeviceIcon, getWalletIcon } from '../ui/CustomIcons';
import { useNavigate } from 'react-router-dom';

interface EditState {
  editingId: string | null;
  editValue: string;
  editType: string;
  setEditingId: (id: string | null) => void;
  setEditValue: (value: string) => void;
  setEditType: (value: string) => void;
}

interface DeleteState {
  deleteConfirmId: string | null;
  deleteError: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  setDeleteError: (error: string | null) => void;
}

interface DeviceGroupedViewProps {
  groupedDevices: Record<string, Device[]>;
  editState: EditState;
  deleteState: DeleteState;
  deviceModels: HardwareDeviceModel[];
  getDeviceDisplayName: (type: string) => string;
  getWalletCount: (device: Device) => number;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  handleDelete: (device: Device) => void;
}

export const DeviceGroupedView: React.FC<DeviceGroupedViewProps> = ({
  groupedDevices,
  editState,
  deleteState,
  deviceModels,
  getDeviceDisplayName,
  getWalletCount,
  handleEdit,
  handleSave,
  handleDelete,
}) => {
  const navigate = useNavigate();
  const { editingId, editValue, editType, setEditingId, setEditValue, setEditType } = editState;
  const { deleteConfirmId, setDeleteConfirmId, setDeleteError } = deleteState;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-fade-in">
       {(Object.entries(groupedDevices) as [string, Device[]][]).map(([type, groupDevices]) => {
          const deviceType = type as HardwareDevice;
          return (
            <div key={type} className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden flex flex-col h-full">
                {/* Header */}
                <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-secondary flex items-center justify-between">
                   <div className="flex items-center space-x-3">
                      <div className="p-2 bg-white dark:bg-sanctuary-700 rounded-lg shadow-sm text-sanctuary-600 dark:text-sanctuary-300">
                         {getDeviceIcon(deviceType, "w-6 h-6")}
                      </div>
                      <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{getDeviceDisplayName(type)}</h3>
                   </div>
                   <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                      {groupDevices.length}
                   </span>
                </div>

                {/* Device List */}
                <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
                    <ul className="space-y-3">
                       {groupDevices.map(device => {
                          const walletCount = getWalletCount(device);
                          const isEditing = editingId === device.id;

                          return (
                             <li
                               key={device.id}
                               onClick={() => navigate(`/devices/${device.id}`)}
                               className="p-3 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-600 transition-colors surface-elevated cursor-pointer"
                             >
                                 <div className="flex justify-between items-start mb-2">
                                    <div className="flex-1 min-w-0">
                                        {isEditing ? (
                                            <div className="flex flex-col space-y-1 mb-1" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center space-x-1">
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
                                                        autoFocus
                                                    />
                                                    <button onClick={() => handleSave(device)} className="p-1 text-emerald-600" aria-label="Save device"><Save className="w-3 h-3" /></button>
                                                    <button onClick={() => setEditingId(null)} className="p-1 text-rose-600" aria-label="Cancel editing"><X className="w-3 h-3" /></button>
                                                </div>
                                                <div className="flex items-center space-x-1">
                                                    <label className="text-[10px] text-sanctuary-500">Type:</label>
                                                    <select
                                                        value={editType}
                                                        onChange={(e) => setEditType(e.target.value)}
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
                                        ) : (
                                            <div className="flex flex-col">
                                              <div className="flex items-center group">
                                                <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate mr-2">{device.label}</span>
                                                {device.isOwner && (
                                                  <>
                                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(device); }} className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                                                    {walletCount === 0 && (
                                                      <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(device.id); }}
                                                        className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-rose-600 transition-opacity ml-1"
                                                        title="Delete device"
                                                      >
                                                        <Trash2 className="w-3 h-3" />
                                                      </button>
                                                    )}
                                                  </>
                                                )}
                                              </div>
                                              {!device.isOwner && device.sharedBy && (
                                                <span className="text-[10px] text-sanctuary-400 flex items-center gap-1">
                                                  <Users className="w-2.5 h-2.5" />
                                                  Shared by {device.sharedBy}
                                                </span>
                                              )}
                                            </div>
                                        )}
                                        <div className="text-xs font-mono text-sanctuary-500">{device.fingerprint}</div>
                                    </div>

                                    {/* Delete confirmation */}
                                    {deleteConfirmId === device.id && (
                                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-[10px] text-rose-600">Delete?</span>
                                        <button
                                          onClick={() => handleDelete(device)}
                                          className="px-1 py-0.5 text-[10px] bg-rose-600 text-white rounded hover:bg-rose-700"
                                        >
                                          Yes
                                        </button>
                                        <button
                                          onClick={() => { setDeleteConfirmId(null); setDeleteError(null); }}
                                          className="px-1 py-0.5 text-[10px] bg-sanctuary-200 dark:bg-sanctuary-700 rounded hover:bg-sanctuary-300"
                                        >
                                          No
                                        </button>
                                      </div>
                                    )}
                                 </div>

                                 {/* Wallet badges - color coded by type */}
                                 <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-sanctuary-50 dark:border-sanctuary-800">
                                     {device.wallets && device.wallets.length > 0 ? (
                                         device.wallets.map((wd) => {
                                           const walletType = wd.wallet.type || 'single_sig';
                                           const isMultisig = walletType === 'multi_sig';
                                           const badgeClass = isMultisig
                                             ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                                             : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
                                           return (
                                             <span
                                               key={wd.wallet.id}
                                               className={`text-[10px] px-1.5 py-0.5 rounded flex items-center ${badgeClass}`}
                                             >
                                               {getWalletIcon(walletType, 'w-2 h-2 mr-1 flex-shrink-0')}
                                               {wd.wallet.name}
                                             </span>
                                           );
                                         })
                                     ) : walletCount > 0 ? (
                                         <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center bg-primary-100 text-primary-800 border border-primary-200 dark:bg-primary-500/10 dark:text-primary-300 dark:border-primary-500/20">
                                             <HardDrive className="w-2 h-2 mr-1 flex-shrink-0" />
                                             {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
                                         </span>
                                     ) : (
                                         <span className="text-[10px] text-sanctuary-300">Unused</span>
                                     )}
                                 </div>
                             </li>
                          );
                       })}
                    </ul>
                </div>
            </div>
          );
       })}
    </div>
  );
};
