import React from 'react';
import { TabNetwork } from '../NetworkTabs';
import { BlockVisualizer } from '../BlockVisualizer';
import type { BitcoinStatus, BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';
import { formatNetworkTitle, getNetworkColorClass } from '../../src/app/networks';
import { Bitcoin, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { PendingTransaction } from '../../types';

type NodeStatusValue = 'unknown' | 'checking' | 'connected' | 'error';

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
  nodeStatus: NodeStatusValue;
  bitcoinStatus: BitcoinStatus | undefined;
  onConfigureNode: () => void;
}

interface WebSocketStatusProps {
  connected: boolean;
  state: string;
}

function getNetworkLabel(selectedNetwork: TabNetwork) {
  return formatNetworkTitle(selectedNetwork);
}

function getNetworkBadgeClass(selectedNetwork: TabNetwork) {
  return getNetworkColorClass(selectedNetwork, 'subtleBadge');
}

function getNetworkIconClass(selectedNetwork: TabNetwork) {
  return getNetworkColorClass(selectedNetwork, 'iconText');
}

function getNetworkIconBackgroundClass(selectedNetwork: TabNetwork) {
  return getNetworkColorClass(selectedNetwork, 'iconBackground');
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

function WebSocketStatus({ connected, state }: WebSocketStatusProps) {
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
  nodeStatus,
}: Pick<
  MempoolSectionProps,
  | 'selectedNetwork'
  | 'isMainnet'
  | 'refreshMempoolData'
  | 'mempoolRefreshing'
  | 'lastMempoolUpdate'
  | 'wsConnected'
  | 'wsState'
  | 'nodeStatus'
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
      {!isMainnet && nodeStatus === 'connected' && (
        <MempoolRefreshButton
          onRefresh={refreshMempoolData}
          refreshing={mempoolRefreshing}
          lastUpdate={lastMempoolUpdate}
        />
      )}
    </div>
  );
}

function BlockVisualizerContent({
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
  nodeStatus,
  bitcoinStatus,
  onConfigureNode,
}: {
  selectedNetwork: TabNetwork;
  nodeStatus: NodeStatusValue;
  bitcoinStatus: BitcoinStatus | undefined;
  onConfigureNode: () => void;
}) {
  const label = getNetworkLabel(selectedNetwork);
  const title = nodeStatus === 'checking'
    ? `Checking ${label} Node`
    : `${label} Node Needs Attention`;
  const description = bitcoinStatus?.error || `Open Node Configuration to review ${selectedNetwork} Electrum settings.`;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className={`p-4 rounded-xl mb-4 ${getNetworkIconBackgroundClass(selectedNetwork)}`}>
        <Bitcoin className={`w-10 h-10 ${getNetworkIconClass(selectedNetwork)}`} />
      </div>
      <h4 className="text-lg font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
        {title}
      </h4>
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md">
        {description}
      </p>
      <button
        onClick={onConfigureNode}
        className="mt-4 px-4 py-2 rounded-md text-sm font-medium transition-colors text-sanctuary-500 dark:text-sanctuary-400 border border-sanctuary-200 dark:border-sanctuary-700/50 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 hover:border-sanctuary-300 dark:hover:border-sanctuary-600"
      >
        Open Node Config
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
  nodeStatus,
  bitcoinStatus,
  onConfigureNode,
}) => {
  const showBlockVisualizer = isMainnet || nodeStatus === 'connected';

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
        nodeStatus={nodeStatus}
      />
      {showBlockVisualizer ? (
        <BlockVisualizerContent
          mempoolBlocks={mempoolBlocks}
          queuedBlocksSummary={queuedBlocksSummary}
          pendingTxs={pendingTxs}
          explorerUrl={explorerUrl}
          refreshMempoolData={refreshMempoolData}
        />
      ) : (
        <NonMainnetMempoolContent
          selectedNetwork={selectedNetwork}
          nodeStatus={nodeStatus}
          bitcoinStatus={bitcoinStatus}
          onConfigureNode={onConfigureNode}
        />
      )}
    </div>
  );
};
