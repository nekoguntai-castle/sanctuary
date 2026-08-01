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

          {/* Side by side on wide screens: what you own next to what just
              happened. items-start so the shorter card doesn't stretch.

              1800px, not 2xl. The sidebar takes 256px and the content wrapper
              64px of padding, so a 1536px viewport leaves ~600px per column —
              under the wallet table's ~548px minimum plus the transaction
              table's ~714px. At 1800px+ the "wide" cap gives ~740px columns,
              which both tables clear. */}
          <div className="grid grid-cols-1 min-[1800px]:grid-cols-2 gap-4 items-start">
            <div className="animate-fade-in-up-2">
              <WalletSummary
                selectedNetwork={selectedNetwork}
                filteredWallets={filteredWallets}
                totalBalance={totalBalance}
              />
            </div>
            <div className="animate-fade-in-up-3">{recentActivity}</div>
          </div>
        </>
      )}

      {/* Ambient market/network telemetry - 3 columns at lg+, 2 on tablet portrait, 1 on phone.
          `stagger-enter` owns the delays for all three children via nth-child, which
          outranks any animate-fade-in-up-* class on a child — don't add one here. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-enter">

        <BitcoinPriceCard
          isMainnet={isMainnet}
          selectedNetwork={selectedNetwork}
          btcPrice={btcPrice}
          currencySymbol={currencySymbol}
          priceChange24h={priceChange24h}
          priceChangePositive={priceChangePositive}
          lastPriceUpdate={lastPriceUpdate}
        />

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
