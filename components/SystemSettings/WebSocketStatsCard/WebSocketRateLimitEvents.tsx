import { AlertCircle, Clock, Zap } from 'lucide-react';
import type { WebSocketStats } from '../../../src/api/admin';

function getRateLimitReasonClass(reason: string) {
  if (reason === 'grace_period_exceeded') {
    return 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400';
  }
  if (reason === 'per_second_exceeded') {
    return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400';
  }
  return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
}

function RateLimitReasonBadge({ reason }: { reason: string }) {
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded ${getRateLimitReasonClass(reason)}`}>
      {reason.replace(/_/g, ' ')}
    </span>
  );
}

function RateLimitUser({ userId }: { userId?: string | null }) {
  if (!userId) return null;

  return (
    <span className="text-[10px] font-mono text-sanctuary-500 truncate max-w-[80px]" title={userId}>
      {userId.slice(0, 8)}...
    </span>
  );
}

function RateLimitEventRow({
  event,
  index,
}: {
  event: WebSocketStats['recentRateLimitEvents'][number];
  index: number;
}) {
  return (
    <div
      key={`${event.timestamp}-${index}`}
      className="flex items-start gap-3 p-2 surface-muted rounded-lg text-sm"
    >
      <div className="flex-shrink-0 mt-0.5">
        <AlertCircle className="w-4 h-4 text-rose-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <RateLimitReasonBadge reason={event.reason} />
          <RateLimitUser userId={event.userId} />
        </div>
        <div className="text-sanctuary-600 dark:text-sanctuary-400">{event.details}</div>
        <div className="flex items-center gap-1 text-[10px] text-sanctuary-400 mt-1">
          <Clock className="w-3 h-3" />
          {new Date(event.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function RateLimitEventList({ stats }: { stats: WebSocketStats }) {
  if (stats.recentRateLimitEvents.length === 0) {
    return <div className="text-sm text-sanctuary-400">No rate limit events recorded</div>;
  }

  return (
    <div className="max-h-48 overflow-y-auto space-y-2">
      {stats.recentRateLimitEvents.map((event, index) => (
        <RateLimitEventRow key={`${event.timestamp}-${index}`} event={event} index={index} />
      ))}
    </div>
  );
}

export function RateLimitEvents({ stats }: { stats: WebSocketStats }) {
  return (
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
        <RateLimitEventList stats={stats} />
      </div>
    </details>
  );
}
