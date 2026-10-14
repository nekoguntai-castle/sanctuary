import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as intelligenceApi from '../../../../api/intelligence';
import type { AIInsight } from '../../../../api/intelligence';
import { extractErrorMessage } from '@sanctuary/shared/utils/errors';
import { createLogger } from '../../../../utils/logger';
import { buildInsightFilters } from './insightFilters';
import { groupInsightsBySeverity } from './insightGrouping';
import type { InsightStatusUpdate } from './types';
import { createRequestOwnership } from '../../../../hooks/requestOwnership';

const log = createLogger('InsightsTab');

export function useInsightsController(walletId: string) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [insightsOwnerKey, setInsightsOwnerKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const ownership = useRef(createRequestOwnership(''));
  const requestKey = `${walletId}:${typeFilter}:${severityFilter}:${statusFilter}`;
  ownership.current.setRoute(requestKey);

  const loadInsights = useCallback(async () => {
    const token = ownership.current.beginFetch(requestKey);
    try {
      setLoading(true);
      setLoadError(null);
      setStatusError(null);
      const result = await intelligenceApi.getInsights(
        walletId,
        buildInsightFilters({ statusFilter, typeFilter, severityFilter })
      );
      if (ownership.current.isFetchOwner(token)) {
        setInsights(result.insights);
        setInsightsOwnerKey(requestKey);
      }
    } catch (error) {
      if (ownership.current.isFetchOwner(token)) {
        log.error('Failed to load insights', { error });
        setInsights([]);
        setLoadError(extractErrorMessage(error));
        setInsightsOwnerKey(requestKey);
      }
    } finally {
      if (ownership.current.isFetchOwner(token)) setLoading(false);
    }
  }, [requestKey, walletId, typeFilter, severityFilter, statusFilter]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const handleUpdateStatus = useCallback(async (id: string, status: InsightStatusUpdate) => {
    const token = ownership.current.captureRoute(requestKey);
    setStatusError(null);
    try {
      await intelligenceApi.updateInsightStatus(id, status);
      if (ownership.current.isRouteOwner(token)) {
        setInsights((prev) => prev.filter((insight) => insight.id !== id));
      }
    } catch (error) {
      if (ownership.current.isRouteOwner(token)) {
        log.error('Failed to update insight status', { error });
        setStatusError(extractErrorMessage(error));
      }
    }
  }, [requestKey]);

  const visibleInsights = insightsOwnerKey === requestKey ? insights : [];

  return {
    filters: {
      typeFilter,
      severityFilter,
      statusFilter,
      setTypeFilter,
      setSeverityFilter,
      setStatusFilter,
    },
    groupedInsights: useMemo(() => groupInsightsBySeverity(visibleInsights), [visibleInsights]),
    handleUpdateStatus,
    hasInsights: visibleInsights.length > 0,
    loading: insightsOwnerKey !== requestKey || loading,
    // A failure belongs to the request that produced it; never show another route's error.
    loadError: insightsOwnerKey === requestKey ? loadError : null,
    retryLoad: loadInsights,
    statusError,
  };
}
