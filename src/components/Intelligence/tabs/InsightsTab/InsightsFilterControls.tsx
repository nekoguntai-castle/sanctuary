import type { ChangeEvent } from 'react';
import { SEVERITY_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS } from './insightFilterOptions';
import type { InsightFilterState } from './types';

interface InsightsFilterControlsProps {
  filters: InsightFilterState;
}

export function InsightsFilterControls({ filters }: InsightsFilterControlsProps) {
  const filterControls = [
    { value: filters.typeFilter, setter: filters.setTypeFilter, options: TYPE_OPTIONS },
    { value: filters.severityFilter, setter: filters.setSeverityFilter, options: SEVERITY_OPTIONS },
    { value: filters.statusFilter, setter: filters.setStatusFilter, options: STATUS_OPTIONS },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filterControls.map((filter, idx) => (
        <select
          key={idx}
          value={filter.value}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => filter.setter(event.target.value)}
          className="rounded-md border border-sanctuary-200 bg-white px-2 py-1 text-[11px] text-sanctuary-700 transition-colors focus:border-primary-500 focus:outline-none dark:border-sanctuary-800 dark:bg-sanctuary-900 dark:text-sanctuary-300"
        >
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
