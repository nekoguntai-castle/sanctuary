import React from 'react';
import { Globe, ChevronRight } from 'lucide-react';
import { NetworkConnectionCard } from '../NetworkConnectionCard';
import { NetworkConnectionsSectionProps } from './types';

export const NetworkConnectionsSection: React.FC<NetworkConnectionsSectionProps> = ({
  nodeConfig,
  servers,
  poolStats,
  activeNetworkTab,
  onNetworkTabChange,
  onConfigChange,
  onServersChange,
  onTestConnection,
  expanded,
  onToggle,
  summary,
}) => {
  // Get servers filtered by network
  const getServersForNetwork = (network: 'mainnet' | 'testnet' | 'signet') => {
    return servers.filter(s => s.network === network).sort((a, b) => a.priority - b.priority);
  };

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
            <Globe className="w-4 h-4" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Network Connections</h3>
            <p className="text-xs text-sanctuary-500">{summary}</p>
          </div>
        </div>
        <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-sanctuary-100 dark:border-sanctuary-800">
          {/* Network Tabs */}
          <div className="flex border-b border-sanctuary-100 dark:border-sanctuary-800">
            {(['mainnet', 'testnet', 'signet'] as const).map((network) => {
              const isEnabled = network === 'mainnet' ||
                (network === 'testnet' && nodeConfig.testnetEnabled) ||
                (network === 'signet' && nodeConfig.signetEnabled);
              const serverCount = getServersForNetwork(network).length;
              const networkColors: Record<string, string> = {
                mainnet: 'border-mainnet-500 text-mainnet-600 dark:text-mainnet-400',
                testnet: 'border-testnet-500 text-testnet-600 dark:text-testnet-400',
                signet: 'border-signet-500 text-signet-600 dark:text-signet-400',
              };

              return (
                <button
                  key={network}
                  onClick={() => onNetworkTabChange(network)}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeNetworkTab === network
                      ? networkColors[network]
                      : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  <span className="capitalize">{network}</span>
                  {isEnabled && (
                    <span className="ml-1.5 text-xs text-sanctuary-400">
                      {serverCount > 0 ? `(${serverCount})` : ''}
                    </span>
                  )}
                  {!isEnabled && (
                    <span className="ml-1.5 text-xs text-sanctuary-400">(off)</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Network Card */}
          <div className="p-4">
            <NetworkConnectionCard
              key={activeNetworkTab}
              network={activeNetworkTab}
              config={nodeConfig}
              servers={getServersForNetwork(activeNetworkTab)}
              poolStats={poolStats}
              onConfigChange={(updates) => onConfigChange({ ...nodeConfig, ...updates })}
              onServersChange={(updatedServers) => onServersChange(activeNetworkTab, updatedServers)}
              onTestConnection={onTestConnection}
            />
          </div>
        </div>
      )}
    </div>
  );
};
