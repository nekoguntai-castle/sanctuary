import React from 'react';
import { Wallet } from '../../types';
import { Amount } from '../Amount';
import { Button } from '../ui/Button';
import { getWalletIcon } from '../ui/CustomIcons';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Share2,
  RefreshCw,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type { SyncRetryInfo } from './types';
import { WalletBadges } from './WalletHeaderBadges';

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
        <WalletBadges
          wallet={wallet}
          agentLinks={agentLinks}
          syncing={syncing}
          syncRetryInfo={syncRetryInfo}
        />

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
