import type { AIInsight } from '../../../../src/api/intelligence';
import type { InsightGroup } from './types';

const SEVERITY_ORDER: AIInsight['severity'][] = ['critical', 'warning', 'info'];

export function groupInsightsBySeverity(insights: AIInsight[]): InsightGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    items: insights.filter((insight) => insight.severity === severity),
  })).filter((group) => group.items.length > 0);
}

export function getSeverityLabel(severity: AIInsight['severity']) {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
