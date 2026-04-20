import { Upload } from 'lucide-react';
import { RestoreConfirmModal } from './RestorePanel/RestoreConfirmModal';
import { RestoreDangerWarning } from './RestorePanel/RestoreDangerWarning';
import { RestoreStatusAlerts } from './RestorePanel/RestoreStatusAlerts';
import { RestoreUploadDropzone } from './RestorePanel/RestoreUploadDropzone';
import type { RestorePanelProps } from './RestorePanel/types';
import { UploadedBackupSection } from './RestorePanel/UploadedBackupSection';

export function RestorePanel({
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
}: RestorePanelProps) {
  return (
    <>
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-warning-600 dark:text-warning-500">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Restore from Backup
            </h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <RestoreDangerWarning />
          {uploadedBackup ? (
            <UploadedBackupSection
              uploadedBackup={uploadedBackup}
              uploadedFileName={uploadedFileName}
              validationResult={validationResult}
              isValidating={isValidating}
              isRestoring={isRestoring}
              handleClearUpload={handleClearUpload}
              setShowConfirmModal={setShowConfirmModal}
              formatDate={formatDate}
            />
          ) : (
            <RestoreUploadDropzone fileInputRef={fileInputRef} handleFileUpload={handleFileUpload} />
          )}
          <RestoreStatusAlerts restoreSuccess={restoreSuccess} restoreError={restoreError} />
        </div>
      </div>

      <RestoreConfirmModal
        showConfirmModal={showConfirmModal}
        uploadedBackup={uploadedBackup}
        confirmText={confirmText}
        setShowConfirmModal={setShowConfirmModal}
        setConfirmText={setConfirmText}
        handleRestore={handleRestore}
        formatDate={formatDate}
      />
    </>
  );
}
