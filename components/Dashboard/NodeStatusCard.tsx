import React from 'react';
import { Zap, CheckCircle2, XCircle } from 'lucide-react';
import { TabNetwork } from '../NetworkTabs';
import { BitcoinStatus } from '../../src/api/bitcoin';
import { getNetworkColorClass } from '../../src/app/networks';
import { Card } from '../ui/Card';

type NodeStatusValue = 'unknown' | 'checking' | 'connected' | 'error';

interface NodeStatusCardProps {
  isMainnet: boolean;
  selectedNetwork: TabNetwork;
  nodeStatus: NodeStatusValue;
  bitcoinStatus: BitcoinStatus | undefined;
}

const StatusIndicator: React.FC<{ nodeStatus: NodeStatusValue }> = ({ nodeStatus }) => {
  switch (nodeStatus) {
    case 'connected': return <div className="h-3 w-3 rounded-full bg-success-500 animate-connected-glow"></div>;
    case 'error': return <div className="h-3 w-3 rounded-full bg-rose-500"></div>;
    case 'checking': return <div className="h-3 w-3 rounded-full bg-warning-500 animate-checking-glow"></div>;
    default: return <div className="h-3 w-3 rounded-full bg-sanctuary-400"></div>;
  }
};

const StatusLabel: React.FC<{ nodeStatus: NodeStatusValue }> = ({ nodeStatus }) => {
  switch (nodeStatus) {
    case 'connected':
      return (
        <span className="text-xs text-success-600 dark:text-success-400 flex items-center">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Connected
        </span>
      );
    case 'error':
      return (
        <span className="text-xs text-rose-600 dark:text-rose-400 flex items-center">
          <XCircle className="w-3 h-3 mr-1" />
          Error
        </span>
      );
    case 'checking':
      return <span className="text-xs text-sanctuary-400">Checking...</span>;
    default:
      return <span className="text-xs text-sanctuary-400">Unknown</span>;
  }
};

const getNetworkBadgeClass = (selectedNetwork: TabNetwork): string => {
  return getNetworkColorClass(selectedNetwork, 'subtleBadge');
};

const PoolDisplay: React.FC<{ bitcoinStatus: BitcoinStatus }> = ({ bitcoinStatus }) => {
  const pool = bitcoinStatus.pool;
  if (!pool?.enabled) {
    if (!bitcoinStatus.host) return null;
    return (
      <div className="flex items-center text-xs">
        <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Host:</span>
        <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono truncate">
          {bitcoinStatus.useSsl && <span className="text-success-500 mr-1">🔒</span>}
          {bitcoinStatus.host}
        </span>
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <div className="flex items-center">
        <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Pool:</span>
        <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono">
          {pool.stats ? (
            <span>
              {pool.stats.activeConnections}/{pool.stats.totalConnections}
              <span className="text-sanctuary-400 ml-1">
                (active/total)
              </span>
            </span>
          ) : 'initializing...'}
        </span>
      </div>
      {pool.stats?.servers && pool.stats.servers.length > 0 && (
        <div className="ml-14 space-y-0.5">
          {pool.stats.servers.map((server) => (
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
  );
};

const MainnetContent: React.FC<{ nodeStatus: NodeStatusValue; bitcoinStatus: BitcoinStatus | undefined }> = ({ nodeStatus, bitcoinStatus }) => (
  <div className="flex items-start">
    <div className={`p-2.5 rounded-lg mr-3 transition-colors flex-shrink-0 ${
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
        <StatusLabel nodeStatus={nodeStatus} />
      </div>
      {nodeStatus === 'connected' && bitcoinStatus && (
        <div className="mt-2 space-y-0.5">
          {bitcoinStatus.blockHeight && (
            <div className="flex items-center text-xs">
              <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Height:</span>
              <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono tabular-nums">{bitcoinStatus.blockHeight.toLocaleString()}</span>
            </div>
          )}
          <PoolDisplay bitcoinStatus={bitcoinStatus} />
        </div>
      )}
      {nodeStatus === 'error' && bitcoinStatus?.error && (
        <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 truncate">
          {bitcoinStatus.error}
        </div>
      )}
    </div>
  </div>
);

const NetworkUnavailableContent: React.FC<{
  selectedNetwork: TabNetwork;
  nodeStatus: NodeStatusValue;
  bitcoinStatus: BitcoinStatus | undefined;
}> = ({ selectedNetwork, nodeStatus, bitcoinStatus }) => {
  const label = selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1);
  const message = nodeStatus === 'checking'
    ? 'Checking configured Electrum server...'
    : bitcoinStatus?.error || `${label} node status is unavailable`;

  return (
    <div className="flex items-start">
      <div className="p-2.5 rounded-lg mr-3 bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 flex-shrink-0">
        <Zap className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Electrum Server
        </p>
        <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-1">
          {message}
        </p>
        <p className="text-xs text-sanctuary-400 mt-1">
          Open Admin → Node Config to review {label} settings.
        </p>
      </div>
    </div>
  );
};

export const NodeStatusCard: React.FC<NodeStatusCardProps> = ({
  isMainnet,
  selectedNetwork,
  nodeStatus,
  bitcoinStatus,
}) => (
  // No stagger class: the telemetry row's `stagger-enter` parent owns the
  // per-child delay via nth-child, which outranks any animate-fade-in-up-*.
  <Card interactive>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center space-x-2">
        <h3 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Node Status</h3>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getNetworkBadgeClass(selectedNetwork)}`}>
          {selectedNetwork.toUpperCase()}
        </span>
      </div>
      <StatusIndicator nodeStatus={nodeStatus} />
    </div>

    {isMainnet || nodeStatus === 'connected' ? (
      <MainnetContent nodeStatus={nodeStatus} bitcoinStatus={bitcoinStatus} />
    ) : (
      <NetworkUnavailableContent
        selectedNetwork={selectedNetwork}
        nodeStatus={nodeStatus}
        bitcoinStatus={bitcoinStatus}
      />
    )}
  </Card>
);
