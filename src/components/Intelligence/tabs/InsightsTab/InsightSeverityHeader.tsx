import { AlertTriangle, Info, Shield } from 'lucide-react';
import { getSeverityLabel } from './insightGrouping';
import type { InsightGroup } from './types';

interface InsightSeverityHeaderProps {
  group: InsightGroup;
}

export function InsightSeverityHeader({ group }: InsightSeverityHeaderProps) {
  const label = getSeverityLabel(group.severity);

  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sanctuary-500 dark:text-sanctuary-400">
      <SeverityIcon severity={group.severity} />
      <span>{label} ({group.items.length})</span>
    </div>
  );
}

function SeverityIcon({ severity }: Pick<InsightGroup, 'severity'>) {
  switch (severity) {
    case 'critical':
      return <Shield className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />;
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
    case 'info':
      return <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
  }
}
