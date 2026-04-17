import React from 'react';
import { Wallet, isMultisigType, getQuorumM, getQuorumN } from '../../types';
import { Amount } from '../Amount';
import { Button } from '../ui/Button';
import { getWalletIcon } from '../ui/CustomIcons';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Share2,
  Users,
  Check,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  AlertCircle,
  Bot,
} from 'lucide-react';
import type { SyncRetryInfo } from './types';

export interface WalletAgentLinkBadge {
  agentId: string;
  agentName: string;
  role: 'funding' | 'operational';
  linkedWalletName: string;
  status: string;
}

interface WalletHeaderProps {
  wallet: Wallet;
  agentLinks?: WalletAgentLinkBadge[];
  syncing: boolean;
  syncRetryInfo: SyncRetryInfo | null;
  onReceive: () => void;
  onSend: () => void;
  onSync: () => void;
  onFullResync: () => void;
  onExport: () => void;
}

export const WalletHeader: React.FC<WalletHeaderProps> = ({
  wallet,
  agentLinks = [],
  syncing,
  syncRetryInfo,
  onReceive,
  onSend,
  onSync,
  onFullResync,
  onExport,
}) => (
  <>
    {/* Header Card - Compact */}
    <div className="surface-elevated rounded-xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10 pointer-events-none">
        {getWalletIcon(wallet.type, "w-32 h-32 text-primary-500")}
      </div>

      <div className="relative z-10">
        {/* Row 1: Badges */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {/* Wallet Type Badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${isMultisigType(wallet.type) ? 'bg-warning-100 text-warning-800 border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20' : 'bg-success-100 text-success-800 border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20'}`}>
            {isMultisigType(wallet.type) ? `${getQuorumM(wallet.quorum)}/${getQuorumN(wallet.quorum, wallet.totalSigners)} Multisig` : 'Single Sig'}
          </span>
          {/* Network Badge - only show if not mainnet */}
          {wallet.network && wallet.network !== 'mainnet' && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
              wallet.network === 'testnet'
                ? 'bg-testnet-100 text-testnet-800 border-testnet-200 dark:bg-testnet-500/10 dark:text-testnet-100 dark:border-testnet-500/30'
                : wallet.network === 'signet'
                ? 'bg-signet-100 text-signet-800 border-signet-200 dark:bg-signet-500/10 dark:text-signet-100 dark:border-signet-500/30'
                : 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20'
            }`}>
              {wallet.network}
            </span>
          )}
          {/* Sync Status Badge */}
          {wallet.lastSyncStatus === 'retrying' || syncRetryInfo ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20" title={syncRetryInfo?.error || 'Sync failed, retrying...'}>
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Retrying {syncRetryInfo?.retryCount || 1}/{syncRetryInfo?.maxRetries || 3}
            </span>
          ) : syncing || wallet.syncInProgress ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30">
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Syncing
            </span>
          ) : wallet.lastSyncStatus === 'success' ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20" title={wallet.lastSyncedAt ? `Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}` : ''}>
              <Check className="w-3 h-3 mr-1" /> Synced
            </span>
          ) : wallet.lastSyncStatus === 'failed' ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20" title="Last sync failed">
              <AlertTriangle className="w-3 h-3 mr-1" /> Failed
            </span>
          ) : wallet.lastSyncedAt ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sanctuary-100 text-sanctuary-600 border border-sanctuary-200 dark:bg-sanctuary-800 dark:text-sanctuary-400 dark:border-sanctuary-700" title={`Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}`}>
              <Check className="w-3 h-3 mr-1" /> Cached
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20" title="Never synced">
              <AlertTriangle className="w-3 h-3 mr-1" /> Not Synced
            </span>
          )}
          {/* Role Badge - your access level */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            wallet.userRole === 'owner'
              ? 'bg-primary-600 text-white dark:bg-primary-100 dark:text-primary-700'
              : wallet.userRole === 'signer'
              ? 'bg-warning-600 text-white dark:bg-warning-100 dark:text-warning-700'
              : 'bg-sanctuary-500 text-white dark:bg-sanctuary-900 dark:text-sanctuary-200'
          }`}>
            {wallet.userRole === 'owner' ? 'Owner' : wallet.userRole === 'signer' ? 'Signer' : 'Viewer'}
          </span>
          {/* Shared indicator */}
          {wallet.isShared && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-600 text-white dark:bg-shared-100 dark:text-shared-700">
              <Users className="w-3 h-3" />
              Shared
            </span>
          )}
          {agentLinks.map(link => (
            <span
              key={`${link.agentId}-${link.role}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-600 text-white dark:bg-shared-100 dark:text-shared-700"
              title={`${link.agentName} links this wallet to ${link.linkedWalletName}`}
            >
              <Bot className="w-3 h-3" />
              {link.role === 'funding' ? 'Agent Funding Wallet' : 'Agent Operational Wallet'}
            </span>
          ))}
        </div>

        {/* Row 2: Name + Balance */}
        <div className="flex items-center justify-between gap-4 mb-3">
          <h1 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50 tracking-tight truncate">{wallet.name}</h1>
          <Amount
            sats={wallet.balance}
            size="lg"
            className="flex-shrink-0 font-semibold text-sanctuary-900 dark:text-sanctuary-50"
          />
        </div>

        {/* Row 3: Actions */}
        <div className="flex items-center justify-between">
          <div className="flex space-x-2">
            <Button onClick={onReceive} variant="primary" size="sm">
              <ArrowDownLeft className="w-4 h-4 mr-1.5" /> Receive
            </Button>
            {wallet.userRole !== 'viewer' && (
              <Button variant="secondary" size="sm" onClick={onSend}>
                <ArrowUpRight className="w-4 h-4 mr-1.5" /> Send
              </Button>
            )}
          </div>
          <div className="flex space-x-1">
            <Button variant="ghost" size="sm" onClick={onSync} disabled={syncing} title="Sync wallet">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onFullResync} disabled={syncing} title="Full resync (clears and re-syncs all transactions)">
              <RotateCcw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onExport} title="Export wallet">
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    {/* Initial Sync Banner - shown for newly imported wallets */}
    {!wallet.lastSyncedAt && (syncing || wallet.syncInProgress) && (
      <div className="surface-elevated rounded-xl p-4 shadow-sm border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-950/30 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <RefreshCw className="w-6 h-6 text-primary-600 dark:text-primary-300 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-primary-900 dark:text-sanctuary-50">
              Initial sync in progress
            </h3>
            <p className="text-xs text-primary-700 dark:text-sanctuary-300 mt-0.5">
              Scanning blockchain for transactions. This may take a few minutes for wallets with many addresses or transaction history.
            </p>
          </div>
        </div>
      </div>
    )}

    {/* Never Synced Banner - shown when sync hasn't started */}
    {!wallet.lastSyncedAt && !syncing && !wallet.syncInProgress && wallet.lastSyncStatus !== 'retrying' && (
      <div className="surface-elevated rounded-xl p-4 shadow-sm border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/30 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <AlertCircle className="w-6 h-6 text-warning-600 dark:text-warning-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-warning-900 dark:text-warning-100">
              Wallet not synced
            </h3>
            <p className="text-xs text-warning-700 dark:text-warning-300 mt-0.5">
              This wallet hasn't been synced with the blockchain yet. Click "Sync" to fetch your transaction history and balance.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onSync}>
            <RefreshCw className="w-3 h-3 mr-1" /> Sync Now
          </Button>
        </div>
      </div>
    )}
  </>
);
