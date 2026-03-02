/**
 * Backup Handlers Hook
 *
 * Extracts all backup/restore handler callbacks and related state management.
 */

import { useState, useRef } from 'react';
import * as adminApi from '../../../src/api/admin';
import type { SanctuaryBackup, ValidationResult, EncryptionKeysResponse } from '../../../src/api/admin';
import { createLogger } from '../../../utils/logger';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { downloadText, downloadBlob } from '../../../utils/download';

const log = createLogger('BackupRestore');

// Local storage key for "don't show again" preference
const BACKUP_MODAL_DISMISSED_KEY = 'sanctuary_backup_modal_dismissed';

export function useBackupHandlers(encryptionKeys: EncryptionKeysResponse | null) {
  const { addNotification } = useAppNotifications();

  // Backup state
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [includeCache, setIncludeCache] = useState(false);
  const [description, setDescription] = useState('');
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState(false);

  // Restore state
  const [uploadedBackup, setUploadedBackup] = useState<SanctuaryBackup | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Post-backup modal state
  const [showBackupCompleteModal, setShowBackupCompleteModal] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Clipboard state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, keyName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      log.error('Failed to copy to clipboard', { error });
    }
  };

  /**
   * Download encryption keys as a text file
   */
  const downloadEncryptionKeys = () => {
    if (!encryptionKeys) return;

    const content = `# Sanctuary Encryption Keys
# Generated: ${new Date().toISOString()}
#
# IMPORTANT: Keep this file secure! These keys are required to restore
# encrypted data (node passwords, 2FA secrets) on a new Sanctuary instance.
#
# To use these keys on a new instance:
# 1. Add these lines to your .env file BEFORE restoring from backup
# 2. Restart Sanctuary
# 3. Then restore your backup
#

ENCRYPTION_KEY=${encryptionKeys.encryptionKey}
ENCRYPTION_SALT=${encryptionKeys.encryptionSalt}
`;

    const filename = `sanctuary-encryption-keys-${new Date().toISOString().slice(0, 10)}.txt`;
    downloadText(content, filename);
  };

  /**
   * Create and download a backup
   */
  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setBackupError(null);
    setBackupSuccess(false);

    try {
      const blob = await adminApi.createBackup({
        includeCache,
        description: description.trim() || undefined,
      });

      // Create download link
      const timestamp = new Date().toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, '-');
      const filename = `sanctuary-backup-${timestamp}.json`;
      downloadBlob(blob, filename);

      setBackupSuccess(true);
      setDescription('');

      // Show backup complete modal if not dismissed
      const isDismissed = localStorage.getItem(BACKUP_MODAL_DISMISSED_KEY) === 'true';
      if (!isDismissed) {
        setShowBackupCompleteModal(true);
      }

      setTimeout(() => setBackupSuccess(false), 5000);
    } catch (error) {
      log.error('Backup failed', { error });
      setBackupError(error instanceof Error ? error.message : 'Failed to create backup');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  /**
   * Validate the uploaded backup
   */
  const validateBackup = async (backup: SanctuaryBackup) => {
    setIsValidating(true);
    setRestoreError(null);

    try {
      const result = await adminApi.validateBackup(backup);
      setValidationResult(result);
    } catch (error) {
      log.error('Validation failed', { error });
      setRestoreError('Failed to validate backup file');
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * Handle file upload
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setUploadedBackup(null);
    setValidationResult(null);
    setRestoreError(null);
    setRestoreSuccess(false);

    try {
      const text = await file.text();
      const backup = JSON.parse(text) as SanctuaryBackup;
      setUploadedBackup(backup);
      setUploadedFileName(file.name);

      // Auto-validate
      await validateBackup(backup);
    } catch (error) {
      log.error('Failed to parse backup file', { error });
      setRestoreError('Invalid backup file format. Please select a valid Sanctuary backup JSON file.');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Perform the restore
   */
  const handleRestore = async () => {
    if (!uploadedBackup || confirmText !== 'RESTORE') return;

    setIsRestoring(true);
    setRestoreError(null);
    setShowConfirmModal(false);
    setConfirmText('');

    try {
      const result = await adminApi.restoreBackup(uploadedBackup);

      if (result.success) {
        setRestoreSuccess(true);
        setUploadedBackup(null);
        setUploadedFileName(null);
        setValidationResult(null);

        // Show warnings as notifications (e.g., node passwords that couldn't be restored)
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((warning) => {
            addNotification({
              type: 'warning',
              scope: 'global',
              title: 'Restore Warning',
              message: warning,
              persistent: true,
            });
          });
        }

        // Reload the page after successful restore to refresh all data
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        setRestoreError(result.error || 'Restore failed');
      }
    } catch (error) {
      log.error('Restore failed', { error });
      setRestoreError(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setIsRestoring(false);
    }
  };

  /**
   * Clear uploaded backup
   */
  const handleClearUpload = () => {
    setUploadedBackup(null);
    setUploadedFileName(null);
    setValidationResult(null);
    setRestoreError(null);
  };

  /**
   * Dismiss backup complete modal
   */
  const dismissBackupCompleteModal = () => {
    if (dontShowAgain) {
      localStorage.setItem(BACKUP_MODAL_DISMISSED_KEY, 'true');
    }
    setShowBackupCompleteModal(false);
    setDontShowAgain(false);
  };

  return {
    // Backup state
    isCreatingBackup,
    includeCache,
    setIncludeCache,
    description,
    setDescription,
    backupError,
    backupSuccess,
    // Restore state
    uploadedBackup,
    uploadedFileName,
    validationResult,
    isValidating,
    isRestoring,
    restoreError,
    restoreSuccess,
    showConfirmModal,
    confirmText,
    setShowConfirmModal,
    setConfirmText,
    fileInputRef,
    // Post-backup modal state
    showBackupCompleteModal,
    dontShowAgain,
    setDontShowAgain,
    // Clipboard state
    copiedKey,
    // Handlers
    handleCreateBackup,
    handleFileUpload,
    handleRestore,
    handleClearUpload,
    copyToClipboard,
    downloadEncryptionKeys,
    dismissBackupCompleteModal,
  };
}
