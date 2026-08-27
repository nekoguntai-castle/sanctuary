import React, { useState, useEffect, memo } from 'react';
import { Wallet } from '../../types';
import { Wallet as WalletIcon } from 'lucide-react';
import { Amount } from '../Amount';
import { TabNetwork } from '../NetworkTabs';
import { useUserPreference } from '../../hooks/useUserPreference';
import { ShowMoreToggle } from '../ui/ShowMoreToggle';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SectionSummary } from '../ui/SectionSummary';
import { WalletSummaryTable } from './WalletSummaryTable';
import { useWalletSyncLifecycleClock } from '../../hooks/useWalletSyncLifecycleClock';
import { summarizeWalletSyncFleet } from '../../utils/walletSyncLifecycle';

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
    arrowPositionClasses: 'tooltip-arrow-centered',
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
  const now = useWalletSyncLifecycleClock(filteredWallets, selectedNetwork);
  const fleetSummary = summarizeWalletSyncFleet(filteredWallets, now);

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
            fleetSummary.text,
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
       <div
         data-testid="dashboard-wallet-sync-summary"
         className="mb-3 text-xs text-sanctuary-500 dark:text-sanctuary-400"
       >
         {fleetSummary.text}
       </div>
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
         now={now}
         hoveredWalletId={hoveredWalletId}
         getColor={getDistributionColor}
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
