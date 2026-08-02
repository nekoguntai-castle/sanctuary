import React, { useState } from 'react';
import { LifeBuoy, Download } from 'lucide-react';

import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { NoticeAlert } from '../ui/NoticeAlert';
import { downloadSupportPackage } from '../../src/api/admin/supportPackage';

const PRIVACY_NOTICE =
  'Aggregate counts and coarse activity windows can still reveal operational activity on small deployments. Share the file only with your intended support party. Packages created by version 0.8.56 are not safe to share.';

export const SupportPackageCard: React.FC = () => {
  const [confirmed, setConfirmed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadSupportPackage();
    } catch {
      setError('The privacy-safe support package could not be generated.');
    } finally {
      setDownloading(false);
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
            Download aggregate notification diagnostics with source and freshness
            information. The package excludes identities, wallet and transaction data,
            credentials, message content, endpoints, payloads, and raw errors.
          </p>

          <NoticeAlert message={PRIVACY_NOTICE} tone="warning" />

          <label className="flex items-start gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
            />
            I understand this package contains aggregate operational activity and confirm
            that I intend to generate the shareable aggregate profile.
          </label>

          <ErrorAlert message={error} className="mb-0" />

          <Button variant="primary" size="sm" disabled={!confirmed || downloading} onClick={download}>
            <Download className="w-4 h-4 mr-2" />
            {downloading ? 'Generating…' : 'Download Support Package'}
          </Button>
        </div>
      </div>
    </div>
  );
};
