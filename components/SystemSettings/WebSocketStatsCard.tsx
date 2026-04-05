import React, { useState, useEffect } from 'react';
import { AlertCircle, Radio, Users, Layers, Gauge, RefreshCw, Zap, Clock } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { WebSocketStats } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { Button } from '../ui/Button';

export const WebSocketStatsCard: React.FC = () => {
  const [stats, setStats] = useState<WebSocketStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Loading state using hook
  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });

  const loadStats = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    await runLoad(async () => {
      const data = await adminApi.getWebSocketStats();
      setStats(data);
    });
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadStats();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => loadStats(), 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/3"></div>
          <div className="h-20 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
        <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const connectionPercent = (stats.connections.current / stats.connections.max) * 100;

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">WebSocket Status</h3>
                <p className="text-sm text-sanctuary-500">Real-time connection monitoring</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadStats(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Connection Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="surface-secondary rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Users className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Connections</span>
              </div>
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {stats.connections.current}
                <span className="text-sm font-normal text-sanctuary-500"> / {stats.connections.max}</span>
              </div>
              <div className="mt-2 h-1.5 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    connectionPercent > 80 ? 'bg-rose-500' : connectionPercent > 50 ? 'bg-warning-500' : 'bg-success-500'
                  }`}
                  style={{ width: `${Math.min(connectionPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="surface-secondary rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Layers className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Subscriptions</span>
              </div>
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {stats.subscriptions.total}
              </div>
              <div className="text-xs text-sanctuary-500 mt-1">
                {stats.subscriptions.channels} active channels
              </div>
            </div>
          </div>

          {/* User Stats */}
          <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
            <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Unique Users Connected</span>
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {stats.connections.uniqueUsers}
            </span>
          </div>

          {/* Rate Limits Configuration */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center space-x-2 mb-3">
              <Gauge className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Rate Limit Configuration</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Messages/sec</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.maxMessagesPerSecond}</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Max per user</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.connections.maxPerUser}</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Grace period</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.gracePeriodMs / 1000}s</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Grace limit</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.gracePeriodMessageLimit}</span>
              </div>
              <div className="col-span-2 flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Max subscriptions/connection</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.maxSubscriptionsPerConnection}</span>
              </div>
            </div>
          </div>

          {/* Active Channels (collapsible, grouped) */}
          {stats.subscriptions.channelList.length > 0 && (
            <details className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <summary className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400">
                Active Channels ({stats.subscriptions.channelList.length})
              </summary>
              <div className="mt-3 space-y-3">
                {/* Group channels by type */}
                {(() => {
                  const walletChannels = stats.subscriptions.channelList.filter(c => c.startsWith('wallet:'));
                  const globalChannels = stats.subscriptions.channelList.filter(c => !c.startsWith('wallet:'));
                  const walletIds = [...new Set(walletChannels.map(c => c.split(':')[1]))];

                  return (
                    <>
                      {globalChannels.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">Global</div>
                          <div className="flex flex-wrap gap-1.5">
                            {globalChannels.map((channel) => (
                              <span
                                key={channel}
                                className="px-2 py-0.5 text-[10px] font-mono bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded"
                              >
                                {channel}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {walletIds.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">
                            Wallets ({walletIds.length})
                          </div>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {walletIds.map((walletId) => {
                              const channels = walletChannels.filter(c => c.split(':')[1] === walletId);
                              const types = channels.map(c => c.split(':')[2] || 'base').join(', ');
                              return (
                                <div key={walletId} className="flex items-center gap-2 text-[10px]">
                                  <span className="font-mono text-sanctuary-500 truncate max-w-[100px]" title={walletId}>
                                    {walletId.slice(0, 8)}...
                                  </span>
                                  <span className="text-sanctuary-400">→</span>
                                  <span className="text-sanctuary-600 dark:text-sanctuary-400">{types}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          )}

          {/* Rate Limit Events Log */}
          <details className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <summary className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Rate Limit Events
              {stats.recentRateLimitEvents.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full">
                  {stats.recentRateLimitEvents.length}
                </span>
              )}
            </summary>
            <div className="mt-3">
              {stats.recentRateLimitEvents.length === 0 ? (
                <div className="text-sm text-sanctuary-400">No rate limit events recorded</div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {stats.recentRateLimitEvents.map((event, index) => (
                    <div
                      key={`${event.timestamp}-${index}`}
                      className="flex items-start gap-3 p-2 surface-muted rounded-lg text-sm"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                            event.reason === 'grace_period_exceeded'
                              ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                              : event.reason === 'per_second_exceeded'
                              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          }`}>
                            {event.reason.replace(/_/g, ' ')}
                          </span>
                          {event.userId && (
                            <span className="text-[10px] font-mono text-sanctuary-500 truncate max-w-[80px]" title={event.userId}>
                              {event.userId.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                        <div className="text-sanctuary-600 dark:text-sanctuary-400">{event.details}</div>
                        <div className="flex items-center gap-1 text-[10px] text-sanctuary-400 mt-1">
                          <Clock className="w-3 h-3" />
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};
