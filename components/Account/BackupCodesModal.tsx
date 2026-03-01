import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { BackupCodesGrid } from './BackupCodesGrid';
import { BackupCodesModalProps } from './types';

export const BackupCodesModal: React.FC<BackupCodesModalProps> = ({
  backupCodes,
  disablePassword,
  regenerateToken,
  twoFactorError,
  is2FALoading,
  copiedCode,
  onDisablePasswordChange,
  onRegenerateTokenChange,
  onRegenerate,
  onCopyToClipboard,
  onCopyAllBackupCodes,
  onClose,
  onDone,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {backupCodes.length > 0 ? 'New Backup Codes' : 'Regenerate Backup Codes'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {backupCodes.length > 0 ? (
            <>
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>Important:</strong> Save these new backup codes. Your old codes are now invalid!
                </p>
              </div>
              <BackupCodesGrid
                backupCodes={backupCodes}
                copiedCode={copiedCode}
                codePrefix="regen"
                onCopyToClipboard={onCopyToClipboard}
                onCopyAllBackupCodes={onCopyAllBackupCodes}
              />
              <Button onClick={onDone} className="w-full">
                Done
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                This will generate new backup codes and invalidate your existing ones. Enter your password and a 2FA code to confirm.
              </p>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password</label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => onDisablePasswordChange(e.target.value)}
                  className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                  placeholder="Enter your password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">2FA Code</label>
                <input
                  type="text"
                  value={regenerateToken}
                  onChange={(e) => onRegenerateTokenChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-center tracking-widest font-mono text-sanctuary-900 dark:text-sanctuary-100"
                  placeholder="000000"
                  maxLength={6}
                />
              </div>

              {twoFactorError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                  {twoFactorError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={onRegenerate}
                  disabled={!disablePassword || regenerateToken.length < 6}
                  isLoading={is2FALoading}
                  className="flex-1"
                >
                  Generate New Codes
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
