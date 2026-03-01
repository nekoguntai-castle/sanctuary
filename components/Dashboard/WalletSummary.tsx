import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, isMultisigType } from '../../types';
import { Wallet as WalletIcon, ChevronRight, RefreshCw, Check, AlertTriangle, Clock } from 'lucide-react';
import { Amount } from '../Amount';
import { TabNetwork } from '../NetworkTabs';

const distributionColors = [
    'bg-primary-500',
    'bg-success-500',
    'bg-warning-500',
    'bg-zen-indigo',
    'bg-sanctuary-600',
    'bg-sanctuary-500'
];

interface WalletSummaryProps {
  selectedNetwork: TabNetwork;
  filteredWallets: Wallet[];
  totalBalance: number;
}

export const WalletSummary: React.FC<WalletSummaryProps> = ({
  selectedNetwork,
  filteredWallets,
  totalBalance,
}) => {
  const navigate = useNavigate();

  return (
    <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
       <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
             <WalletIcon className="w-5 h-5 mr-2 text-sanctuary-400" />
             {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Wallets
          </h3>
       </div>

       {/* Visual Bar */}
       <div className="h-4 w-full surface-secondary rounded-full overflow-hidden flex mb-8">
          {filteredWallets.length === 0 ? (
             <div className="w-full h-full bg-sanctuary-200 dark:bg-sanctuary-700"></div>
          ) : filteredWallets.map((w, idx) => {
             const percent = totalBalance > 0 ? (w.balance / totalBalance) * 100 : 0;
             const colorClass = distributionColors[idx % distributionColors.length];

             return (
                <div
                   key={w.id}
                   className={`h-full ${colorClass} border-r border-white dark:border-sanctuary-900 last:border-0`}
                   style={{ width: `${percent}%` }}
                   title={`${w.name}: ${percent.toFixed(1)}%`}
                />
             );
          })}
       </div>

       {/* Wallet Table */}
       <div className="overflow-x-auto">
          <table className="min-w-full bg-transparent">
             <thead className="surface-secondary border-b border-sanctuary-100 dark:border-sanctuary-800">
                <tr>
                   <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-8"></th>
                   <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Wallet Name</th>
                   <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Type</th>
                   <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Sync</th>
                   <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Balance</th>
                   <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-10"></th>
                </tr>
             </thead>
             <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
                {filteredWallets.length === 0 && (
                   <tr className="bg-transparent">
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-sanctuary-500 bg-transparent">
                         No {selectedNetwork} wallets found. Create or import a {selectedNetwork} wallet to get started.
                      </td>
                   </tr>
                )}
                {filteredWallets.map((w, idx) => {
                   const isMultisig = isMultisigType(w.type);
                   const dotColorClass = distributionColors[idx % distributionColors.length];

                   const badgeClass = isMultisig
                      ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                      : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                   return (
                      <tr
                         key={w.id}
                         onClick={() => navigate(`/wallets/${w.id}`)}
                         className="group hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer transition-colors"
                         style={{ backgroundColor: 'transparent' }}
                      >
                         <td className="px-4 py-4 whitespace-nowrap">
                            <div className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`}></div>
                         </td>
                         <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{w.name}</div>
                            <div className="text-xs text-sanctuary-500 hidden sm:block">{w.id}</div>
                         </td>
                         <td className="px-4 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
                               {isMultisig ? 'Multisig' : 'Single Sig'}
                            </span>
                         </td>
                         <td className="px-4 py-4 whitespace-nowrap text-center">
                            {w.syncInProgress ? (
                               <span className="inline-flex items-center text-primary-600 dark:text-primary-400" title="Syncing...">
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                               </span>
                            ) : w.lastSyncStatus === 'success' ? (
                               <span className="inline-flex items-center text-success-600 dark:text-success-400" title={w.lastSyncedAt ? `Synced ${new Date(w.lastSyncedAt).toLocaleString()}` : 'Synced'}>
                                  <Check className="w-4 h-4" />
                               </span>
                            ) : w.lastSyncStatus === 'failed' ? (
                               <span className="inline-flex items-center text-rose-600 dark:text-rose-400" title="Sync failed">
                                  <AlertTriangle className="w-4 h-4" />
                               </span>
                            ) : w.lastSyncedAt ? (
                               <span className="inline-flex items-center text-sanctuary-400" title={`Cached from ${new Date(w.lastSyncedAt).toLocaleString()}`}>
                                  <Clock className="w-4 h-4" />
                               </span>
                            ) : (
                               <span className="inline-flex items-center text-warning-600 dark:text-warning-400" title="Never synced">
                                  <AlertTriangle className="w-4 h-4" />
                               </span>
                            )}
                         </td>
                         <td className="px-4 py-4 whitespace-nowrap text-right">
                            <Amount sats={w.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" />
                         </td>
                         <td className="px-4 py-4 whitespace-nowrap text-right">
                            <ChevronRight className="w-4 h-4 text-sanctuary-300 group-hover:text-sanctuary-500 transition-colors" />
                         </td>
                      </tr>
                   )
                })}
             </tbody>
          </table>
       </div>
    </div>
  );
};
