import { InsightCard } from '../InsightCard';
import { InsightSeverityHeader } from './InsightSeverityHeader';
import type { InsightGroup, InsightStatusUpdate } from './types';

interface InsightGroupSectionProps {
  group: InsightGroup;
  onUpdateStatus: (id: string, status: InsightStatusUpdate) => void;
}

export function InsightGroupSection({ group, onUpdateStatus }: InsightGroupSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <InsightSeverityHeader group={group} />
      <div className="flex flex-col gap-2">
        {group.items.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            onDismiss={() => onUpdateStatus(insight.id, 'dismissed')}
            onActedOn={() => onUpdateStatus(insight.id, 'acted_on')}
          />
        ))}
      </div>
    </div>
  );
}
