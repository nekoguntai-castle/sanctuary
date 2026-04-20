import React, { useState, useEffect } from 'react';
import * as adminApi from '../../src/api/admin';
import type { WebSocketStats } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { WebSocketCardHeader } from './WebSocketStatsCard/WebSocketCardHeader';
import { WebSocketStatsContent } from './WebSocketStatsCard/WebSocketStatsContent';
import { WebSocketErrorCard, WebSocketLoadingCard } from './WebSocketStatsCard/WebSocketStateCards';

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
    return <WebSocketLoadingCard />;
  }

  if (error) {
    return <WebSocketErrorCard error={error} />;
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <WebSocketCardHeader isRefreshing={isRefreshing} onRefresh={() => loadStats(true)} />
        <WebSocketStatsContent stats={stats} />
      </div>
    </div>
  );
};
