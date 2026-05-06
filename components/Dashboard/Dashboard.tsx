import React from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Zap, Bitcoin, Download, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useDashboardData } from './hooks/useDashboardData';
import { MempoolSection } from './MempoolSection';
import { NodeStatusCard } from './NodeStatusCard';
import { AnimatedPrice, PriceChart } from './PriceChart';
import { AnimatedFeeRate } from './AnimatedFeeRate';
import { WalletSummary } from './WalletSummary';
import { RecentTransactions } from './RecentTransactions';
import { SanctuarySpinner, SanctuaryLogo } from '../ui/CustomIcons';
import { formatNetworkTitle } from '../../src/app/networks';

export const Dashboard: React.FC = () => {
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
    fees,
    formatFeeRate,
    nodeStatus,
    bitcoinStatus,
    mempoolBlocks,
    queuedBlocksSummary,
    lastMempoolUpdate,
    mempoolRefreshing,
    totalBalance,
    loading,
    isMainnet,
    refreshMempoolData,
  } = useDashboardData();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <SanctuarySpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in pb-12">

      {/* Update Available Banner */}
      {versionInfo?.updateAvailable && !updateDismissed && (
        <div className="surface-elevated rounded-xl p-4 shadow-sm border border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-success-100 dark:bg-success-800/50 rounded-lg">
                <Download className="w-5 h-5 text-success-600 dark:text-success-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-50">
                  Update Available: v{versionInfo.latestVersion}
                </h3>
                <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400">
                  You're running v{versionInfo.currentVersion}
                  {versionInfo.releaseName && ` • ${versionInfo.releaseName}`}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <a
                href={versionInfo.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm font-semibold text-white bg-sanctuary-800 hover:bg-sanctuary-900 dark:bg-sanctuary-100 dark:text-sanctuary-900 dark:hover:bg-white rounded-lg transition-colors"
              >
                View Release
              </a>
              <button
                onClick={() => setUpdateDismissed(true)}
                className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:text-sanctuary-500 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Visualizer Section */}
      <div className="animate-fade-in-up-4">
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

      {/* Top Stats Row - 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-enter">

        {/* BTC Price Card - Compact with animated price */}
        <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Bitcoin Price</h3>
            <div className="p-2 bg-warning-100 dark:bg-warning-900/30 rounded-lg">
              <Bitcoin className="w-5 h-5 text-warning-600 dark:text-warning-400" />
            </div>
          </div>

          {isMainnet ? (
            <>
              <AnimatedPrice value={btcPrice} symbol={currencySymbol} />

              <div className="flex items-center justify-between mt-4">
                <div data-testid="price-change-24h" className={`flex items-center text-sm font-medium ${
                  priceChange24h === null
                    ? 'text-sanctuary-400'
                    : priceChangePositive
                      ? 'text-success-600 dark:text-success-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}>
                  {priceChange24h !== null && (
                    priceChangePositive ? (
                      <TrendingUp className="w-4 h-4 mr-1" />
                    ) : (
                      <TrendingDown className="w-4 h-4 mr-1" />
                    )
                  )}
                  {priceChange24h !== null ? `${priceChangePositive ? '+' : ''}${priceChange24h.toFixed(2)}%` : '---'}
                  <span className="text-sanctuary-400 font-normal ml-2">24h</span>
                </div>
                {lastPriceUpdate && (
                  <span className="text-xs text-sanctuary-400">
                    {lastPriceUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-4">
              <span className="text-2xl font-bold text-sanctuary-400 dark:text-sanctuary-500 mb-2">
                {selectedNetwork === 'signet' ? 'sBTC' : 'tBTC'}
              </span>
              <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 text-center">
                {formatNetworkTitle(selectedNetwork)} coins have no market value
              </p>
            </div>
          )}
        </div>

        {/* Fee Estimation Card */}
        <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-2">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Fee Estimation</h4>
            <Zap className="w-4 h-4 text-warning-500" />
          </div>
          <div className="space-y-2">
            {[
              { label: 'Fast', rate: fees?.fast, dot: 'bg-success-500', time: '~10 min / ~1 block' },
              { label: 'Normal', rate: fees?.medium, dot: 'bg-warning-500', time: '~30 min / ~3 blocks' },
              { label: 'Slow', rate: fees?.slow, dot: 'bg-sanctuary-400', time: '~60 min / ~6 blocks' },
            ].map((tier) => {
              const typicalVb = 140;
              const estSats = tier.rate !== undefined ? Math.round(tier.rate * typicalVb) : undefined;
              return (
                <div key={tier.label} className="relative group/fee flex justify-between items-center p-2.5 surface-secondary rounded-lg">
                  <div className="flex items-center">
                    <div className={`w-2 h-2 rounded-full ${tier.dot} mr-2`}></div>
                    <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">{tier.label}</span>
                  </div>
                  <span className="font-bold text-sm font-mono tabular-nums text-sanctuary-900 dark:text-sanctuary-100">
                    <AnimatedFeeRate value={formatFeeRate(tier.rate)} />
                  </span>
                  {/* Fee tooltip */}
                  <div className="tooltip-popup bottom-full left-1/2 -translate-x-1/2 mb-2">
                    <div className="tooltip-arrow -bottom-1 left-1/2 -translate-x-1/2 border-b border-r" />
                    <div>{tier.time}</div>
                    {estSats !== undefined && (
                      <div className="text-sanctuary-400 dark:text-sanctuary-500 tabular-nums">
                        ~{estSats.toLocaleString()} sats for typical tx (~{typicalVb} vB)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <NodeStatusCard
          isMainnet={isMainnet}
          selectedNetwork={selectedNetwork}
          nodeStatus={nodeStatus}
          bitcoinStatus={bitcoinStatus}
        />
      </div>

      {/* Welcome state or Balance/Wallets */}
      {filteredWallets.length === 0 ? (
        <div className="animate-fade-in-up-5 surface-elevated rounded-xl p-12 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 text-center relative overflow-hidden">
          {/* Ambient glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-primary-100/40 dark:bg-primary-900/15 blur-3xl pointer-events-none" />
          <div className="relative z-10">
            <SanctuaryLogo className="h-16 w-16 mx-auto text-primary-500 dark:text-primary-400 mb-6 logo-breathe" />
            <h2 className="text-2xl text-sanctuary-800 dark:text-sanctuary-200 mb-2">
              Welcome to Sanctuary
            </h2>
            <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md mx-auto mb-6">
              Your self-hosted Bitcoin wallet coordinator. Create or import a wallet to begin managing your Bitcoin with full sovereignty.
            </p>
            <Link to="/wallets/create">
              <Button variant="primary" size="lg">
                Create Your First Wallet
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Total Balance Card - Full Width */}
          <div className="animate-fade-in-up-5">
            <PriceChart
              totalBalance={totalBalance}
              chartReady={chartReady}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              chartData={chartData}
            />
          </div>

          {/* Wallet Breakdown Section (Table View) */}
          <div className="animate-fade-in-up-6">
            <WalletSummary
              selectedNetwork={selectedNetwork}
              filteredWallets={filteredWallets}
              totalBalance={totalBalance}
            />
          </div>
        </>
      )}

      {/* Recent Activity */}
      <div className="animate-fade-in-up-7">
        <RecentTransactions
          recentTx={recentTx}
          wallets={wallets}
          confirmationThreshold={bitcoinStatus?.confirmationThreshold}
          deepConfirmationThreshold={bitcoinStatus?.deepConfirmationThreshold}
        />
      </div>
    </div>
  );
};
