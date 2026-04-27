import React from 'react';
import {
  Trash2,
  Edit2,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  Clock,
} from 'lucide-react';
import { ElectrumServer } from '../../types';
import * as bitcoinApi from '../../src/api/bitcoin';
import { HealthHistoryBlocks } from './HealthHistoryBlocks';
import {
  getFallbackHealthBlockClass,
  getFallbackHealthTitle,
  getHealthIndicatorClass,
  getProtocolBadgeClass,
  getServerRowClass,
  isServerCoolingDown,
} from './serverRowModel';

interface ServerRowProps {
  server: ElectrumServer;
  index: number;
  totalServers: number;
  serverTestStatus: 'idle' | 'testing' | 'success' | 'error';
  serverActionLoading: string | null;
  serverPoolStats?: bitcoinApi.ServerStats;
  onTestServer: (server: ElectrumServer) => void;
  onToggleServer: (server: ElectrumServer) => void;
  onMoveServer: (serverId: string, direction: 'up' | 'down') => void;
  onEditServer: (server: ElectrumServer) => void;
  onDeleteServer: (serverId: string) => void;
}

export const ServerRow: React.FC<ServerRowProps> = ({
  server,
  index,
  totalServers,
  serverTestStatus,
  serverActionLoading,
  serverPoolStats,
  onTestServer,
  onToggleServer,
  onMoveServer,
  onEditServer,
  onDeleteServer,
}) => (
  <div
    className={`p-3 rounded-lg border ${getServerRowClass(server.enabled)}`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3 min-w-0 flex-1">
        {/* Health Status Indicator */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getHealthIndicatorClass(serverTestStatus, server.isHealthy)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center space-x-2">
            <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate">
              {server.label}
            </span>
            <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${getProtocolBadgeClass(server.useSsl)}`}>
              {server.useSsl ? 'SSL' : 'TCP'}
            </span>
          </div>
          <span className="text-xs text-sanctuary-500">{server.host}:{server.port}</span>
          {/* Health History Blocks & Stats */}
          <div className="flex flex-col space-y-1 mt-1">
            {/* Health History Blocks */}
            {serverPoolStats?.healthHistory && serverPoolStats.healthHistory.length > 0 ? (
              <HealthHistoryBlocks history={serverPoolStats.healthHistory} maxBlocks={10} />
            ) : (
              // Fallback to simple blocks when no history available
              <div className="flex items-center space-x-0.5" title={getFallbackHealthTitle(server.lastHealthCheck)}>
                {Array.from({ length: 10 }).map((_, i) => {
                  const failCount = server.healthCheckFails ?? 0;
                  const isFailedBlock = i < failCount;
                  const hasHealthData = server.lastHealthCheck !== null;
                  return (
                    <div
                      key={i}
                      className={`w-1.5 h-3 rounded-sm ${getFallbackHealthBlockClass(hasHealthData, isFailedBlock)}`}
                    />
                  );
                })}
              </div>
            )}
            {/* Stats Row */}
            <div className="flex items-center space-x-2 text-[10px] text-sanctuary-400">
              {server.lastHealthCheck && (
                <span>
                  {new Date(server.lastHealthCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {serverPoolStats?.consecutiveFailures !== undefined && serverPoolStats.consecutiveFailures > 0 && (
                <span className="text-amber-500">
                  {serverPoolStats.consecutiveFailures} fail{serverPoolStats.consecutiveFailures > 1 ? 's' : ''}
                </span>
              )}
              {serverPoolStats?.weight !== undefined && serverPoolStats.weight < 1.0 && (
                <span className="text-amber-500">
                  {Math.round(serverPoolStats.weight * 100)}%
                </span>
              )}
              {isServerCoolingDown(serverPoolStats) && (
                <span className="flex items-center space-x-0.5 text-rose-500">
                  <Clock className="w-2.5 h-2.5" />
                  <span>cooldown</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Compact Actions */}
      <div className="flex items-center space-x-1 flex-shrink-0">
        {/* Manual Test Status Icons */}
        {serverTestStatus === 'success' && (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        )}
        {serverTestStatus === 'error' && (
          <XCircle className="w-4 h-4 text-rose-500" />
        )}
        <button
          onClick={() => onTestServer(server)}
          className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
          disabled={serverTestStatus === 'testing'}
          title="Test connection"
        >
          {serverTestStatus === 'testing' ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          ) : (
            <RefreshCw className="w-4 h-4 text-sanctuary-400" />
          )}
        </button>
        <button
          onClick={() => onToggleServer(server)}
          className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
          title={server.enabled ? 'Disable server' : 'Enable server'}
        >
          {server.enabled ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <XCircle className="w-4 h-4 text-sanctuary-400" />
          )}
        </button>
        {/* Priority Controls */}
        <button
          onClick={() => onMoveServer(server.id, 'up')}
          disabled={index === 0}
          className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up (higher priority)"
        >
          <ChevronUp className="w-4 h-4 text-sanctuary-400" />
        </button>
        <button
          onClick={() => onMoveServer(server.id, 'down')}
          disabled={index === totalServers - 1}
          className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down (lower priority)"
        >
          <ChevronDown className="w-4 h-4 text-sanctuary-400" />
        </button>
        {/* Edit */}
        <button
          onClick={() => onEditServer(server)}
          className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
          title="Edit server"
        >
          <Edit2 className="w-4 h-4 text-sanctuary-400" />
        </button>
        {/* Delete */}
        <button
          onClick={() => onDeleteServer(server.id)}
          disabled={serverActionLoading === server.id}
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-sanctuary-400 hover:text-red-500 dark:hover:text-red-400"
          title="Delete server"
        >
          {serverActionLoading === server.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  </div>
);
