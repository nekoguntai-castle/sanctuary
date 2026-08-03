import { Brain } from 'lucide-react';
import { SanctuarySpinner } from '../../../ui/CustomIcons';
import { InsightGroupSection } from './InsightGroupSection';
import type { InsightGroup, InsightStatusUpdate } from './types';

interface InsightsContentProps {
  groupedInsights: InsightGroup[];
  hasInsights: boolean;
  loading: boolean;
  onUpdateStatus: (id: string, status: InsightStatusUpdate) => void;
}

export function InsightsContent({
  groupedInsights,
  hasInsights,
  loading,
  onUpdateStatus,
}: InsightsContentProps) {
  if (loading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-center py-12">
          <SanctuarySpinner />
        </div>
      </div>
    );
  }

  if (!hasInsights) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sanctuary-500 dark:text-sanctuary-400">
          <Brain className="h-8 w-8" />
          <p className="text-sm">No insights found.</p>
          <p className="text-[11px]">Insights will appear here as the AI analyzes your wallet activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-4">
        {groupedInsights.map((group) => (
          <InsightGroupSection
            key={group.severity}
            group={group}
            onUpdateStatus={onUpdateStatus}
          />
        ))}
      </div>
    </div>
  );
}
