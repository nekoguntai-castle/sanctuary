import React, { useState, useEffect, useRef } from 'react';
import { Lock, AlertCircle, Eye, EyeOff, Check, X } from 'lucide-react';
import { Button } from './ui/Button';
import * as authApi from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { createLogger } from '../utils/logger';

const log = createLogger('ChangePasswordModal');

interface ChangePasswordModalProps {
  onPasswordChanged: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onPasswordChanged }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPasswordRef = useRef<HTMLInputElement>(null);

  // Password requirement checks
  const passwordChecks = {
    minLength: newPassword.length >= 8,
    hasUppercase: /[A-Z]/.test(newPassword),
    hasLowercase: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
  };
  const allRequirementsMet = Object.values(passwordChecks).every(Boolean);

  // Auto-focus the current password field when the modal opens
  useEffect(() => {
    currentPasswordRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (!allRequirementsMet) {
      setError('Password does not meet all requirements');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password must be different from current password');
      return;
    }

    setIsChangingPassword(true);

    try {
      await authApi.changePassword({
        currentPassword,
        newPassword,
      });

      // Success - notify parent component
      onPasswordChanged();
    } catch (err) {
      log.error('Password change error', { error: err });
      const message = err instanceof ApiError ? err.message : 'Failed to change password';
      setError(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Password Change Required
              </h3>
              <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-0.5">
                For security, you must change the default password
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              You are currently using the default password. Please choose a strong, unique password to secure your account.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              This is a one-time setup step. You won't see this screen again.
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800 dark:text-red-300">{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
              Current Password
            </label>
            <div className="relative">
              <input
                ref={currentPasswordRef}
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                placeholder="sanctuary"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                placeholder="Enter new password"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {/* Password Requirements Checklist */}
            <div className="mt-3 p-3 surface-muted rounded-lg border border-sanctuary-200 dark:border-sanctuary-700">
              <p className="text-xs font-medium text-sanctuary-600 dark:text-sanctuary-400 mb-2">Password Requirements:</p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className={`flex items-center text-xs ${passwordChecks.minLength ? 'text-green-600 dark:text-green-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
                  {passwordChecks.minLength ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <X className="w-3.5 h-3.5 mr-1.5" />}
                  <span>8+ characters</span>
                </div>
                <div className={`flex items-center text-xs ${passwordChecks.hasUppercase ? 'text-green-600 dark:text-green-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
                  {passwordChecks.hasUppercase ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <X className="w-3.5 h-3.5 mr-1.5" />}
                  <span>Uppercase letter</span>
                </div>
                <div className={`flex items-center text-xs ${passwordChecks.hasLowercase ? 'text-green-600 dark:text-green-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
                  {passwordChecks.hasLowercase ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <X className="w-3.5 h-3.5 mr-1.5" />}
                  <span>Lowercase letter</span>
                </div>
                <div className={`flex items-center text-xs ${passwordChecks.hasNumber ? 'text-green-600 dark:text-green-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
                  {passwordChecks.hasNumber ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <X className="w-3.5 h-3.5 mr-1.5" />}
                  <span>Number</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                placeholder="Confirm new password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {/* Real-time password match indicator */}
            {confirmPassword.length > 0 && (
              <div className={`flex items-center mt-1.5 text-xs ${
                newPassword === confirmPassword
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}>
                {newPassword === confirmPassword ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" />
                    <span>Passwords match</span>
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5 mr-1" />
                    <span>Passwords do not match</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <Button
              type="submit"
              className="w-full justify-center"
              isLoading={isChangingPassword}
              disabled={!currentPassword || !newPassword || !confirmPassword || !allRequirementsMet}
            >
              {isChangingPassword ? 'Changing Password...' : 'Change Password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
