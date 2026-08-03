import React from 'react';
import { RefreshCw } from 'lucide-react';

export const ReceiveLoadingState: React.FC = () => (
  <div className="flex flex-col items-center py-8">
    <RefreshCw className="w-8 h-8 animate-spin text-sanctuary-400 mb-4" />
    <p className="text-sanctuary-500">Loading receive address...</p>
  </div>
);
