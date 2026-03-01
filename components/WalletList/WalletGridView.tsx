import React from 'react';
import { useNavigate } from 'react-router-dom';
import { WalletType, getQuorumM } from '../../types';
import type { Wallet } from '../../src/api/wallets';
import { Users, RefreshCw, CheckCircle, AlertCircle, Clock, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getWalletIcon } from '../ui/CustomIcons';
import { useCurrency } from '../../contexts/CurrencyContext';

interface PendingData {
  net: number;
  count: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
}

interface WalletGridViewProps {
  wallets: Wallet[];
  pendingByWallet: Record<string, PendingData>;
}

/**
 * Renders wallets as a responsive grid of cards showing balance,
 * type, device count, sync status, and pending transaction indicators.
 */
export const WalletGridView: React.FC<WalletGridViewProps> = ({
  wallets,
  pendingByWallet,
}) => {
  const navigate = useNavigate();
  const { format, formatFiat, showFiat } = useCurrency();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {wallets.map((wallet) => {
        const isMultisig = wallet.type === 'multi_sig';

        // Standardized Badge Styling (Matching Recent Activity)
        const badgeColorClass = isMultisig
          ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
          : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

        const iconColorClass = isMultisig
          ? 'bg-warning-50 dark:bg-warning-900/50 text-warning-600 dark:text-warning-400'
          : 'bg-success-50 dark:bg-success-900/50 text-success-600 dark:text-success-400';

        // Map API type to WalletType for icon
        const walletTypeForIcon = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

        return (
          <div
            key={wallet.id}
            onClick={() => navigate(`/wallets/${wallet.id}`)}
            className="group surface-elevated rounded-2xl p-6 border border-sanctuary-200 dark:border-sanctuary-800 shadow-sm hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 transition-all cursor-pointer relative overflow-hidden"
          >
            <div className="flex justify-between items-start mb-6">
              <div className={`p-3 rounded-xl ${iconColorClass}`}>
                {getWalletIcon(walletTypeForIcon, "w-6 h-6")}
              </div>
              <div className="flex flex-col items-end space-y-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeColorClass}`}>
                  {isMultisig ? 'Multisig' : 'Single Sig'}
                </span>
                {wallet.isShared && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
                    <Users className="w-3 h-3" />
                    Shared
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors">
              {wallet.name}
            </h3>

            <div className="mt-2 mb-4">
              {/* BTC balance with inline net pending and type icons */}
              <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-50 flex items-center gap-1.5">
                <span>{format(wallet.balance)}</span>
                {pendingByWallet[wallet.id] && (
                  <>
                    {/* Pending type icons */}
                    <span className="inline-flex items-center gap-0.5">
                      {pendingByWallet[wallet.id].hasIncoming && (
                        <span title="Pending received"><ArrowDownLeft className="w-3.5 h-3.5 text-success-500" /></span>
                      )}
                      {pendingByWallet[wallet.id].hasOutgoing && (
                        <span title="Pending sent"><ArrowUpRight className="w-3.5 h-3.5 text-sent-500" /></span>
                      )}
                    </span>
                    {/* Net pending amount */}
                    {pendingByWallet[wallet.id].net !== 0 && (
                      <span className={`text-sm font-normal ${
                        pendingByWallet[wallet.id].net > 0
                          ? 'text-success-600 dark:text-success-400'
                          : 'text-sent-600 dark:text-sent-400'
                      }`}>
                        ({pendingByWallet[wallet.id].net > 0 ? '+' : ''}{format(pendingByWallet[wallet.id].net)})
                      </span>
                    )}
                  </>
                )}
              </div>
              {/* Fiat balance with inline net pending */}
              {showFiat && formatFiat(wallet.balance) && (
                <div className="text-sm text-primary-500 dark:text-primary-400">
                  {formatFiat(wallet.balance)}
                  {pendingByWallet[wallet.id] && pendingByWallet[wallet.id].net !== 0 && (
                    <span className={`ml-1 text-xs ${
                      pendingByWallet[wallet.id].net > 0
                        ? 'text-success-600 dark:text-success-400'
                        : 'text-sent-600 dark:text-sent-400'
                    }`}>
                      ({pendingByWallet[wallet.id].net > 0 ? '+' : ''}{formatFiat(pendingByWallet[wallet.id].net)})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs border-t border-sanctuary-100 dark:border-sanctuary-800 pt-3 mt-4">
              <div className="flex items-center text-sanctuary-500">
                <span className="text-sanctuary-400 capitalize">{(wallet.scriptType ?? '').replace('_', ' ')}</span>
                <span className="mx-2 text-sanctuary-300">•</span>
                <span className="text-sanctuary-400">{wallet.deviceCount ?? 0} device{wallet.deviceCount !== 1 ? 's' : ''}</span>
                {wallet.quorum && wallet.totalSigners && (
                  <>
                    <span className="mx-2 text-sanctuary-300">•</span>
                    <span className="text-sanctuary-400">{getQuorumM(wallet.quorum)} of {wallet.totalSigners}</span>
                  </>
                )}
              </div>
              {/* Sync Status */}
              {wallet.syncInProgress ? (
                <span title="Syncing"><RefreshCw className="w-3.5 h-3.5 text-primary-500 animate-spin" /></span>
              ) : wallet.lastSyncStatus === 'success' ? (
                <span title="Synced"><CheckCircle className="w-3.5 h-3.5 text-success-500" /></span>
              ) : wallet.lastSyncStatus === 'failed' ? (
                <span title="Sync failed"><AlertCircle className="w-3.5 h-3.5 text-rose-500" /></span>
              ) : wallet.lastSyncStatus === 'retrying' ? (
                <span title="Retrying"><RefreshCw className="w-3.5 h-3.5 text-amber-500" /></span>
              ) : (
                <span title="Pending sync"><Clock className="w-3.5 h-3.5 text-sanctuary-400" /></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
