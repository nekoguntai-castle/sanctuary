import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TabNetwork } from '../NetworkTabs';
import { BlockVisualizer } from '../BlockVisualizer';
import type { BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';
import { Bitcoin, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { PendingTransaction } from '../../types';

interface MempoolSectionProps {
  selectedNetwork: TabNetwork;
  isMainnet: boolean;
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;
  pendingTxs: PendingTransaction[];
  explorerUrl: string | undefined;
  refreshMempoolData: () => void;
  mempoolRefreshing: boolean;
  lastMempoolUpdate: Date | null;
  wsConnected: boolean;
  wsState: string;
}

function getNetworkLabel(selectedNetwork: TabNetwork) {
  return selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1);
}

function getNetworkBadgeClass(selectedNetwork: TabNetwork) {
  return selectedNetwork === 'testnet'
    ? 'bg-testnet-500/8 dark:bg-testnet-400/10 text-testnet-600 dark:text-testnet-400'
    : 'bg-signet-500/8 dark:bg-signet-400/10 text-signet-600 dark:text-signet-400';
}

function getNetworkIconClass(selectedNetwork: TabNetwork) {
  return selectedNetwork === 'testnet'
    ? 'text-testnet-500 dark:text-testnet-200'
    : 'text-signet-500 dark:text-signet-200';
}

function getNetworkIconBackgroundClass(selectedNetwork: TabNetwork) {
  return selectedNetwork === 'testnet'
    ? 'bg-testnet-100 dark:bg-testnet-900/20'
    : 'bg-signet-100 dark:bg-signet-900/20';
}

function NetworkTitle({
  selectedNetwork,
  isMainnet,
}: {
  selectedNetwork: TabNetwork;
  isMainnet: boolean;
}) {
  return (
    <div className="flex items-center space-x-2">
      <h4 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">
        {isMainnet ? 'Bitcoin' : getNetworkLabel(selectedNetwork)} Network Status
      </h4>
      {!isMainnet && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getNetworkBadgeClass(selectedNetwork)}`}>
          {selectedNetwork.toUpperCase()}
        </span>
      )}
    </div>
  );
}

function MempoolRefreshButton({
  onRefresh,
  refreshing,
  lastUpdate,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdate: Date | null;
}) {
  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      className="flex items-center text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200 transition-colors disabled:opacity-50"
      title="Refresh mempool data"
    >
      <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
      {lastUpdate && (
        <span className="hidden sm:inline">
          {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </button>
  );
}

function WebSocketStatus({
  connected,
  state,
}: {
  connected: boolean;
  state: string;
}) {
  if (connected) {
    return (
      <div className="flex items-center text-xs">
        <Wifi className="w-3.5 h-3.5 text-success-500 mr-1.5" />
        <span className="text-success-600 dark:text-success-400 font-medium">Live</span>
      </div>
    );
  }

  if (state === 'connecting') {
    return (
      <div className="flex items-center text-xs">
        <div className="w-3.5 h-3.5 rounded-full border border-warning-500 border-t-transparent animate-spin mr-1.5"></div>
        <span className="text-warning-600 dark:text-warning-400 font-medium">Connecting</span>
      </div>
    );
  }

  return (
    <div className="flex items-center text-xs">
      <WifiOff className="w-3.5 h-3.5 text-sanctuary-400 mr-1.5" />
      <span className="text-sanctuary-500 dark:text-sanctuary-400">Offline</span>
    </div>
  );
}

function TipSyncStatus() {
  return (
    <div className="flex items-center text-xs text-sanctuary-400">
      <span className="w-2 h-2 rounded-full bg-success-500 mr-2 animate-pulse"></span>
      Synced to Tip
    </div>
  );
}

function MainnetStatusControls({
  refreshMempoolData,
  mempoolRefreshing,
  lastMempoolUpdate,
  wsConnected,
  wsState,
}: Pick<
  MempoolSectionProps,
  'refreshMempoolData' | 'mempoolRefreshing' | 'lastMempoolUpdate' | 'wsConnected' | 'wsState'
>) {
  return (
    <div className="flex items-center space-x-4">
      <MempoolRefreshButton
        onRefresh={refreshMempoolData}
        refreshing={mempoolRefreshing}
        lastUpdate={lastMempoolUpdate}
      />
      <WebSocketStatus connected={wsConnected} state={wsState} />
      <TipSyncStatus />
    </div>
  );
}

function MempoolSectionHeader({
  selectedNetwork,
  isMainnet,
  refreshMempoolData,
  mempoolRefreshing,
  lastMempoolUpdate,
  wsConnected,
  wsState,
}: Pick<
  MempoolSectionProps,
  | 'selectedNetwork'
  | 'isMainnet'
  | 'refreshMempoolData'
  | 'mempoolRefreshing'
  | 'lastMempoolUpdate'
  | 'wsConnected'
  | 'wsState'
>) {
  return (
    <div className="flex items-center justify-between px-2 mb-2">
      <NetworkTitle selectedNetwork={selectedNetwork} isMainnet={isMainnet} />
      {isMainnet && (
        <MainnetStatusControls
          refreshMempoolData={refreshMempoolData}
          mempoolRefreshing={mempoolRefreshing}
          lastMempoolUpdate={lastMempoolUpdate}
          wsConnected={wsConnected}
          wsState={wsState}
        />
      )}
    </div>
  );
}

function MainnetMempoolContent({
  mempoolBlocks,
  queuedBlocksSummary,
  pendingTxs,
  explorerUrl,
  refreshMempoolData,
}: Pick<
  MempoolSectionProps,
  'mempoolBlocks' | 'queuedBlocksSummary' | 'pendingTxs' | 'explorerUrl' | 'refreshMempoolData'
>) {
  return (
    <BlockVisualizer
      blocks={mempoolBlocks}
      queuedBlocksSummary={queuedBlocksSummary}
      pendingTxs={pendingTxs}
      explorerUrl={explorerUrl}
      onRefresh={refreshMempoolData}
    />
  );
}

function NonMainnetMempoolContent({
  selectedNetwork,
  onConfigureNode,
}: {
  selectedNetwork: TabNetwork;
  onConfigureNode: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className={`p-4 rounded-xl mb-4 ${getNetworkIconBackgroundClass(selectedNetwork)}`}>
        <Bitcoin className={`w-10 h-10 ${getNetworkIconClass(selectedNetwork)}`} />
      </div>
      <h4 className="text-lg font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
        {getNetworkLabel(selectedNetwork)} Node Not Configured
      </h4>
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md">
        Configure an Electrum server for {selectedNetwork} in Settings to see mempool and block data.
      </p>
      <button
        onClick={onConfigureNode}
        className="mt-4 px-4 py-2 rounded-md text-sm font-medium transition-colors text-sanctuary-500 dark:text-sanctuary-400 border border-sanctuary-200 dark:border-sanctuary-700/50 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 hover:border-sanctuary-300 dark:hover:border-sanctuary-600"
      >
        Configure Node
      </button>
    </div>
  );
}

export const MempoolSection: React.FC<MempoolSectionProps> = ({
  selectedNetwork,
  isMainnet,
  mempoolBlocks,
  queuedBlocksSummary,
  pendingTxs,
  explorerUrl,
  refreshMempoolData,
  mempoolRefreshing,
  lastMempoolUpdate,
  wsConnected,
  wsState,
}) => {
  const navigate = useNavigate();

  return (
    <div className="surface-elevated rounded-xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive">
       <MempoolSectionHeader
          selectedNetwork={selectedNetwork}
          isMainnet={isMainnet}
          refreshMempoolData={refreshMempoolData}
          mempoolRefreshing={mempoolRefreshing}
          lastMempoolUpdate={lastMempoolUpdate}
          wsConnected={wsConnected}
          wsState={wsState}
       />
       {isMainnet ? (
          <MainnetMempoolContent
            mempoolBlocks={mempoolBlocks}
            queuedBlocksSummary={queuedBlocksSummary}
            pendingTxs={pendingTxs}
            explorerUrl={explorerUrl}
            refreshMempoolData={refreshMempoolData}
          />
       ) : (
          <NonMainnetMempoolContent
            selectedNetwork={selectedNetwork}
            onConfigureNode={() => navigate('/settings/node')}
          />
       )}
    </div>
  );
};
