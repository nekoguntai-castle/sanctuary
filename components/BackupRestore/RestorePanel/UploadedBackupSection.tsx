import { FileJson, X } from 'lucide-react';
import { BackupMetadataGrid } from './BackupMetadataGrid';
import { RestoreActionButton } from './RestoreActionButton';
import { ValidationStatus } from './ValidationStatus';
import type { SanctuaryBackup, ValidationResult } from '../../../src/api/admin';

interface UploadedBackupSectionProps {
  uploadedBackup: SanctuaryBackup;
  uploadedFileName: string | null;
  validationResult: ValidationResult | null;
  isValidating: boolean;
  isRestoring: boolean;
  handleClearUpload: () => void;
  setShowConfirmModal: (show: boolean) => void;
  formatDate: (dateStr: string) => string;
}

export function UploadedBackupSection({
  uploadedBackup,
  uploadedFileName,
  validationResult,
  isValidating,
  isRestoring,
  handleClearUpload,
  setShowConfirmModal,
  formatDate,
}: UploadedBackupSectionProps) {
  return (
    <div className="space-y-4">
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

      <BackupMetadataGrid
        uploadedBackup={uploadedBackup}
        validationResult={validationResult}
        formatDate={formatDate}
      />

      {uploadedBackup.meta?.description && (
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          "{uploadedBackup.meta.description}"
        </p>
      )}

      <ValidationStatus isValidating={isValidating} validationResult={validationResult} />

      <RestoreActionButton
        validationResult={validationResult}
        isRestoring={isRestoring}
        setShowConfirmModal={setShowConfirmModal}
      />
    </div>
  );
}
