import React from 'react';
import { InsightsContent } from './InsightsTab/InsightsContent';
import { InsightsFilterControls } from './InsightsTab/InsightsFilterControls';
import { useInsightsController } from './InsightsTab/useInsightsController';

interface InsightsTabProps {
  walletId: string;
}

export const InsightsTab: React.FC<InsightsTabProps> = ({ walletId }) => {
  const controller = useInsightsController(walletId);

  return (
    <div className="flex h-full flex-col gap-3">
      <InsightsFilterControls filters={controller.filters} />
      <InsightsContent
        groupedInsights={controller.groupedInsights}
        hasInsights={controller.hasInsights}
        loading={controller.loading}
        onUpdateStatus={controller.handleUpdateStatus}
      />
    </div>
  );
};
