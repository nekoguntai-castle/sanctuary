import React from 'react';
import {
  ChevronUp,
  ChevronDown,
  RefreshCw,
  CheckCircle,
  XCircle,
  Edit2,
  Trash2,
  Clock,
} from 'lucide-react';
import { HealthHistoryBlocks } from './HealthHistoryBlocks';
import { ServerRowProps } from './types';

export const ServerRow: React.FC<ServerRowProps> = ({
  server,
  index,
  totalCount,
  testStatus,
  testError,
  actionLoading,
  poolServerStats,
  onMoveServer,
  onTestServer,
  onToggleEnabled,
  onEditServer,
  onDeleteServer,
}) => {
  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${
        server.enabled
          ? server.isHealthy !== false
            ? 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700'
            : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
          : 'bg-sanctuary-100/50 dark:bg-sanctuary-800/50 border-sanctuary-200 dark:border-sanctuary-700 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {/* Priority Controls */}
          <div className="flex flex-col">
            <button
              onClick={() => onMoveServer(server.id, 'up')}
              disabled={index === 0}
              className="p-0.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              onClick={() => onMoveServer(server.id, 'down')}
              disabled={index === totalCount - 1}
              className="p-0.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {/* Server Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm truncate">{server.label}</span>
              {/* Verbose Support Indicator */}
              {server.supportsVerbose === true && (
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 rounded cursor-help"
                  title="Server supports verbose transaction data (includes fee info directly)"
                >
                  verbose
                </span>
              )}
              {server.supportsVerbose === false && (
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500 dark:text-sanctuary-400 rounded cursor-help"
                  title="Server does not support verbose transactions (fees calculated from inputs)"
                >
                  basic
                </span>
              )}
              {server.isHealthy === false && (
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded cursor-help"
                  title={server.lastHealthCheckError || 'Connection failed'}
                >
                  unhealthy
                </span>
              )}
              {!server.enabled && (
                <span className="text-[10px] px-1.5 py-0.5 bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 rounded">
                  disabled
                </span>
              )}
            </div>
            <div className="text-[10px] text-sanctuary-500 font-mono truncate">
              {server.host}:{server.port} {server.useSsl && '(SSL)'}
            </div>
            {/* Health Stats and History */}
            <div className="flex flex-col space-y-1 mt-1">
              {/* Health History Blocks */}
              {poolServerStats?.healthHistory && poolServerStats.healthHistory.length > 0 && (
                <HealthHistoryBlocks history={poolServerStats.healthHistory} maxBlocks={12} />
              )}

              {/* Stats Row */}
              <div className="flex items-center space-x-3 text-[10px] text-sanctuary-400">
                {server.lastHealthCheck && (
                  <span title="Last health check">
                    Checked: {new Date(server.lastHealthCheck).toLocaleTimeString()}
                  </span>
                )}
                {poolServerStats?.consecutiveFailures !== undefined && poolServerStats.consecutiveFailures > 0 && (
                  <span className="text-amber-500" title="Consecutive failures">
                    Fails: {poolServerStats.consecutiveFailures}
                  </span>
                )}
                {poolServerStats?.weight !== undefined && poolServerStats.weight < 1.0 && (
                  <span className="text-amber-500" title="Server weight (reduced due to failures)">
                    Weight: {Math.round(poolServerStats.weight * 100)}%
                  </span>
                )}
                {poolServerStats?.cooldownUntil && new Date(poolServerStats.cooldownUntil) > new Date() && (
                  <span className="flex items-center space-x-1 text-rose-500" title="Server in cooldown">
                    <Clock className="w-3 h-3" />
                    <span>Cooldown until {new Date(poolServerStats.cooldownUntil).toLocaleTimeString()}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1 ml-2">
          {/* Test Status Badge */}
          {testStatus === 'testing' && (
            <span className="flex items-center space-x-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-[10px] font-medium">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Testing...</span>
            </span>
          )}
          {testStatus === 'success' && (
            <span className="flex items-center space-x-1 px-2 py-0.5 bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300 rounded text-[10px] font-medium">
              <CheckCircle className="w-3 h-3" />
              <span>Connected</span>
            </span>
          )}
          {testStatus === 'error' && (
            <span
              className="flex items-center space-x-1 px-2 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 rounded text-[10px] font-medium cursor-help"
              title={testError || server.lastHealthCheckError || 'Connection test failed'}
            >
              <XCircle className="w-3 h-3" />
              <span>Failed</span>
            </span>
          )}

          <button
            onClick={() => onTestServer(server.id)}
            disabled={testStatus === 'testing'}
            className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors disabled:opacity-50"
            title="Test connection"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onToggleEnabled(server.id, !server.enabled)}
            className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors"
            title={server.enabled ? 'Disable' : 'Enable'}
          >
            {server.enabled ? (
              <CheckCircle className="w-3.5 h-3.5 text-success-500" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-sanctuary-400" />
            )}
          </button>
          <button
            onClick={() => onEditServer(server)}
            className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors"
            title="Edit"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDeleteServer(server.id)}
            disabled={actionLoading}
            className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded transition-colors text-rose-600 dark:text-rose-400"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
