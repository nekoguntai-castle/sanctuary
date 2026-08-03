import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConflictDialogHeaderProps {
  fingerprint: string;
}

export const ConflictDialogHeader: React.FC<ConflictDialogHeaderProps> = ({ fingerprint }) => (
  <div className="flex items-start gap-3 mb-4">
    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
      <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
    </div>
    <div>
      <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">Device Already Exists</h3>
      <p className="text-sm text-sanctuary-500 mt-1">
        A device with fingerprint <span className="font-mono">{fingerprint}</span> is already registered.
      </p>
    </div>
  </div>
);
