import React from 'react';
import { Globe, ChevronRight } from 'lucide-react';
import { NetworkConnectionCard } from '../NetworkConnectionCard';
import { NetworkConnectionsSectionProps } from './types';
import { NetworkTabsRow } from './NetworkTabsRow';

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
          <NetworkTabsRow
            nodeConfig={nodeConfig}
            activeNetworkTab={activeNetworkTab}
            onNetworkTabChange={onNetworkTabChange}
            getServerCount={(network) => getServersForNetwork(network).length}
          />

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
