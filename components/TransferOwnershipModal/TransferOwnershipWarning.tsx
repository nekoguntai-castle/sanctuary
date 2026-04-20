import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const TransferOwnershipWarning: React.FC = () => (
  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start">
    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
    <div className="text-sm text-amber-800 dark:text-amber-300">
      <p className="font-medium mb-1">3-Step Transfer Process</p>
      <ol className="list-decimal list-inside space-y-0.5 text-xs">
        <li>You initiate the transfer (this step)</li>
        <li>Recipient accepts or declines</li>
        <li>You confirm to complete the transfer</li>
      </ol>
      <p className="mt-2 text-xs">You can cancel at any time before the final confirmation.</p>
    </div>
  </div>
);
