import React from 'react';
import { LifeBuoy, Download, AlertCircle, Check } from 'lucide-react';

import { downloadSupportPackage } from '../../src/api/admin/supportPackage';
import { useLoadingState } from '../../hooks/useLoadingState';
import { Button } from '../ui/Button';

export const SupportPackageCard: React.FC = () => {
  const { loading, error, execute } = useLoadingState();
  const [success, setSuccess] = React.useState(false);

  const handleGenerate = async () => {
    setSuccess(false);
    const result = await execute(async () => {
      await downloadSupportPackage();
    });
    if (result !== null) {
      setSuccess(true);
    }
  };

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
            Generate a diagnostic bundle to share with developers for troubleshooting.
            The package includes system health, notification configuration, sync status,
            and error logs. All wallet IDs, user IDs, and sensitive data are anonymized
            or redacted.
          </p>

          {error && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Support package downloaded successfully.</span>
            </div>
          )}

          <Button variant="primary" size="sm" onClick={handleGenerate} isLoading={loading}>
            <Download className="w-4 h-4 mr-2" />
            Generate &amp; Download
          </Button>
        </div>
      </div>
    </div>
  );
};
