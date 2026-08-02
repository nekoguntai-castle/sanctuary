import React from 'react';
import { LifeBuoy, Download, ShieldAlert } from 'lucide-react';

import { Button } from '../ui/Button';

export const SupportPackageCard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Support Package
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
            Support package downloads are temporarily unavailable while privacy-safe
            diagnostics are being implemented.
          </p>

          <div className="flex items-start space-x-2 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-800 dark:text-warning-300">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-sm">
              Existing support packages may contain sensitive configuration. Do not
              generate or share one until the privacy-safe format is available.
            </span>
          </div>

          <Button variant="primary" size="sm" disabled>
            <Download className="w-4 h-4 mr-2" />
            Download Unavailable
          </Button>
        </div>
      </div>
    </div>
  );
};
