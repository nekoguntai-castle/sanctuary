import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { DisableTwoFactorModalProps } from './types';

export const DisableTwoFactorModal: React.FC<DisableTwoFactorModalProps> = ({
  disablePassword,
  disableToken,
  twoFactorError,
  is2FALoading,
  onDisablePasswordChange,
  onDisableTokenChange,
  onDisable,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Disable Two-Factor Authentication</h3>
          <button
            onClick={onClose}
            className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Disabling 2FA will make your account less secure. You'll only need your password to log in.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password</label>
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => onDisablePasswordChange(e.target.value)}
              className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
              placeholder="Enter your password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">2FA Code</label>
            <input
              type="text"
              value={disableToken}
              onChange={(e) => onDisableTokenChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-center tracking-widest font-mono text-sanctuary-900 dark:text-sanctuary-100"
              placeholder="000000"
              maxLength={8}
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
              variant="primary"
              onClick={onDisable}
              disabled={!disablePassword || disableToken.length < 6}
              isLoading={is2FALoading}
              className="flex-1 bg-red-600 hover:bg-red-700"
            >
              Disable 2FA
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
