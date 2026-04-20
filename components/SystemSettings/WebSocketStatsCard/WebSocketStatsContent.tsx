import { Gauge, Layers, Users } from 'lucide-react';
import type { WebSocketStats } from '../../../src/api/admin';
import { ActiveChannels } from './WebSocketChannels';
import { RateLimitEvents } from './WebSocketRateLimitEvents';

function getConnectionPercent(stats: WebSocketStats) {
  return stats.connections.max > 0
    ? (stats.connections.current / stats.connections.max) * 100
    : 0;
}

function getConnectionBarClass(connectionPercent: number) {
  if (connectionPercent > 80) return 'bg-rose-500';
  if (connectionPercent > 50) return 'bg-warning-500';
  return 'bg-success-500';
}

function ConnectionStatsCard({ stats }: { stats: WebSocketStats }) {
  const connectionPercent = getConnectionPercent(stats);

  return (
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
          className={`h-full rounded-full transition-all ${getConnectionBarClass(connectionPercent)}`}
          style={{ width: `${Math.min(connectionPercent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function SubscriptionStatsCard({ stats }: { stats: WebSocketStats }) {
  return (
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
  );
}

function StatsGrid({ stats }: { stats: WebSocketStats }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <ConnectionStatsCard stats={stats} />
      <SubscriptionStatsCard stats={stats} />
    </div>
  );
}

function UniqueUsersStat({ stats }: { stats: WebSocketStats }) {
  return (
    <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
      <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Unique Users Connected</span>
      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
        {stats.connections.uniqueUsers}
      </span>
    </div>
  );
}

function RateLimitConfig({ stats }: { stats: WebSocketStats }) {
  const rows = [
    ['Messages/sec', stats.rateLimits.maxMessagesPerSecond],
    ['Max per user', stats.connections.maxPerUser],
    ['Grace period', `${stats.rateLimits.gracePeriodMs / 1000}s`],
    ['Grace limit', stats.rateLimits.gracePeriodMessageLimit],
  ];

  return (
    <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-2 mb-3">
        <Gauge className="w-4 h-4 text-sanctuary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Rate Limit Configuration</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between p-2 surface-muted rounded-lg">
            <span className="text-sanctuary-500">{label}</span>
            <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{value}</span>
          </div>
        ))}
        <div className="col-span-2 flex justify-between p-2 surface-muted rounded-lg">
          <span className="text-sanctuary-500">Max subscriptions/connection</span>
          <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.maxSubscriptionsPerConnection}</span>
        </div>
      </div>
    </div>
  );
}

export function WebSocketStatsContent({ stats }: { stats: WebSocketStats }) {
  return (
    <div className="p-6 space-y-6">
      <StatsGrid stats={stats} />
      <UniqueUsersStat stats={stats} />
      <RateLimitConfig stats={stats} />
      <ActiveChannels stats={stats} />
      <RateLimitEvents stats={stats} />
    </div>
  );
}
