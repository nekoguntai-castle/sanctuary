import React from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { DashboardContent } from './DashboardContent';
import { SanctuarySpinner } from '../ui/CustomIcons';

export const Dashboard: React.FC = () => {
  const data = useDashboardData();

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <SanctuarySpinner size="lg" />
      </div>
    );
  }

  return <DashboardContent data={data} />;
};
