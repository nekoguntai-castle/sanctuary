import React from 'react';
import { X, Check, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { BackupCodesGrid } from './BackupCodesGrid';
import { SetupTwoFactorModalProps } from './types';

export const SetupTwoFactorModal: React.FC<SetupTwoFactorModalProps> = ({
  setupData,
  setupVerifyCode,
  backupCodes,
  twoFactorError,
  is2FALoading,
  copiedCode,
  onSetupVerifyCodeChange,
  onVerifyAndEnable,
  onCopyToClipboard,
  onCopyAllBackupCodes,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {backupCodes.length > 0 ? 'Save Backup Codes' : 'Set Up Two-Factor Authentication'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {backupCodes.length > 0 ? (
            /* Show backup codes after successful setup */
            <>
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>Important:</strong> Save these backup codes in a secure place. You won't be able to see them again!
                </p>
              </div>
              <BackupCodesGrid
                backupCodes={backupCodes}
                copiedCode={copiedCode}
                codePrefix="code"
                onCopyToClipboard={onCopyToClipboard}
                onCopyAllBackupCodes={onCopyAllBackupCodes}
              />
              <Button onClick={onClose} className="w-full">
                I've Saved My Codes
              </Button>
            </>
          ) : (
            /* QR Code setup flow */
            <>
              {setupData && (
                <>
                  <div className="text-center">
                    <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-4">
                      Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                    </p>
                    <div className="inline-block p-4 bg-white rounded-lg">
                      <img src={setupData.qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48" />
                    </div>
                  </div>

                  <div className="text-center">
                    <p className="text-xs text-sanctuary-500 mb-1">Or enter this code manually:</p>
                    <button
                      onClick={() => onCopyToClipboard(setupData.secret, 'secret')}
                      className="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded hover:border-primary-500 transition-colors"
                    >
                      {setupData.secret}
                      {copiedCode === 'secret' ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-sanctuary-400" />
                      )}
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                      Enter verification code
                    </label>
                    <input
                      type="text"
                      value={setupVerifyCode}
                      onChange={(e) => onSetupVerifyCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-2xl tracking-[0.5em] font-mono text-sanctuary-900 dark:text-sanctuary-100"
                      maxLength={6}
                    />
                  </div>

                  {twoFactorError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                      {twoFactorError}
                    </div>
                  )}

                  <Button
                    onClick={onVerifyAndEnable}
                    disabled={setupVerifyCode.length < 6}
                    isLoading={is2FALoading}
                    className="w-full"
                  >
                    Verify and Enable 2FA
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
