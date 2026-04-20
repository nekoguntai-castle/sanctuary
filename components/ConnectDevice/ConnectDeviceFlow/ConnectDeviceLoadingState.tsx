import React from 'react';
import { Loader2 } from 'lucide-react';

export const ConnectDeviceLoadingState: React.FC = () => (
  <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
    <Loader2 className="w-8 h-8 animate-spin text-sanctuary-500" />
    <span className="ml-3 text-sanctuary-500">Loading device models...</span>
  </div>
);
