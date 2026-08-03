/**
 * AdvancedSettings - Technical details, sync, troubleshooting, export, and danger zone
 */

import React from 'react';
import {
  ChevronDown,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { Button } from '../../../ui/Button';
import { isMultisigType, getQuorumM, getQuorumN } from '../../../../types';
import type { Wallet } from '../../../../types';

interface AdvancedSettingsProps {
  wallet: Wallet;
  syncing: boolean;
  onSync: () => void;
  onFullResync: () => void;
  repairing: boolean;
  onRepairWallet: () => void;
  showDangerZone: boolean;
  onSetShowDangerZone: (show: boolean) => void;
  onShowDelete: () => void;
  onShowExport: () => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  wallet,
  syncing,
  onSync,
  onFullResync,
  repairing,
  onRepairWallet,
  showDangerZone,
  onSetShowDangerZone,
  onShowDelete,
  onShowExport,
}) => (
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
            {wallet.scriptType === WalletScriptType.NATIVE_SEGWIT && 'Native SegWit'}
            {wallet.scriptType === WalletScriptType.NESTED_SEGWIT && 'Nested SegWit'}
            {wallet.scriptType === WalletScriptType.TAPROOT && 'Taproot'}
            {wallet.scriptType === WalletScriptType.LEGACY && 'Legacy'}
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
);
