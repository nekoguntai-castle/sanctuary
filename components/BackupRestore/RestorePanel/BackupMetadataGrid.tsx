import { Clock, Database, Layers, User } from 'lucide-react';
import type { SanctuaryBackup, ValidationResult } from '../../../src/api/admin';

interface BackupMetadataGridProps {
  uploadedBackup: SanctuaryBackup;
  validationResult: ValidationResult | null;
  formatDate: (dateStr: string) => string;
}

export function BackupMetadataGrid({
  uploadedBackup,
  validationResult,
  formatDate,
}: BackupMetadataGridProps) {
  if (!uploadedBackup.meta) {
    return null;
  }

  return (
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
  );
}
