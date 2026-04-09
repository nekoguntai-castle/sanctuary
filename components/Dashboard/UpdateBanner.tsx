import React from 'react';
import { Download, X } from 'lucide-react';
import { VersionInfo } from '../../src/api/admin/types';

interface UpdateBannerProps {
  versionInfo: VersionInfo;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({ versionInfo, onDismiss }) => (
  <div className="surface-elevated rounded-xl p-4 shadow-sm border border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/30">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-success-100 dark:bg-success-800/50 rounded-lg">
          <Download className="w-5 h-5 text-success-600 dark:text-success-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-50">
            Update Available: v{versionInfo.latestVersion}
          </h3>
          <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400">
            You're running v{versionInfo.currentVersion}
            {versionInfo.releaseName && ` • ${versionInfo.releaseName}`}
          </p>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <a
          href={versionInfo.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 text-sm font-semibold text-white bg-sanctuary-800 hover:bg-sanctuary-900 dark:bg-sanctuary-100 dark:text-sanctuary-900 dark:hover:bg-white rounded-lg transition-colors"
        >
          View Release
        </a>
        <button
          onClick={onDismiss}
          className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:text-sanctuary-500 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);
