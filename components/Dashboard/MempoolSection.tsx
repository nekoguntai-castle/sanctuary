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
    <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
       <div className="flex items-center justify-between px-2 mb-2">
          <div className="flex items-center space-x-2">
             <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">
                {selectedNetwork === 'mainnet' ? 'Bitcoin' : selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Network Status
             </h4>
             {!isMainnet && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                   selectedNetwork === 'testnet'
                      ? 'bg-testnet-800 dark:bg-testnet-100 text-testnet-200 dark:text-testnet-800'
                      : 'bg-signet-800 dark:bg-signet-100 text-signet-200 dark:text-signet-800'
                }`}>
                   {selectedNetwork.toUpperCase()}
                </span>
             )}
          </div>
          {isMainnet && (
             <div className="flex items-center space-x-4">
                {/* Manual refresh button */}
                <button
                   onClick={refreshMempoolData}
                   disabled={mempoolRefreshing}
                   className="flex items-center text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200 transition-colors disabled:opacity-50"
                   title="Refresh mempool data"
                >
                   <RefreshCw className={`w-3.5 h-3.5 mr-1 ${mempoolRefreshing ? 'animate-spin' : ''}`} />
                   {lastMempoolUpdate && (
                      <span className="hidden sm:inline">
                         {lastMempoolUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                   )}
                </button>
                {/* WebSocket Status */}
                <div className="flex items-center text-xs">
                   {wsConnected ? (
                      <>
                         <Wifi className="w-3.5 h-3.5 text-success-500 mr-1.5" />
                         <span className="text-success-600 dark:text-success-400 font-medium">Live</span>
                      </>
                   ) : wsState === 'connecting' ? (
                      <>
                         <div className="w-3.5 h-3.5 rounded-full border-2 border-warning-500 border-t-transparent animate-spin mr-1.5"></div>
                         <span className="text-warning-600 dark:text-warning-400 font-medium">Connecting</span>
                      </>
                   ) : (
                      <>
                         <WifiOff className="w-3.5 h-3.5 text-sanctuary-400 mr-1.5" />
                         <span className="text-sanctuary-500 dark:text-sanctuary-400">Offline</span>
                      </>
                   )}
                </div>
                {/* Sync Status */}
                <div className="flex items-center text-xs text-sanctuary-400">
                   <span className="w-2 h-2 rounded-full bg-success-500 mr-2 animate-pulse"></span>
                   Synced to Tip
                </div>
             </div>
          )}
       </div>
       {isMainnet ? (
          <BlockVisualizer
             blocks={mempoolBlocks}
             queuedBlocksSummary={queuedBlocksSummary}
             pendingTxs={pendingTxs}
             explorerUrl={explorerUrl}
             onRefresh={refreshMempoolData}
          />
       ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
             <div className={`p-4 rounded-2xl mb-4 ${
                selectedNetwork === 'testnet'
                   ? 'bg-testnet-100 dark:bg-testnet-900/20'
                   : 'bg-signet-100 dark:bg-signet-900/20'
             }`}>
                <Bitcoin className={`w-10 h-10 ${
                   selectedNetwork === 'testnet'
                      ? 'text-testnet-500 dark:text-testnet-200'
                      : 'text-signet-500 dark:text-signet-200'
                }`} />
             </div>
             <h4 className="text-lg font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Node Not Configured
             </h4>
             <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md">
                Configure an Electrum server for {selectedNetwork} in Settings to see mempool and block data.
             </p>
             <button
                onClick={() => navigate('/settings/node')}
                className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                   selectedNetwork === 'testnet'
                      ? 'bg-testnet-800 dark:bg-testnet-100 text-testnet-200 dark:text-testnet-800 hover:bg-testnet-700 dark:hover:bg-testnet-200'
                      : 'bg-signet-800 dark:bg-signet-100 text-signet-200 dark:text-signet-800 hover:bg-signet-700 dark:hover:bg-signet-200'
                }`}
             >
                Configure Node
             </button>
          </div>
       )}
    </div>
  );
};
