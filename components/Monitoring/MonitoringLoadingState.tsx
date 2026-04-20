import React from 'react';
import { Loader2 } from 'lucide-react';

export const MonitoringLoadingState: React.FC = () => (
  <div className="flex items-center justify-center h-64">
    <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
  </div>
);
