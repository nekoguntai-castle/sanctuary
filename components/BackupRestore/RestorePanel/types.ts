import type { ChangeEvent, RefObject } from 'react';
import type { SanctuaryBackup, ValidationResult } from '../../../src/api/admin';

export interface RestorePanelProps {
  uploadedBackup: SanctuaryBackup | null;
  uploadedFileName: string | null;
  validationResult: ValidationResult | null;
  isValidating: boolean;
  isRestoring: boolean;
  restoreError: string | null;
  restoreSuccess: boolean;
  showConfirmModal: boolean;
  confirmText: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  setShowConfirmModal: (show: boolean) => void;
  setConfirmText: (text: string) => void;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  handleClearUpload: () => void;
  handleRestore: () => void;
  formatDate: (dateStr: string) => string;
}
