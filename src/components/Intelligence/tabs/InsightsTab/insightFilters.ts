import type { InsightFilterState, InsightQueryFilters } from './types';

type FilterValues = Pick<InsightFilterState, 'statusFilter' | 'typeFilter' | 'severityFilter'>;

export function buildInsightFilters({
  statusFilter,
  typeFilter,
  severityFilter,
}: FilterValues): InsightQueryFilters {
  const filters: InsightQueryFilters = {};

  if (statusFilter) filters.status = statusFilter;
  if (typeFilter) filters.type = typeFilter;
  if (severityFilter) filters.severity = severityFilter;

  return filters;
}
