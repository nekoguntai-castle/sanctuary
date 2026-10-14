import React from 'react';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
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
      <ErrorAlert message={controller.statusError && `Failed to update insight: ${controller.statusError}`} className="" />
      {controller.loadError !== null && !controller.loading ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorAlert message={`Failed to load insights: ${controller.loadError}`} className="" />
          <Button variant="secondary" onClick={() => { void controller.retryLoad(); }}>Retry</Button>
        </div>
      ) : (
        <InsightsContent
          groupedInsights={controller.groupedInsights}
          hasInsights={controller.hasInsights}
          loading={controller.loading}
          onUpdateStatus={controller.handleUpdateStatus}
        />
      )}
    </div>
  );
};
