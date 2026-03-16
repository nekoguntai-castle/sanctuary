import React from 'react';
import { NetworkTabs } from '../NetworkTabs';
import { TrendingUp, TrendingDown, Zap, CheckCircle2, XCircle, Bitcoin, Download, X } from 'lucide-react';
import { useDashboardData } from './hooks/useDashboardData';
import { MempoolSection } from './MempoolSection';
import { AnimatedPrice, PriceChart } from './PriceChart';
import { WalletSummary } from './WalletSummary';
import { RecentTransactions } from './RecentTransactions';
import { SanctuarySpinner } from '../ui/CustomIcons';

export const Dashboard: React.FC = () => {
  const {
    btcPrice,
    priceChange24h,
    currencySymbol,
    lastPriceUpdate,
    priceChangePositive,
    selectedNetwork,
    handleNetworkChange,
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
    walletCounts,
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
    <div className="space-y-6 animate-fade-in pb-12">

      {/* Update Available Banner */}
      {versionInfo?.updateAvailable && !updateDismissed && (
        <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/30">
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

      {/* Network Tabs */}
      <div className="flex items-center justify-between">
        <NetworkTabs
          selectedNetwork={selectedNetwork}
          onNetworkChange={handleNetworkChange}
          walletCounts={walletCounts}
        />
      </div>

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
      />
      </div>

      {/* Top Stats Row - 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* BTC Price Card - Compact with animated price */}
        <div className="surface-glass rounded-2xl p-6 shadow-sm card-interactive animate-fade-in-up-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">Bitcoin Price</h3>
            <div className="p-2 bg-warning-100 dark:bg-warning-900/30 rounded-xl">
              <Bitcoin className="w-5 h-5 text-warning-600 dark:text-warning-400" />
            </div>
          </div>

          {isMainnet ? (
            <>
              <AnimatedPrice value={btcPrice} symbol={currencySymbol} />

              <div className="flex items-center justify-between mt-4">
                <div className={`flex items-center text-sm font-medium ${
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
                {selectedNetwork === 'testnet' ? 'tBTC' : 'sBTC'}
              </span>
              <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 text-center">
                {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} coins have no market value
              </p>
            </div>
          )}
        </div>

        {/* Fee Estimation Card */}
        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-2">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">Fee Estimation</h4>
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
                <div key={tier.label} className="relative group/fee flex justify-between items-center p-2.5 surface-secondary rounded-xl">
                  <div className="flex items-center">
                    <div className={`w-2 h-2 rounded-full ${tier.dot} mr-2`}></div>
                    <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">{tier.label}</span>
                  </div>
                  <span className="font-bold text-sm font-mono tabular-nums text-sanctuary-900 dark:text-sanctuary-100">{formatFeeRate(tier.rate)} sat/vB</span>
                  {/* Fee tooltip */}
                  <div className={`
                    absolute z-50 pointer-events-none
                    text-[11px] font-medium px-3 py-2.5 rounded-lg
                    bg-sanctuary-800 text-sanctuary-100 dark:bg-sanctuary-100 dark:text-sanctuary-900
                    shadow-xl border border-sanctuary-700 dark:border-sanctuary-200
                    whitespace-nowrap
                    bottom-full left-1/2 -translate-x-1/2 mb-2
                    opacity-0 group-hover/fee:opacity-100
                    transition-all duration-200 delay-150
                    group-hover/fee:translate-y-0 translate-y-1
                  `}>
                    <div className="absolute w-2 h-2 rotate-45 bg-sanctuary-800 dark:bg-sanctuary-100 border-sanctuary-700 dark:border-sanctuary-200 -bottom-1 left-1/2 -translate-x-1/2 border-b border-r" />
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

        {/* Node Status Card */}
        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-3">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">Node Status</h4>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                selectedNetwork === 'mainnet'
                  ? 'bg-mainnet-800 dark:bg-mainnet-100 text-mainnet-200 dark:text-mainnet-800'
                  : selectedNetwork === 'testnet'
                  ? 'bg-testnet-800 dark:bg-testnet-100 text-testnet-200 dark:text-testnet-800'
                  : 'bg-signet-800 dark:bg-signet-100 text-signet-200 dark:text-signet-800'
              }`}>
                {selectedNetwork.toUpperCase()}
              </span>
            </div>
            {isMainnet && nodeStatus === 'connected' && <div className="h-2.5 w-2.5 rounded-full bg-success-500 animate-pulse"></div>}
            {isMainnet && nodeStatus === 'error' && <div className="h-2.5 w-2.5 rounded-full bg-rose-500"></div>}
            {isMainnet && nodeStatus === 'checking' && <div className="h-2.5 w-2.5 rounded-full bg-warning-500 animate-pulse"></div>}
            {isMainnet && nodeStatus === 'unknown' && <div className="h-2.5 w-2.5 rounded-full bg-sanctuary-400"></div>}
            {!isMainnet && <div className="h-2.5 w-2.5 rounded-full bg-sanctuary-400"></div>}
          </div>

          {isMainnet ? (
            <div className="flex items-start">
              <div className={`p-2.5 rounded-xl mr-3 transition-colors flex-shrink-0 ${
                nodeStatus === 'connected'
                  ? 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400'
                  : nodeStatus === 'error'
                    ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                    : 'bg-sanctuary-100 text-sanctuary-500'
              }`}>
                <Zap className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Electrum Server
                  </p>
                  {nodeStatus === 'connected' && (
                    <span className="text-xs text-success-600 dark:text-success-400 flex items-center">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Connected
                    </span>
                  )}
                  {nodeStatus === 'error' && (
                    <span className="text-xs text-rose-600 dark:text-rose-400 flex items-center">
                      <XCircle className="w-3 h-3 mr-1" />
                      Error
                    </span>
                  )}
                  {nodeStatus === 'checking' && (
                    <span className="text-xs text-sanctuary-400">Checking...</span>
                  )}
                  {nodeStatus === 'unknown' && (
                    <span className="text-xs text-sanctuary-400">Unknown</span>
                  )}
                </div>
                {nodeStatus === 'connected' && bitcoinStatus && (
                  <div className="mt-2 space-y-0.5">
                    {bitcoinStatus.blockHeight && (
                      <div className="flex items-center text-xs">
                        <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Height:</span>
                        <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono tabular-nums">{bitcoinStatus.blockHeight.toLocaleString()}</span>
                      </div>
                    )}
                    {/* Show Host when pool is disabled, Pool when enabled */}
                    {bitcoinStatus.pool?.enabled ? (
                      <div className="text-xs space-y-1">
                        <div className="flex items-center">
                          <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Pool:</span>
                          <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono">
                            {bitcoinStatus.pool.stats ? (
                              <span>
                                {bitcoinStatus.pool.stats.activeConnections}/{bitcoinStatus.pool.stats.totalConnections}
                                <span className="text-sanctuary-400 ml-1">
                                  (active/total)
                                </span>
                              </span>
                            ) : 'initializing...'}
                          </span>
                        </div>
                        {/* Per-server stats when multiple servers configured */}
                        {bitcoinStatus.pool.stats?.servers && bitcoinStatus.pool.stats.servers.length > 0 && (
                          <div className="ml-14 space-y-0.5">
                            {bitcoinStatus.pool.stats.servers.map((server: { serverId: string; label: string; connectionCount: number; healthyConnections: number; isHealthy: boolean; lastHealthCheck: string | null }) => (
                              <div key={server.serverId} className="flex items-center text-[10px]">
                                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                  !server.lastHealthCheck
                                    ? 'bg-sanctuary-400' // Not yet checked
                                    : server.isHealthy
                                      ? 'bg-success-500' // Healthy
                                      : 'bg-warning-500'   // Unhealthy
                                }`} />
                                <span className="text-sanctuary-500 truncate max-w-[100px]">{server.label}</span>
                                <span className="text-sanctuary-400 ml-1">
                                  ({server.connectionCount} conn{server.connectionCount !== 1 ? 's' : ''})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : bitcoinStatus.host && (
                      <div className="flex items-center text-xs">
                        <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Host:</span>
                        <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono truncate">
                          {bitcoinStatus.useSsl && <span className="text-success-500 mr-1">🔒</span>}
                          {bitcoinStatus.host}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {nodeStatus === 'error' && bitcoinStatus?.error && (
                  <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 truncate">
                    {bitcoinStatus.error}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start">
              <div className="p-2.5 rounded-xl mr-3 bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 flex-shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Electrum Server
                </p>
                <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-1">
                  {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} node not configured
                </p>
                <p className="text-xs text-sanctuary-400 mt-1">
                  Configure in Settings → Node Configuration
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

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
