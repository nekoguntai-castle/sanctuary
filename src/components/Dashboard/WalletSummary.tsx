import React, { useState, useEffect, memo } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, isMultisigType } from '../../types';
import { Wallet as WalletIcon, ChevronRight, RefreshCw, Check, AlertTriangle, Clock } from 'lucide-react';
import { Amount } from '../Amount';
import { WalletEmptyState } from '../ui/EmptyState';
import { TabNetwork } from '../NetworkTabs';
import { useUserPreference } from '../../hooks/useUserPreference';
import { ShowMoreToggle } from '../ui/ShowMoreToggle';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SectionSummary } from '../ui/SectionSummary';

const distributionColors = [
    'bg-primary-500',
    'bg-success-500',
    'bg-warning-500',
    'bg-zen-indigo',
    'bg-sanctuary-600',
    'bg-sanctuary-500'
];

/**
 * Rows rendered before the table collapses behind a "show all" toggle. Keeps the
 * vertical position of everything below the wallet card (notably Recent
 * Activity) independent of how many wallets exist.
 *
 * Tied to the palette length on purpose: the row dot column reads as a legend
 * for the distribution bar, and `getDistributionColor` wraps modulo the palette.
 * Showing more rows than there are colours would repeat dots and break that
 * reading.
 *
 * Deliberately a truncation rather than a `max-h` + `overflow-y-auto` scroll
 * region: the per-row sync tooltips are `position: absolute`, and a vertical
 * scroll container would clip them on the first visible row. (The existing
 * `overflow-x-auto` wrapper only becomes a clipping context if the table
 * actually overflows horizontally, which the column widths avoid.)
 */
const VISIBLE_ROW_CAP = distributionColors.length;

interface WalletSummaryProps {
  selectedNetwork: TabNetwork;
  filteredWallets: Wallet[];
  totalBalance: number;
}

// Tooltip styles are in src/index.html as .tooltip-popup and .tooltip-arrow

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
      <div className="h-4 w-full surface-secondary rounded-full overflow-visible flex mb-5 relative">
        <div className="w-full h-full bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="h-4 w-full surface-secondary rounded-full overflow-visible flex mb-5 relative">
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

/**
 * Should the row's convenience click handler stay out of the way?
 *
 * Yes when the click already landed on the wallet-name <Link>, which navigates
 * on its own — without this the name would navigate twice.
 *
 * Yes also under any modifier or non-primary button. `navigate()` has no
 * modifier awareness, so a Cmd/Ctrl-click on the row would silently discard the
 * current page instead of opening a tab. Bowing out leaves the link as the one
 * modifier-aware target, rather than having "open in new tab" work over the
 * name and do something different two pixels to its right.
 */
