import React from 'react';
import { Lock, AlertCircle, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button';
import { PasswordFormProps } from './types';

export const PasswordForm: React.FC<PasswordFormProps> = ({
  currentPassword,
  newPassword,
  confirmPassword,
  showCurrentPassword,
  showNewPassword,
  showConfirmPassword,
  isChangingPassword,
  passwordSuccess,
  passwordError,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onToggleShowCurrentPassword,
  onToggleShowNewPassword,
  onToggleShowConfirmPassword,
  onSubmit,
}) => {
  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Change Password</h3>
        </div>
      </div>

      <form onSubmit={onSubmit} className="p-6 space-y-6">
        {passwordError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start animate-fade-in">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-red-800 dark:text-red-300">{passwordError}</span>
          </div>
        )}

        {passwordSuccess && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-start animate-fade-in">
            <Check className="w-5 h-5 text-green-600 dark:text-green-400 mr-2 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-green-800 dark:text-green-300">Password changed successfully</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => onCurrentPasswordChange(e.target.value)}
              className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
              required
            />
            <button
              type="button"
              onClick={onToggleShowCurrentPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => onNewPasswordChange(e.target.value)}
              className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={onToggleShowNewPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-sanctuary-500 mt-1">Minimum 6 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Confirm New Password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={onToggleShowConfirmPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 flex justify-end">
          <Button type="submit" isLoading={isChangingPassword} disabled={passwordSuccess}>
            {passwordSuccess ? 'Password Changed' : 'Change Password'}
          </Button>
        </div>
      </form>
    </div>
  );
};
