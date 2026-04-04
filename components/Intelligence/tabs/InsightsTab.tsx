import React, { useState, useEffect, useCallback } from 'react';
import { Brain, AlertTriangle, Info, Shield } from 'lucide-react';
import * as intelligenceApi from '../../../src/api/intelligence';
import type { AIInsight } from '../../../src/api/intelligence';
import { InsightCard } from './InsightCard';
import { createLogger } from '../../../utils/logger';

const log = createLogger('InsightsTab');

interface InsightsTabProps {
  walletId: string;
}

const SEVERITY_ORDER: AIInsight['severity'][] = ['critical', 'warning', 'info'];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'utxo_health', label: 'UTXO Health' },
  { value: 'fee_timing', label: 'Fee Timing' },
  { value: 'anomaly', label: 'Anomaly' },
  { value: 'tax', label: 'Tax' },
  { value: 'consolidation', label: 'Consolidation' },
];

const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'acted_on', label: 'Acted on' },
];

export const InsightsTab: React.FC<InsightsTabProps> = ({ walletId }) => {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const loadInsights = useCallback(async () => {
    try {
      setLoading(true);
      const filters: { status?: string; type?: string; severity?: string } = {};
      if (statusFilter) filters.status = statusFilter;
      if (typeFilter) filters.type = typeFilter;
      if (severityFilter) filters.severity = severityFilter;

      const result = await intelligenceApi.getInsights(walletId, filters);
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

  const handleUpdateStatus = useCallback(
    async (id: string, status: 'dismissed' | 'acted_on') => {
      try {
        await intelligenceApi.updateInsightStatus(id, status);
        setInsights((prev) => prev.filter((i) => i.id !== id));
      } catch (error) {
        log.error('Failed to update insight status', { error });
      }
    },
    []
  );

  // Group by severity, preserving the severity order
  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: insights.filter((i) => i.severity === severity),
  })).filter((group) => group.items.length > 0);

  const severityIcon = (severity: AIInsight['severity']) => {
    switch (severity) {
      case 'critical':
        return <Shield className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />;
      case 'warning':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
      case 'info':
        return <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
    }
  };

  const severityLabel = (severity: AIInsight['severity']) => {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: typeFilter, setter: setTypeFilter, options: TYPE_OPTIONS },
          { value: severityFilter, setter: setSeverityFilter, options: SEVERITY_OPTIONS },
          { value: statusFilter, setter: setStatusFilter, options: STATUS_OPTIONS },
        ].map((filter, idx) => (
          <select
            key={idx}
            value={filter.value}
            onChange={(e) => filter.setter(e.target.value)}
            className="rounded-md border border-sanctuary-200 bg-white px-2 py-1 text-[11px] text-sanctuary-700 transition-colors focus:border-primary-500 focus:outline-none dark:border-sanctuary-800 dark:bg-sanctuary-900 dark:text-sanctuary-300"
          >
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
          </div>
        ) : insights.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-sanctuary-500 dark:text-sanctuary-400">
            <Brain className="h-8 w-8" />
            <p className="text-sm">No insights found.</p>
            <p className="text-[11px]">Insights will appear here as the AI analyzes your wallet activity.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map((group) => (
              <div key={group.severity} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sanctuary-500 dark:text-sanctuary-400">
                  {severityIcon(group.severity)}
                  <span>{severityLabel(group.severity)} ({group.items.length})</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.items.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onDismiss={() => handleUpdateStatus(insight.id, 'dismissed')}
                      onActedOn={() => handleUpdateStatus(insight.id, 'acted_on')}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