function shouldRowIgnoreClick(event: MouseEvent<HTMLTableRowElement>) {
  if ((event.target as HTMLElement).closest('a') !== null) {
    return true;
  }
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
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
    // onFocus/onBlur stay on the row: React maps them to focusin/focusout, which
    // bubble, so focusing the inner link still drives the distribution-bar
    // cross-highlight. No tabIndex/onKeyDown — the link is the real control and
    // supplies keyboard access; a focusable row on top of it would be a second,
    // role-less tab stop for the same destination.
    <tr
      onClick={(event) => {
        if (!shouldRowIgnoreClick(event)) {
          onNavigate(wallet.id);
        }
      }}
      onMouseEnter={() => onHover(wallet.id)}
      onMouseLeave={onLeave}
      onFocus={() => onHover(wallet.id)}
      onBlur={onLeave}
      className={`group cursor-pointer transition-all duration-200 hover:shadow-sm active:bg-sanctuary-100 dark:active:bg-sanctuary-700 ${
        isHighlighted
          ? 'bg-sanctuary-50 dark:bg-sanctuary-800'
          : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
      }`}
      style={{ backgroundColor: isHighlighted ? undefined : 'transparent' }}
    >
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`}></div>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Link
            to={`/wallets/${wallet.id}`}
            className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {wallet.name}
          </Link>
          {/* The Sync column is hidden below sm; keep the state visible here.
              Icon only — its tooltip is hover-driven and useless on touch. */}
          {/* role="img" because ARIA prohibits naming a bare generic element;
              without it axe flags aria-prohibited-attr and AT may drop the
              label, which is the only sync signal mobile users get. */}
          <span className="sm:hidden" role="img" aria-label={getSyncTooltipText(wallet)}>
            <WalletSyncIcon wallet={wallet} />
          </span>
        </div>
      </td>
      <td className="hidden sm:table-cell px-4 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
          {isMultisig ? 'Multisig' : 'Single Sig'}
        </span>
      </td>
      <td className="hidden sm:table-cell px-4 py-2.5 whitespace-nowrap text-center">
        <WalletSyncStatus wallet={wallet} />
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-right">
        <Amount sats={wallet.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" />
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-right">
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
        <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Type</th>
        <th scope="col" className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Sync</th>
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

const WalletSummaryImpl: React.FC<WalletSummaryProps> = ({
  selectedNetwork,
  filteredWallets,
  totalBalance,
}) => {
  const [hoveredWalletId, setHoveredWalletId] = useState<string | null>(null);
  const [barAnimated, setBarAnimated] = useState(false);
  const [expanded, setExpanded] = useUserPreference(
    'viewSettings.dashboard.walletsExpanded',
    false
  );

  // Trigger bar animation after mount
  useEffect(() => {
    const timer = setTimeout(() => setBarAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const exceedsCap = filteredWallets.length > VISIBLE_ROW_CAP;
  const visibleWallets = exceedsCap && !expanded
    ? filteredWallets.slice(0, VISIBLE_ROW_CAP)
    : filteredWallets;
  const clearHover = () => setHoveredWalletId(null);

  return (
    <CollapsibleSection
      testId="dashboard-wallets"
      // Distinct from `walletsExpanded`, which still owns the six-row/all-rows
      // choice below. Section disclosure and row cap are separate decisions.
      preferenceKey="viewSettings.dashboard.walletsCollapsed"
      // The card shell performs no action of its own; the disclosure button,
      // the row links, and the show-more toggle each carry their own affordance.
      interactive={false}
      headingClassName="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]"
      headerClassName="flex items-center justify-between gap-4 mb-4"
      title={
        <>
          <WalletIcon className="w-3.5 h-3.5 mr-1.5 text-sanctuary-400" />
          {getNetworkLabel(selectedNetwork)} Wallets
        </>
      }
      summary={
        <SectionSummary
          testId="dashboard-wallets-summary"
          parts={[
            `${filteredWallets.length} ${filteredWallets.length === 1 ? 'wallet' : 'wallets'}`,
            // `inline` is the fix for the squashed bar: without it Amount takes
            // its `flex flex-col` branch and stacks fiat under BTC, so a
            // two-line block sat beside a one-line count. Amount's inline
            // branch is gated on `inline` alone, so this stays one phrasing-
            // level span when there is no fiat to show either (fiat off, or a
            // non-mainnet network) — see the comment on that branch.
            <Amount sats={totalBalance} size="sm" inline />,
          ]}
        />
      }
    >
       <WalletDistributionBar
         wallets={filteredWallets}
         totalBalance={totalBalance}
         barAnimated={barAnimated}
         hoveredWalletId={hoveredWalletId}
         onHover={setHoveredWalletId}
         onLeave={clearHover}
       />
       <WalletSummaryTable
         selectedNetwork={selectedNetwork}
         wallets={visibleWallets}
         hoveredWalletId={hoveredWalletId}
         onHover={setHoveredWalletId}
         onLeave={clearHover}
       />
       {exceedsCap && (
         <ShowMoreToggle
           expanded={expanded}
           onToggle={() => setExpanded(!expanded)}
           collapsedLabel={`Show all ${filteredWallets.length} wallets`}
           className="mt-3 w-full"
         />
       )}
    </CollapsibleSection>
  );
};
WalletSummaryImpl.displayName = 'WalletSummary';

// memo'd so the Dashboard doesn't re-render the wallet table when only an
// unrelated card (price feed, fees, node status) updates. Default shallow
// equality assumes Dashboard passes a stable `filteredWallets` array
// reference (useMemo'd in useDashboardData).
//
// Note this blocks *parent-driven* renders only. `useUserPreference` subscribes
// to UserContext, which memo cannot gate, so this component also re-renders on
// any preference write anywhere in the app (theme, unit, network switch). Those
// are user-driven and infrequent; isolating them would mean splitting
// UserContext, not changing anything here.
export const WalletSummary = memo(WalletSummaryImpl);
