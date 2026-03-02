/**
 * SettingsTab - Wallet settings with sub-tabs for general, devices, notifications, and advanced
 *
 * Contains wallet configuration, device management, notification settings,
 * technical details, sync options, export, and danger zone (delete).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Edit2,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { LabelManager } from '../../LabelManager';
import { WalletTelegramSettings } from '../WalletTelegramSettings';
import { getDeviceIcon } from '../../ui/CustomIcons';
import { WalletType, isMultisigType, getQuorumM, getQuorumN } from '../../../types';
import type { Wallet, Device } from '../../../types';
import type { SettingsSubTab } from '../types';

interface SettingsTabProps {
  settingsSubTab: SettingsSubTab;
  onSettingsSubTabChange: (tab: SettingsSubTab) => void;
  wallet: Wallet;
  devices: Device[];
  isEditingName: boolean;
  editedName: string;
  onSetIsEditingName: (editing: boolean) => void;
  onSetEditedName: (name: string) => void;
  onUpdateWallet: (data: Partial<Wallet>) => void;
  onLabelsChange: () => void;
  syncing: boolean;
  onSync: () => void;
  onFullResync: () => void;
  repairing: boolean;
  onRepairWallet: () => void;
  showDangerZone: boolean;
  onSetShowDangerZone: (show: boolean) => void;
  onShowDelete: () => void;
  onShowExport: () => void;
  explorerUrl: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settingsSubTab,
  onSettingsSubTabChange,
  wallet,
  devices,
  isEditingName,
  editedName,
  onSetIsEditingName,
  onSetEditedName,
  onUpdateWallet,
  onLabelsChange,
  syncing,
  onSync,
  onFullResync,
  repairing,
  onRepairWallet,
  showDangerZone,
  onSetShowDangerZone,
  onShowDelete,
  onShowExport,
  explorerUrl,
}) => {
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl space-y-4">
      {/* Settings Sub-tabs */}
      <div className="flex gap-1 p-1 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg w-fit">
        <button
          onClick={() => onSettingsSubTabChange('general')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            settingsSubTab === 'general'
              ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
              : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
          }`}
        >
          General
        </button>
        <button
          onClick={() => onSettingsSubTabChange('devices')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            settingsSubTab === 'devices'
              ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
              : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
          }`}
        >
          Devices
        </button>
        <button
          onClick={() => onSettingsSubTabChange('notifications')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            settingsSubTab === 'notifications'
              ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
              : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
          }`}
        >
          Notifications
        </button>
        <button
          onClick={() => onSettingsSubTabChange('advanced')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            settingsSubTab === 'advanced'
              ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
              : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
          }`}
        >
          Advanced
        </button>
      </div>

      {/* General Sub-tab */}
      {settingsSubTab === 'general' && (
        <div className="space-y-4">
          {/* Wallet Name */}
          <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
            <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Wallet Name</h3>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => onSetEditedName(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-sanctuary-300 dark:border-sanctuary-600 rounded-lg bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Enter wallet name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editedName.trim()) {
                      onUpdateWallet({ name: editedName.trim() });
                      onSetIsEditingName(false);
                    } else if (e.key === 'Escape') {
                      onSetIsEditingName(false);
                      onSetEditedName(wallet.name);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (editedName.trim()) {
                      onUpdateWallet({ name: editedName.trim() });
                      onSetIsEditingName(false);
                    }
                  }}
                  disabled={!editedName.trim() || editedName.trim() === wallet.name}
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSetIsEditingName(false);
                    onSetEditedName(wallet.name);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{wallet.name}</span>
                {wallet.canEdit !== false && (
                  <button
                    onClick={() => {
                      onSetEditedName(wallet.name);
                      onSetIsEditingName(true);
                    }}
                    className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700"
                    title="Rename wallet"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Labels Management - only show if user can edit */}
          {wallet.canEdit !== false && (
            <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
              <LabelManager walletId={wallet.id} onLabelsChange={onLabelsChange} />
            </div>
          )}
        </div>
      )}

      {/* Devices Sub-tab */}
      {settingsSubTab === 'devices' && (
        <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
          <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Hardware Devices</h3>
          {devices.length > 0 ? (
            <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
              {devices.map(d => {
                const hasAccountMismatch = d.accountMissing;
                return (
                  <li
                    key={d.id}
                    onClick={() => navigate(`/devices/${d.id}`)}
                    className={`py-3 flex justify-between items-center cursor-pointer hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 -mx-2 px-2 rounded-lg transition-colors ${hasAccountMismatch ? 'border-l-4 border-rose-500' : ''}`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${hasAccountMismatch ? 'bg-rose-100 dark:bg-rose-900/30' : 'surface-secondary'}`}>
                        {getDeviceIcon(d.type, `w-5 h-5 ${hasAccountMismatch ? 'text-rose-600 dark:text-rose-400' : 'text-sanctuary-600 dark:text-sanctuary-400'}`)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{d.label}</p>
                        <p className="text-xs text-sanctuary-500">{d.type} &bull; {d.fingerprint}</p>
                        {hasAccountMismatch ? (
                          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                            Missing {wallet.type === WalletType.MULTI_SIG ? 'multisig' : 'single-sig'} account for {wallet.scriptType} - cannot sign
                          </p>
                        ) : (
                          <p className="text-xs font-mono text-sanctuary-400">{d.derivationPath}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasAccountMismatch ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-600 text-white">
                          Cannot Sign
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-zen-indigo text-white">
                          Active
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-sanctuary-400" />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-sanctuary-500">No hardware devices associated with this wallet.</p>
          )}
        </div>
      )}

      {/* Notifications Sub-tab */}
      {settingsSubTab === 'notifications' && (
        <WalletTelegramSettings walletId={wallet.id} />
      )}

      {/* Advanced Sub-tab */}
      {settingsSubTab === 'advanced' && (
        <div className="space-y-4">
          {/* Technical Details - Compact */}
          <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
            <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Technical Details</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center justify-between col-span-2 py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                <span className="text-sanctuary-500">Wallet ID</span>
                <span className="font-mono text-xs text-sanctuary-700 dark:text-sanctuary-300 truncate max-w-[200px]" title={wallet.id}>{wallet.id}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                <span className="text-sanctuary-500">Type</span>
                <span className="text-sanctuary-900 dark:text-sanctuary-100">{wallet.type}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                <span className="text-sanctuary-500">Script</span>
                <span className="text-sanctuary-900 dark:text-sanctuary-100">
                  {wallet.scriptType === 'native_segwit' && 'Native SegWit'}
                  {wallet.scriptType === 'nested_segwit' && 'Nested SegWit'}
                  {wallet.scriptType === 'taproot' && 'Taproot'}
                  {wallet.scriptType === 'legacy' && 'Legacy'}
                  {!wallet.scriptType && 'Unknown'}
                </span>
              </div>
              {wallet.descriptor && (
                <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                  <span className="text-sanctuary-500">Path</span>
                  <span className="font-mono text-xs text-sanctuary-900 dark:text-sanctuary-100">
                    {(() => {
                      const match = wallet.descriptor.match(/\[([a-fA-F0-9]+)\/([^\]]+)\]/);
                      if (match) {
                        return `m/${match[2].replace(/h/g, "'")}`;
                      }
                      return wallet.derivationPath || 'Unknown';
                    })()}
                  </span>
                </div>
              )}
              {wallet.quorum && (
                <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                  <span className="text-sanctuary-500">Quorum</span>
                  <span className="text-sanctuary-900 dark:text-sanctuary-100">{getQuorumM(wallet.quorum)} of {getQuorumN(wallet.quorum, wallet.totalSigners)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Sync Options */}
          <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Sync Options</h3>
              {wallet.lastSyncedAt && (
                <span className="text-xs text-sanctuary-500">
                  Last synced {new Date(wallet.lastSyncedAt).toLocaleDateString()} at {new Date(wallet.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Sync Now</p>
                  <p className="text-xs text-sanctuary-500">Fetch latest transactions</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onSync}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : 'Sync'}
                </Button>
              </div>
              <div className="border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Full Resync</p>
                    <p className="text-xs text-sanctuary-500">Clear and re-sync from blockchain</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onFullResync}
                    disabled={syncing}
                  >
                    {syncing ? 'Syncing...' : 'Resync'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Troubleshooting - show if wallet has issues */}
          {!wallet.descriptor && wallet.userRole === 'owner' && (
            <div className="surface-elevated rounded-xl p-5 border border-warning-200 dark:border-warning-800 bg-warning-50/50 dark:bg-warning-900/20">
              <h3 className="text-base font-medium mb-2 text-warning-700 dark:text-warning-300">Troubleshooting</h3>
              <p className="text-xs text-warning-600 dark:text-warning-400 mb-4">
                This wallet is missing a descriptor, which is needed to generate addresses.
                If you have hardware devices linked, you can repair the wallet to regenerate the descriptor.
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Repair Wallet</p>
                  <p className="text-xs text-sanctuary-500">Regenerate descriptor from linked devices</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRepairWallet}
                  disabled={repairing}
                >
                  {repairing ? 'Repairing...' : 'Repair'}
                </Button>
              </div>
            </div>
          )}

          {/* Export Wallet */}
          <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
            <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Export Wallet</h3>
            <p className="text-xs text-sanctuary-500 mb-4">Export your wallet configuration for backup or to import into other applications.</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Export Options</p>
                  <p className="text-xs text-sanctuary-500">QR code, JSON backup, descriptor, labels{isMultisigType(wallet.type) ? ', device setup' : ''}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onShowExport}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </div>

          {/* Danger Zone - only show if user is owner */}
          {wallet.userRole === 'owner' && (
            <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
              <button
                onClick={() => onSetShowDangerZone(!showDangerZone)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-zen-vermilion" />
                  <span className="text-sm font-medium text-zen-vermilion">Danger Zone</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-sanctuary-400 transition-transform ${showDangerZone ? 'rotate-180' : ''}`} />
              </button>
              {showDangerZone && (
                <div className="p-4 pt-0 border-t border-sanctuary-200 dark:border-sanctuary-700">
                  <div className="flex items-center justify-between pt-3">
                    <div>
                      <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Delete Wallet</p>
                      <p className="text-xs text-sanctuary-500">This action cannot be undone</p>
                    </div>
                    <Button variant="danger" size="sm" onClick={onShowDelete}>Delete</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
