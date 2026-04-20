import { useCallback, useEffect, useMemo, useState } from 'react';
import * as intelligenceApi from '../../../../src/api/intelligence';
import type { AIInsight } from '../../../../src/api/intelligence';
import { createLogger } from '../../../../utils/logger';
import { buildInsightFilters } from './insightFilters';
import { groupInsightsBySeverity } from './insightGrouping';
import type { InsightStatusUpdate } from './types';

const log = createLogger('InsightsTab');

export function useInsightsController(walletId: string) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const loadInsights = useCallback(async () => {
    try {
      setLoading(true);
      const result = await intelligenceApi.getInsights(
        walletId,
        buildInsightFilters({ statusFilter, typeFilter, severityFilter })
      );
      setInsights(result.insights);
    } catch (error) {
      log.error('Failed to load insights', { error });
    } finally {
      setLoading(false);
    }
  }, [walletId, typeFilter, severityFilter, statusFilter]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const handleUpdateStatus = useCallback(async (id: string, status: InsightStatusUpdate) => {
    try {
      await intelligenceApi.updateInsightStatus(id, status);
      setInsights((prev) => prev.filter((insight) => insight.id !== id));
    } catch (error) {
      log.error('Failed to update insight status', { error });
    }
  }, []);

  return {
    filters: {
      typeFilter,
      severityFilter,
      statusFilter,
      setTypeFilter,
      setSeverityFilter,
      setStatusFilter,
    },
    groupedInsights: useMemo(() => groupInsightsBySeverity(insights), [insights]),
    handleUpdateStatus,
    hasInsights: insights.length > 0,
    loading,
  };
}
