import React from 'react';
import { Button } from '../../ui/Button';

interface ReceiveEmptyStateProps {
  onNavigateToSettings: () => void;
}

export const ReceiveEmptyState: React.FC<ReceiveEmptyStateProps> = ({
  onNavigateToSettings,
}) => (
  <div className="text-center py-8">
    <p className="text-sanctuary-500 mb-4">
      No receive address available. Please link a hardware device with an xpub first.
    </p>
    <Button variant="secondary" onClick={onNavigateToSettings}>
      Go to Settings
    </Button>
  </div>
);
