import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, isMultisigType } from '../../types';
import { Wallet as WalletIcon, ChevronRight, RefreshCw, Check, AlertTriangle, Clock } from 'lucide-react';
import { Amount } from '../Amount';
import { WalletEmptyState } from '../ui/EmptyState';
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

const tooltipBase = `
  absolute z-50 pointer-events-none
  text-[11px] font-medium px-3 py-2.5 rounded-lg
  bg-sanctuary-800 text-sanctuary-100 dark:bg-sanctuary-100 dark:text-sanctuary-900
  shadow-xl border border-sanctuary-700 dark:border-sanctuary-200
  whitespace-nowrap
`;

const tooltipArrowBase = `
  absolute w-2 h-2 rotate-45
  bg-sanctuary-800 dark:bg-sanctuary-100
  border-sanctuary-700 dark:border-sanctuary-200
`;

function getSyncTooltipText(w: Wallet): string {
  if (w.syncInProgress) return 'Syncing in progress\u2026';
  if (w.lastSyncStatus === 'success') {
    return w.lastSyncedAt
      ? `Last synced: ${new Date(w.lastSyncedAt).toLocaleString()}`
      : 'Synced';
  }
  if (w.lastSyncStatus === 'failed') return 'Sync failed';
  if (w.lastSyncedAt) return `Cached from ${new Date(w.lastSyncedAt).toLocaleString()}`;
  return 'Never synced';
}

export const WalletSummary: React.FC<WalletSummaryProps> = ({
  selectedNetwork,
  filteredWallets,
  totalBalance,
}) => {
  const navigate = useNavigate();
  const [hoveredWalletId, setHoveredWalletId] = useState<string | null>(null);
  const [barAnimated, setBarAnimated] = useState(false);

  // Trigger bar animation after mount
  useEffect(() => {
    const timer = setTimeout(() => setBarAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="surface-glass rounded-2xl p-6 shadow-sm card-interactive">
       <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
             <WalletIcon className="w-5 h-5 mr-2 text-sanctuary-400" />
             {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Wallets
          </h3>
       </div>

       {/* Visual Bar */}
       <div className="h-4 w-full surface-secondary rounded-full overflow-visible flex mb-8 relative">
          {filteredWallets.length === 0 ? (
             <div className="w-full h-full bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full"></div>
          ) : filteredWallets.map((w, idx) => {
             const percent = totalBalance > 0 ? (w.balance / totalBalance) * 100 : 0;
             const colorClass = distributionColors[idx % distributionColors.length];
             const dotColor = distributionColors[idx % distributionColors.length];
             const isFirst = idx === 0;
             const isLast = idx === filteredWallets.length - 1;
             const isHovered = hoveredWalletId === w.id;

             // Edge-aware positioning: left-align first, right-align last, center others
             const positionClasses = isFirst
               ? 'left-0'
               : isLast
                 ? 'right-0'
                 : 'left-1/2 -translate-x-1/2';

             const arrowPositionClasses = isFirst
               ? 'left-3'
               : isLast
                 ? 'right-3'
                 : 'left-1/2 -translate-x-1/2';

             return (
                <div
                   key={w.id}
                   className="relative transition-all duration-700 ease-out"
                   style={{
                     width: barAnimated ? `${percent}%` : '0%',
                     minWidth: barAnimated ? '4px' : '0px',
                     transitionDelay: `${idx * 80}ms`,
                   }}
                   onMouseEnter={() => setHoveredWalletId(w.id)}
                   onMouseLeave={() => setHoveredWalletId(null)}
                >
                   <div
                      className={`h-4 w-full ${colorClass} border-r border-white dark:border-sanctuary-900 last:border-0 transition-all duration-150 ${
                        isHovered ? 'brightness-110 scale-y-110' : ''
                      } ${isFirst ? 'rounded-l-full' : ''} ${isLast ? 'rounded-r-full' : ''}`}
                   />
                   {isHovered && (
                      <div className={`${tooltipBase} bottom-full mb-2 ${positionClasses}`}>
                         {/* Arrow */}
                         <div className={`${tooltipArrowBase} -bottom-1 border-b border-r ${arrowPositionClasses}`} />
                         {/* Content */}
                         <div className="flex items-center gap-1.5 mb-1">
                            <div className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                            <span className="font-semibold">{w.name}</span>
                         </div>
                         <div className="mb-0.5">
                            <Amount sats={w.balance} size="sm" />
                         </div>
                         <div className="text-sanctuary-400 dark:text-sanctuary-500 tabular-nums">
                            {percent.toFixed(1)}% of total
                         </div>
                      </div>
                   )}
                </div>
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
                      <td colSpan={6} className="bg-transparent">
                         <WalletEmptyState network={selectedNetwork} />
                      </td>
                   </tr>
                )}
                {filteredWallets.map((w, idx) => {
                   const isMultisig = isMultisigType(w.type);
                   const dotColorClass = distributionColors[idx % distributionColors.length];

                   const badgeClass = isMultisig
                      ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                      : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                   const isHighlighted = hoveredWalletId === w.id;

                   return (
                      <tr
                         key={w.id}
                         onClick={() => navigate(`/wallets/${w.id}`)}
                         onMouseEnter={() => setHoveredWalletId(w.id)}
                         onMouseLeave={() => setHoveredWalletId(null)}
                         className={`group cursor-pointer transition-all duration-200 hover:shadow-sm active:bg-sanctuary-100 dark:active:bg-sanctuary-700 ${
                           isHighlighted
                             ? 'bg-sanctuary-50 dark:bg-sanctuary-800'
                             : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
                         }`}
                         style={{ backgroundColor: isHighlighted ? undefined : 'transparent' }}
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
                            <div className="relative group/sync inline-flex items-center justify-center">
                               {w.syncInProgress ? (
                                  <span className="inline-flex items-center text-primary-600 dark:text-primary-400">
                                     <RefreshCw className="w-4 h-4 animate-spin" />
                                  </span>
                               ) : w.lastSyncStatus === 'success' ? (
                                  <span className="inline-flex items-center text-success-600 dark:text-success-400">
                                     <Check className="w-4 h-4" />
                                  </span>
                               ) : w.lastSyncStatus === 'failed' ? (
                                  <span className="inline-flex items-center text-rose-600 dark:text-rose-400">
                                     <AlertTriangle className="w-4 h-4" />
                                  </span>
                               ) : w.lastSyncedAt ? (
                                  <span className="inline-flex items-center text-sanctuary-400">
                                     <Clock className="w-4 h-4" />
                                  </span>
                               ) : (
                                  <span className="inline-flex items-center text-warning-600 dark:text-warning-400">
                                     <AlertTriangle className="w-4 h-4" />
                                  </span>
                               )}
                               {/* Sync status tooltip */}
                               <div className={`
                                  ${tooltipBase}
                                  bottom-full left-1/2 -translate-x-1/2 mb-2
                                  opacity-0 group-hover/sync:opacity-100
                                  transition-all duration-200 delay-150
                                  group-hover/sync:translate-y-0 translate-y-1
                               `}>
                                  <div className={`${tooltipArrowBase} -bottom-1 left-1/2 -translate-x-1/2 border-b border-r`} />
                                  {getSyncTooltipText(w)}
                               </div>
                            </div>
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
