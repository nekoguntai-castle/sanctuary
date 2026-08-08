import type { useDashboardData } from './hooks/useDashboardData';
import { MempoolSection } from './MempoolSection';
import { NodeStatusCard } from './NodeStatusCard';
import { PriceChart } from './PriceChart';
import { WalletSummary } from './WalletSummary';
import { RecentTransactions } from './RecentTransactions';
import { BitcoinPriceCard } from './BitcoinPriceCard';
import { FeeEstimationCard } from './FeeEstimationCard';
import { UpdateBanner } from './UpdateBanner';
import { WelcomeState } from './WelcomeState';
import { WalletsUnavailable } from './WalletsUnavailable';
import { TimeframeControls } from './PriceChart/TimeframeControls';

interface DashboardContentProps {
  data: ReturnType<typeof useDashboardData>;
}

export function DashboardContent({ data }: DashboardContentProps) {
  const {
    btcPrice,
    priceChange24h,
    currencySymbol,
    lastPriceUpdate,
    priceChangePositive,
    selectedNetwork,
    navigate,
    versionInfo,
    updateDismissed,
    setUpdateDismissed,
    chartReady,
    timeframe,
    setTimeframe,
    chartData,
    balanceHistoryUnavailable,
    wsConnected,
    wsState,
    wallets,
    filteredWallets,
    recentTx,
    activityPage,
    activityPageSize,
    activityHasNextPage,
    activityHasPreviousPage,
    activityFetching,
    activitySummary,
    activitySummaryError,
    setActivityPage,
    setActivityPageSize,
    pendingTxs,
    pendingTotals,
    fees,
    feesError,
    formatFeeRate,
    nodeStatus,
    bitcoinStatus,
    mempoolBlocks,
    queuedBlocksSummary,
    lastMempoolUpdate,
    mempoolRefreshing,
    mempoolUnavailable,
    totalBalance,
    walletsUnavailable,
    isMainnet,
    refreshMempoolData,
  } = data;

  // Two wallets is where a Wallets card starts saying something the Total
  // Balance card above it doesn't. Counted from the active network's wallets,
  // not every wallet the user owns.
  const showWallets = filteredWallets.length >= 2;

  // Shared between the welcome and populated branches, which wrap it in
  // different stagger delays.
  const recentActivity = (
    <RecentTransactions
      recentTx={recentTx}
      wallets={wallets}
      confirmationThreshold={bitcoinStatus?.confirmationThreshold}
      deepConfirmationThreshold={bitcoinStatus?.deepConfirmationThreshold}
      page={activityPage}
      pageSize={activityPageSize}
      hasPreviousPage={activityHasPreviousPage}
      hasNextPage={activityHasNextPage}
      isFetching={activityFetching}
      activitySummary={activitySummary}
      activitySummaryError={activitySummaryError}
      timeframe={timeframe}
      onPageChange={setActivityPage}
      onPageSizeChange={setActivityPageSize}
    />
  );

  return (
    <div className="space-y-4 animate-fade-in pb-12">

      {versionInfo?.updateAvailable && !updateDismissed && (
        <UpdateBanner versionInfo={versionInfo} onDismiss={() => setUpdateDismissed(true)} />
      )}

      {/* Page-level period. It scopes the balance chart AND the activity
          summary, so it sits above both rather than inside either — a control
          in one card's header understates what it governs.

          Omitted in the welcome branch: with no wallets there is no chart and
          no activity, so the control would scope nothing. */}
      {filteredWallets.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">
            Dashboard
          </h2>
          <TimeframeControls timeframe={timeframe} setTimeframe={setTimeframe} />
        </div>
      )}

      {/* Welcome state, or the user's own money: balance, then wallets beside activity.

          An empty list means "you have no wallets" only if the request
          succeeded. On failure it means "we could not ask", and inviting a
          funded user to create their first wallet reads as though theirs had
          vanished. */}
      {filteredWallets.length === 0 ? (
        <>
          {walletsUnavailable ? (
            // No wallet list means no wallet ids, so the activity query is
            // disabled and would render "No transactions found" — a second
            // false claim directly beneath the honest one. Say nothing instead.
            <WalletsUnavailable className="animate-fade-in-up-1" />
          ) : (
            <>
              <WelcomeState className="animate-fade-in-up-1" />
              <div className="animate-fade-in-up-2">{recentActivity}</div>
            </>
          )}
        </>
      ) : (
        <>
          {/* Total Balance Card - Full Width */}
          <div className="animate-fade-in-up-1">
            <PriceChart
              totalBalance={totalBalance}
              chartReady={chartReady}
              timeframe={timeframe}
              chartData={chartData}
              historyUnavailable={balanceHistoryUnavailable}
              pendingTotals={pendingTotals}
              walletCount={filteredWallets.length}
            />
          </div>

          {/* Stacked full-width planes. Side-by-side columns forced both
              tables under their comfortable minimum at every viewport below
              1800px, and coupled two independently-sized cards into one row.
              Full width gives each table more room than the old wide column
              did, and lets the two sections collapse independently.

              Wallets earns its own plane only once there is a comparison to
              make. With a single wallet the card would restate the Total
              Balance above it, so the dashboard goes straight to activity. */}
          {showWallets && (
            <div className="animate-fade-in-up-2">
              <WalletSummary
                selectedNetwork={selectedNetwork}
                filteredWallets={filteredWallets}
                totalBalance={totalBalance}
              />
            </div>
          )}
          {/* Delay follows the card actually above it — with Wallets hidden,
              up-3 would leave a visible gap in the stagger. */}
          <div className={showWallets ? 'animate-fade-in-up-3' : 'animate-fade-in-up-2'}>
            {recentActivity}
          </div>
        </>
      )}

      {/* Ambient market/network telemetry - 1 column on phone, 2 on tablet portrait,
          then one column per card at lg+ so a hidden Bitcoin Price doesn't leave a
          gap. `stagger-enter` owns the delays for all children via nth-child, which
          outranks any animate-fade-in-up-* class on a child — don't add one here. */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 gap-4 stagger-enter ${
          isMainnet ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >

        {/* Testnet and signet coins have no market value, so there is no price
            to show. An explanatory placeholder card is still a card the reader
            has to parse and dismiss — omit it instead. */}
        {isMainnet && (
          <BitcoinPriceCard
            btcPrice={btcPrice}
            currencySymbol={currencySymbol}
            priceChange24h={priceChange24h}
            priceChangePositive={priceChangePositive}
            lastPriceUpdate={lastPriceUpdate}
          />
        )}

        <FeeEstimationCard fees={fees} formatFeeRate={formatFeeRate} isError={feesError} />

        <NodeStatusCard
          selectedNetwork={selectedNetwork}
          nodeStatus={nodeStatus}
          bitcoinStatus={bitcoinStatus}
        />
      </div>

      {/* Block Visualizer Section */}
      <div className="animate-fade-in-up-6">
        <MempoolSection
          selectedNetwork={selectedNetwork}
          isMainnet={isMainnet}
          mempoolBlocks={mempoolBlocks}
          mempoolUnavailable={mempoolUnavailable}
          queuedBlocksSummary={queuedBlocksSummary}
          pendingTxs={pendingTxs}
          explorerUrl={bitcoinStatus?.explorerUrl}
          refreshMempoolData={refreshMempoolData}
          mempoolRefreshing={mempoolRefreshing}
          lastMempoolUpdate={lastMempoolUpdate}
          wsConnected={wsConnected}
          wsState={wsState}
          nodeStatus={nodeStatus}
          bitcoinStatus={bitcoinStatus}
          onConfigureNode={() => navigate('/admin/node-config')}
        />
      </div>
    </div>
  );
}
