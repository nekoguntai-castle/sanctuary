import { INSIGHT_TYPE_LABELS } from '../../../../src/api/intelligence';

export const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  ...Object.entries(INSIGHT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

export const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'acted_on', label: 'Acted on' },
];
