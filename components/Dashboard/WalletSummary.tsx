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

// Tooltip styles are now in index.html as .tooltip-popup and .tooltip-arrow

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

function getNetworkLabel(selectedNetwork: TabNetwork) {
  return selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1);
}

function getDistributionColor(index: number) {
  return distributionColors[index % distributionColors.length];
}

function getWalletPercent(wallet: Wallet, totalBalance: number) {
  return totalBalance > 0 ? (wallet.balance / totalBalance) * 100 : 0;
}

function getTooltipPositionClasses(index: number, walletCount: number) {
  if (index === 0) {
    return {
      positionClasses: 'left-0',
      arrowPositionClasses: 'left-3',
    };
  }

  if (index === walletCount - 1) {
    return {
      positionClasses: 'right-0',
      arrowPositionClasses: 'right-3',
    };
  }

  return {
    positionClasses: 'left-1/2 -translate-x-1/2',
    arrowPositionClasses: 'left-1/2 -translate-x-1/2',
  };
}

function WalletDistributionTooltip({
  wallet,
  percent,
  colorClass,
  positionClasses,
  arrowPositionClasses,
}: {
  wallet: Wallet;
  percent: number;
  colorClass: string;
  positionClasses: string;
  arrowPositionClasses: string;
}) {
  return (
    <div className={`tooltip-popup tooltip-visible bottom-full mb-2 ${positionClasses}`}>
      <div className={`tooltip-arrow -bottom-1 border-b border-r ${arrowPositionClasses}`} />
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`w-2 h-2 rounded-full ${colorClass} shrink-0`} />
        <span className="font-semibold">{wallet.name}</span>
      </div>
      <div className="mb-0.5">
        <Amount sats={wallet.balance} size="sm" />
      </div>
      <div className="text-sanctuary-400 dark:text-sanctuary-500 tabular-nums">
        {percent.toFixed(1)}% of total
      </div>
    </div>
  );
}

function WalletDistributionSegment({
  wallet,
  index,
  walletCount,
  totalBalance,
  barAnimated,
  isHovered,
  onHover,
  onLeave,
}: {
  wallet: Wallet;
  index: number;
  walletCount: number;
  totalBalance: number;
  barAnimated: boolean;
  isHovered: boolean;
  onHover: (walletId: string) => void;
  onLeave: () => void;
}) {
  const percent = getWalletPercent(wallet, totalBalance);
  const colorClass = getDistributionColor(index);
  const isFirst = index === 0;
  const isLast = index === walletCount - 1;
  const { positionClasses, arrowPositionClasses } = getTooltipPositionClasses(index, walletCount);

  return (
    <div
      className="relative transition-all duration-700 ease-out"
      style={{
        /* v8 ignore start -- animation initial state; timer fires before jsdom assertions */
        width: barAnimated ? `${percent}%` : '0%',
        minWidth: barAnimated ? '4px' : '0px',
        /* v8 ignore stop */
        transitionDelay: `${index * 80}ms`,
      }}
      onMouseEnter={() => onHover(wallet.id)}
      onMouseLeave={onLeave}
    >
      <div
        className={`h-4 w-full ${colorClass} border-r border-white dark:border-sanctuary-900 last:border-0 transition-all duration-150 ${
          isHovered ? 'brightness-110 scale-y-110' : ''
        } ${isFirst ? 'rounded-l-full' : ''} ${isLast ? 'rounded-r-full' : ''}`}
      />
      {isHovered && (
        <WalletDistributionTooltip
          wallet={wallet}
          percent={percent}
          colorClass={colorClass}
          positionClasses={positionClasses}
          arrowPositionClasses={arrowPositionClasses}
        />
      )}
    </div>
  );
}

