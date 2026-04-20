import type { Dispatch, SetStateAction } from 'react';
import type { AIInsight } from '../../../../src/api/intelligence';

export type InsightStatusUpdate = 'dismissed' | 'acted_on';

export interface InsightGroup {
  severity: AIInsight['severity'];
  items: AIInsight[];
}

export interface InsightFilterState {
  typeFilter: string;
  severityFilter: string;
  statusFilter: string;
  setTypeFilter: Dispatch<SetStateAction<string>>;
  setSeverityFilter: Dispatch<SetStateAction<string>>;
  setStatusFilter: Dispatch<SetStateAction<string>>;
}

export interface InsightQueryFilters {
  status?: string;
  type?: string;
  severity?: string;
}
