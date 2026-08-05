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
    wsConnected,
    wsState,
    wallets,
    filteredWallets,
    recentTx,
    pendingTxs,
    pendingTotals,
    fees,
    formatFeeRate,
    nodeStatus,
    bitcoinStatus,
    mempoolBlocks,
    queuedBlocksSummary,
    lastMempoolUpdate,
    mempoolRefreshing,
    totalBalance,
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
    />
  );

  return (
    <div className="space-y-4 animate-fade-in pb-12">

      {versionInfo?.updateAvailable && !updateDismissed && (
        <UpdateBanner versionInfo={versionInfo} onDismiss={() => setUpdateDismissed(true)} />
      )}

      {/* Welcome state, or the user's own money: balance, then wallets beside activity */}
      {filteredWallets.length === 0 ? (
        <>
          <WelcomeState className="animate-fade-in-up-1" />
          <div className="animate-fade-in-up-2">{recentActivity}</div>
        </>
      ) : (
        <>
          {/* Total Balance Card - Full Width */}
          <div className="animate-fade-in-up-1">
            <PriceChart
              totalBalance={totalBalance}
              chartReady={chartReady}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              chartData={chartData}
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

        <FeeEstimationCard fees={fees} formatFeeRate={formatFeeRate} />

        <NodeStatusCard
          isMainnet={isMainnet}
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
