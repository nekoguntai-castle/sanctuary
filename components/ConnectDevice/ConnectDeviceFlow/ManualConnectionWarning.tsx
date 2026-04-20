import React from 'react';
import { AlertCircle } from 'lucide-react';

export const ManualConnectionWarning: React.FC = () => (
  <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg flex items-start">
    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
    <p className="text-xs text-amber-800 dark:text-amber-200">
      Manually entering xpubs is for advanced users. Ensure you copy the correct Extended Public Key corresponding to
      the derivation path. The fingerprint should match your device's master fingerprint.
    </p>
  </div>
);
