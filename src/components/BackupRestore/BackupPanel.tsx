import React from 'react';
import { Button } from '../ui/Button';
import {
  Download,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Toggle } from '../ui/Toggle';

interface BackupPanelProps {
  isCreatingBackup: boolean;
  includeCache: boolean;
  setIncludeCache: (include: boolean) => void;
  description: string;
  setDescription: (desc: string) => void;
  handleCreateBackup: () => void;
  backupSuccess: boolean;
  backupError: string | null;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({
  isCreatingBackup,
  includeCache,
  setIncludeCache,
  description,
  setDescription,
  handleCreateBackup,
  backupSuccess,
  backupError,
}) => {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Download className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Create Backup</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Create a complete backup of the database including users, wallets, transactions, and settings.
          The backup file can be used to restore data to this or another Sanctuary instance.
        </p>

        {/* Options */}
        <div className="space-y-4">
          {/* Include Cache Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Include cache data
              </label>
              <p className="text-xs text-sanctuary-500">
                Include price history and fee estimates (can be regenerated)
              </p>
            </div>
            <Toggle checked={includeCache} onChange={setIncludeCache} />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Before migration, Weekly backup"
              className="w-full px-3 py-2 rounded-md surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Create Button */}
        <Button
          onClick={handleCreateBackup}
          disabled={isCreatingBackup}
          className="w-full"
        >
          {isCreatingBackup ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Backup...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download Backup
            </>
          )}
        </Button>

        {/* Success/Error Messages */}
        {backupSuccess && (
          <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 text-success-600 dark:text-success-400">
            <Check className="w-4 h-4" />
            <span className="text-sm">Backup created and downloaded successfully</span>
          </div>
        )}

        {backupError && (
          <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{backupError}</span>
          </div>
        )}
      </div>
    </div>
  );
};
