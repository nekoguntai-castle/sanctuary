/**
 * Backup Complete Modal
 *
 * Post-backup encryption key reminder modal.
 * Reminds the user to save their encryption keys after creating a backup.
 */

import React from 'react';
import { Button } from '../ui/Button';
import {
  AlertTriangle,
  Check,
  Key,
  Copy,
  FileText,
} from 'lucide-react';
import type { EncryptionKeysResponse } from '../../src/api/admin';

interface BackupCompleteModalProps {
  encryptionKeys: EncryptionKeysResponse;
  copiedKey: string | null;
  dontShowAgain: boolean;
  setDontShowAgain: (value: boolean) => void;
  copyToClipboard: (text: string, keyName: string) => void;
  downloadEncryptionKeys: () => void;
  onDismiss: () => void;
}

export const BackupCompleteModal: React.FC<BackupCompleteModalProps> = ({
  encryptionKeys,
  copiedKey,
  dontShowAgain,
  setDontShowAgain,
  copyToClipboard,
  downloadEncryptionKeys,
  onDismiss,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 w-full max-w-lg mx-4 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-warning-50 dark:bg-warning-900/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-warning-100 dark:bg-warning-800/50 rounded-lg">
              <Key className="w-5 h-5 text-warning-600 dark:text-warning-400" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Backup Downloaded Successfully
              </h3>
              <p className="text-sm text-sanctuary-500">Don't forget your encryption keys!</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-start space-x-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
            <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-warning-700 dark:text-warning-300">
              <strong>To restore this backup on a new instance, you'll need these encryption keys.</strong>
              <p className="mt-1">Without them, node passwords and 2FA settings cannot be restored.</p>
            </div>
          </div>

          {/* Keys Display */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400">
                ENCRYPTION_KEY
              </label>
              <div className="font-mono text-xs bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100 break-all">
                {encryptionKeys.encryptionKey}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400">
                ENCRYPTION_SALT
              </label>
              <div className="font-mono text-xs bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100 break-all">
                {encryptionKeys.encryptionSalt}
              </div>
            </div>

            <div className="flex space-x-2">
              <Button
                variant="secondary"
                onClick={() => copyToClipboard(
                  `ENCRYPTION_KEY=${encryptionKeys.encryptionKey}\nENCRYPTION_SALT=${encryptionKeys.encryptionSalt}`,
                  'modal-both'
                )}
                className="flex-1"
              >
                {copiedKey === 'modal-both' ? (
                  <>
                    <Check className="w-4 h-4 mr-2 text-success-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Both
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={downloadEncryptionKeys}
                className="flex-1"
              >
                <FileText className="w-4 h-4 mr-2" />
                Download .txt
              </Button>
            </div>
          </div>

          {/* Don't show again checkbox */}
          <label className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500"
            />
            <span>Don't show this reminder again</span>
          </label>

          <Button
            onClick={onDismiss}
            className="w-full"
          >
            <Check className="w-4 h-4 mr-2" />
            I've Saved My Keys
          </Button>
        </div>
      </div>
    </div>
  );
};
