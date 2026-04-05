import React from 'react';
import { Button } from '../ui/Button';
import {
  Upload,
  AlertTriangle,
  Check,
  AlertCircle,
  FileJson,
  Clock,
  User,
  Database,
  Layers,
  X,
  Loader2,
} from 'lucide-react';
import type { SanctuaryBackup, ValidationResult } from '../../src/api/admin';

interface RestorePanelProps {
  uploadedBackup: SanctuaryBackup | null;
  uploadedFileName: string | null;
  validationResult: ValidationResult | null;
  isValidating: boolean;
  isRestoring: boolean;
  restoreError: string | null;
  restoreSuccess: boolean;
  showConfirmModal: boolean;
  confirmText: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setShowConfirmModal: (show: boolean) => void;
  setConfirmText: (text: string) => void;
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleClearUpload: () => void;
  handleRestore: () => void;
  formatDate: (dateStr: string) => string;
}

export const RestorePanel: React.FC<RestorePanelProps> = ({
  uploadedBackup,
  uploadedFileName,
  validationResult,
  isValidating,
  isRestoring,
  restoreError,
  restoreSuccess,
  showConfirmModal,
  confirmText,
  fileInputRef,
  setShowConfirmModal,
  setConfirmText,
  handleFileUpload,
  handleClearUpload,
  handleRestore,
  formatDate,
}) => {
  return (
    <>
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-warning-600 dark:text-warning-500">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Restore from Backup</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Warning */}
          <div className="flex items-start space-x-3 p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
            <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-warning-700 dark:text-warning-300">
              <strong>Warning:</strong> Restoring from a backup will <strong>delete all existing data</strong> and
              replace it with the backup contents. This action cannot be undone.
            </div>
          </div>

          {/* File Upload */}
          {!uploadedBackup ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
            >
              <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-4" />
              <p className="text-sanctuary-600 dark:text-sanctuary-400 mb-2">
                Drop backup file here or click to browse
              </p>
              <p className="text-xs text-sanctuary-500">
                Accepts .json backup files created by Sanctuary
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Uploaded File Info */}
              <div className="flex items-center justify-between p-4 surface-secondary rounded-lg border border-sanctuary-200 dark:border-sanctuary-700">
                <div className="flex items-center space-x-3">
                  <FileJson className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                  <div>
                    <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{uploadedFileName}</p>
                    <p className="text-xs text-sanctuary-500">
                      {validationResult?.info.totalRecords.toLocaleString()} records
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClearUpload}
                  className="p-2 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-sanctuary-500" />
                </button>
              </div>

              {/* Backup Details */}
              {uploadedBackup.meta && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2 text-sm">
                    <Clock className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {formatDate(uploadedBackup.meta.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <User className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {uploadedBackup.meta.createdBy}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Database className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      v{uploadedBackup.meta.appVersion}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Layers className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {validationResult?.info.tables.length} tables
                    </span>
                  </div>
                </div>
              )}

              {uploadedBackup.meta?.description && (
                <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                  "{uploadedBackup.meta.description}"
                </p>
              )}

              {/* Validation Status */}
              {isValidating ? (
                <div className="flex items-center space-x-2 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                  <Loader2 className="w-4 h-4 animate-spin text-sanctuary-500" />
                  <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Validating backup...</span>
                </div>
              ) : validationResult && (
                <div className="space-y-2">
                  {validationResult.valid ? (
                    <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 text-success-600 dark:text-success-400">
                      <Check className="w-4 h-4" />
                      <span className="text-sm">Backup is valid and ready to restore</span>
                    </div>
                  ) : (
                    <div className="flex items-start space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium">Backup validation failed:</p>
                        <ul className="list-disc list-inside mt-1">
                          {validationResult.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {validationResult.warnings.length > 0 && (
                    <div className="flex items-start space-x-2 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 text-warning-700 dark:text-warning-400">
                      <AlertTriangle className="w-4 h-4 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium">Warnings:</p>
                        <ul className="list-disc list-inside mt-1">
                          {validationResult.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Restore Button */}
              <Button
                onClick={() => setShowConfirmModal(true)}
                disabled={!validationResult?.valid || isRestoring}
                variant="danger"
                className="w-full"
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Restore from Backup
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Success/Error Messages */}
          {restoreSuccess && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 text-success-600 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Database restored successfully! Reloading...</span>
            </div>
          )}

          {restoreError && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{restoreError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 w-full max-w-md mx-4 overflow-hidden">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Confirm Database Restore
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                This action will:
              </p>
              <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 list-disc list-inside space-y-1">
                <li><strong className="text-rose-600 dark:text-rose-400">Delete ALL current data</strong></li>
                <li>Replace with backup from {uploadedBackup?.meta && formatDate(uploadedBackup.meta.createdAt)}</li>
                <li>Log you out (you'll need to log in again)</li>
              </ul>

              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mt-4">
                Type <span className="font-mono bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-0.5 rounded">RESTORE</span> to confirm:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="Type RESTORE"
                className="w-full px-3 py-2 rounded-md surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                autoFocus
              />

              <div className="flex space-x-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowConfirmModal(false);
                    setConfirmText('');
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRestore}
                  disabled={confirmText !== 'RESTORE'}
                  className="flex-1"
                >
                  Confirm Restore
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