function WalletDistributionBar({
  wallets,
  totalBalance,
  barAnimated,
  hoveredWalletId,
  onHover,
  onLeave,
}: {
  wallets: Wallet[];
  totalBalance: number;
  barAnimated: boolean;
  hoveredWalletId: string | null;
  onHover: (walletId: string) => void;
  onLeave: () => void;
}) {
  if (wallets.length === 0) {
    return (
      <div className="h-4 w-full surface-secondary rounded-full overflow-visible flex mb-8 relative">
        <div className="w-full h-full bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="h-4 w-full surface-secondary rounded-full overflow-visible flex mb-8 relative">
      {wallets.map((wallet, index) => (
        <WalletDistributionSegment
          key={wallet.id}
          wallet={wallet}
          index={index}
          walletCount={wallets.length}
          totalBalance={totalBalance}
          barAnimated={barAnimated}
          isHovered={hoveredWalletId === wallet.id}
          onHover={onHover}
          onLeave={onLeave}
        />
      ))}
    </div>
  );
}

function getWalletTypeBadgeClass(isMultisig: boolean) {
  return isMultisig
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
}

function WalletSyncIcon({ wallet }: { wallet: Wallet }) {
  if (wallet.syncInProgress) {
    return (
      <span className="inline-flex items-center text-primary-600 dark:text-primary-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'success') {
    return (
      <span className="inline-flex items-center text-success-600 dark:text-success-400">
        <Check className="w-4 h-4" />
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'failed') {
    return (
      <span className="inline-flex items-center text-rose-600 dark:text-rose-400">
        <AlertTriangle className="w-4 h-4" />
      </span>
    );
  }
  if (wallet.lastSyncedAt) {
    return (
      <span className="inline-flex items-center text-sanctuary-400">
        <Clock className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-warning-600 dark:text-warning-400">
      <AlertTriangle className="w-4 h-4" />
    </span>
  );
}

function WalletSyncStatus({ wallet }: { wallet: Wallet }) {
  return (
    <div className="relative group/sync inline-flex items-center justify-center">
      <WalletSyncIcon wallet={wallet} />
      <div className="tooltip-popup bottom-full left-1/2 -translate-x-1/2 mb-2">
        <div className="tooltip-arrow -bottom-1 left-1/2 -translate-x-1/2 border-b border-r" />
        {getSyncTooltipText(wallet)}
      </div>
    </div>
  );
}

function WalletSummaryRow({
  wallet,
  index,
  isHighlighted,
  onHover,
  onLeave,
  onNavigate,
}: {
  wallet: Wallet;
  index: number;
  isHighlighted: boolean;
  onHover: (walletId: string) => void;
  onLeave: () => void;
  onNavigate: (walletId: string) => void;
}) {
  const isMultisig = isMultisigType(wallet.type);
  const dotColorClass = getDistributionColor(index);
  const badgeClass = getWalletTypeBadgeClass(isMultisig);

  return (
    <tr
      onClick={() => onNavigate(wallet.id)}
      onMouseEnter={() => onHover(wallet.id)}
      onMouseLeave={onLeave}
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
        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{wallet.name}</div>
        <div className="text-xs text-sanctuary-500 hidden sm:block">{wallet.id}</div>
      </td>
      <td className="px-4 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
          {isMultisig ? 'Multisig' : 'Single Sig'}
        </span>
      </td>
      <td className="px-4 py-4 whitespace-nowrap text-center">
        <WalletSyncStatus wallet={wallet} />
      </td>
      <td className="px-4 py-4 whitespace-nowrap text-right">
        <Amount sats={wallet.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" />
      </td>
      <td className="px-4 py-4 whitespace-nowrap text-right">
        <ChevronRight className="w-4 h-4 text-sanctuary-300 group-hover:text-sanctuary-500 transition-colors" />
      </td>
    </tr>
  );
}

function WalletTableHeader() {
  return (
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
  );
}

function WalletSummaryTable({
  selectedNetwork,
  wallets,
  hoveredWalletId,
  onHover,
  onLeave,
}: {
  selectedNetwork: TabNetwork;
  wallets: Wallet[];
  hoveredWalletId: string | null;
  onHover: (walletId: string) => void;
  onLeave: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-transparent">
        <WalletTableHeader />
        <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          {wallets.length === 0 && (
            <tr className="bg-transparent">
              <td colSpan={6} className="bg-transparent">
                <WalletEmptyState network={selectedNetwork} />
              </td>
            </tr>
          )}
          {wallets.map((wallet, index) => (
            <WalletSummaryRow
              key={wallet.id}
              wallet={wallet}
              index={index}
              isHighlighted={hoveredWalletId === wallet.id}
              onHover={onHover}
              onLeave={onLeave}
              onNavigate={(walletId) => navigate(`/wallets/${walletId}`)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const WalletSummary: React.FC<WalletSummaryProps> = ({
  selectedNetwork,
  filteredWallets,
  totalBalance,
}) => {
  const [hoveredWalletId, setHoveredWalletId] = useState<string | null>(null);
  const [barAnimated, setBarAnimated] = useState(false);

  // Trigger bar animation after mount
  useEffect(() => {
    const timer = setTimeout(() => setBarAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive">
       <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
             <WalletIcon className="w-5 h-5 mr-2 text-sanctuary-400" />
             {getNetworkLabel(selectedNetwork)} Wallets
          </h3>
       </div>

       <WalletDistributionBar
         wallets={filteredWallets}
         totalBalance={totalBalance}
         barAnimated={barAnimated}
         hoveredWalletId={hoveredWalletId}
         onHover={setHoveredWalletId}
         onLeave={() => setHoveredWalletId(null)}
       />
       <WalletSummaryTable
         selectedNetwork={selectedNetwork}
         wallets={filteredWallets}
         hoveredWalletId={hoveredWalletId}
         onHover={setHoveredWalletId}
         onLeave={() => setHoveredWalletId(null)}
       />
    </div>
  );
};
