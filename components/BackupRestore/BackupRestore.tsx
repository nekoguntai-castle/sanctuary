/**
 * Backup & Restore Component
 *
 * Admin-only page for creating database backups and restoring from backup files.
 * Accessible from Administration > Backup & Restore in the sidebar.
 */

import React, { useState } from 'react';
import {
  Download,
  Upload,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { EncryptionKeysResponse } from '../../src/api/admin';
import { createLogger } from '../../utils/logger';
import { BackupPanel } from './BackupPanel';
import { RestorePanel } from './RestorePanel';
import { EncryptionKeyDisplay } from './EncryptionKeyDisplay';
import { BackupCompleteModal } from './BackupCompleteModal';
import { useBackupHandlers } from './hooks/useBackupHandlers';

const log = createLogger('BackupRestore');

type BackupTab = 'backup' | 'restore';

const BACKUP_TABS: { id: BackupTab; name: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'backup', name: 'Backup', icon: Download },
  { id: 'restore', name: 'Restore', icon: Upload },
];

export const BackupRestore: React.FC = () => {
  const [activeTab, setActiveTab] = useState<BackupTab>('backup');

  // Encryption keys state
  const [encryptionKeys, setEncryptionKeys] = useState<EncryptionKeysResponse | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [showEncryptionSalt, setShowEncryptionSalt] = useState(false);

  const handleRevealKeys = async (password: string) => {
    setIsLoadingKeys(true);
    setKeysError(null);
    try {
      const keys = await adminApi.getEncryptionKeys(password);
      setEncryptionKeys(keys);
    } catch (error) {
      log.error('Failed to fetch encryption keys', { error });
      setKeysError(error instanceof Error ? error.message : 'Incorrect password or failed to fetch keys');
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handlers = useBackupHandlers(encryptionKeys);

  /**
   * Format date for display
   */
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Backup & Restore</h2>
        <p className="text-sanctuary-500">Create database backups and restore from backup files</p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 surface-secondary rounded-xl p-1">
        {BACKUP_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.name}</span>
          </button>
        ))}
      </div>

      {/* Create Backup Section */}
      {activeTab === 'backup' && (
        <BackupPanel
          isCreatingBackup={handlers.isCreatingBackup}
          includeCache={handlers.includeCache}
          setIncludeCache={handlers.setIncludeCache}
          description={handlers.description}
          setDescription={handlers.setDescription}
          handleCreateBackup={handlers.handleCreateBackup}
          backupSuccess={handlers.backupSuccess}
          backupError={handlers.backupError}
        />
      )}

      {/* Restore Section */}
      {activeTab === 'restore' && (
        <RestorePanel
          uploadedBackup={handlers.uploadedBackup}
          uploadedFileName={handlers.uploadedFileName}
          validationResult={handlers.validationResult}
          isValidating={handlers.isValidating}
          isRestoring={handlers.isRestoring}
          restoreError={handlers.restoreError}
          restoreSuccess={handlers.restoreSuccess}
          showConfirmModal={handlers.showConfirmModal}
          confirmText={handlers.confirmText}
          fileInputRef={handlers.fileInputRef}
          setShowConfirmModal={handlers.setShowConfirmModal}
          setConfirmText={handlers.setConfirmText}
          handleFileUpload={handlers.handleFileUpload}
          handleClearUpload={handlers.handleClearUpload}
          handleRestore={handlers.handleRestore}
          formatDate={formatDate}
        />
      )}

      {/* Encryption Keys Section */}
      <EncryptionKeyDisplay
        encryptionKeys={encryptionKeys}
        isLoadingKeys={isLoadingKeys}
        keysError={keysError}
        onRevealKeys={handleRevealKeys}
        showEncryptionKey={showEncryptionKey}
        setShowEncryptionKey={setShowEncryptionKey}
        showEncryptionSalt={showEncryptionSalt}
        setShowEncryptionSalt={setShowEncryptionSalt}
        copiedKey={handlers.copiedKey}
        copyToClipboard={handlers.copyToClipboard}
        downloadEncryptionKeys={handlers.downloadEncryptionKeys}
      />

      {/* Info Box */}
      <div className="surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          {activeTab === 'backup' ? 'About Backups' : 'About Restore'}
        </h4>
        <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1 list-disc list-inside">
          {activeTab === 'backup' ? (
            <>
              <li>Backups include all users, wallets, transactions, addresses, labels, and settings</li>
              <li>Backups can be restored to this or another Sanctuary instance</li>
              <li>Passwords are stored as secure hashes and remain protected</li>
              <li>Consider creating regular backups before major changes</li>
              <li><strong>Node passwords and 2FA secrets are encrypted</strong> - save your encryption keys!</li>
            </>
          ) : (
            <>
              <li>Restoring will completely replace all existing data</li>
              <li>Backups from older versions can be restored to newer versions</li>
              <li>You will be logged out after restore and need to log in again</li>
              <li>The restore process cannot be undone - create a backup first</li>
              <li><strong>To restore encrypted data</strong>, ensure ENCRYPTION_KEY and ENCRYPTION_SALT match the original instance</li>
            </>
          )}
        </ul>
      </div>

      {/* Backup Complete Modal - Encryption Key Reminder */}
      {handlers.showBackupCompleteModal && encryptionKeys && (
        <BackupCompleteModal
          encryptionKeys={encryptionKeys}
          copiedKey={handlers.copiedKey}
          dontShowAgain={handlers.dontShowAgain}
          setDontShowAgain={handlers.setDontShowAgain}
          copyToClipboard={handlers.copyToClipboard}
          downloadEncryptionKeys={handlers.downloadEncryptionKeys}
          onDismiss={handlers.dismissBackupCompleteModal}
        />
      )}
    </div>
  );
};
