import React from 'react';
import { Lock, AlertCircle, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button';
import { PasswordFormProps } from './types';

type PasswordAlertTone = 'error' | 'success';

function PasswordFormHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Lock className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Change Password</h3>
      </div>
    </div>
  );
}

function PasswordStatusAlert({
  message,
  tone,
}: {
  message: string;
  tone: PasswordAlertTone;
}) {
  const isError = tone === 'error';
  const AlertIcon = isError ? AlertCircle : Check;

  return (
    <div className={`p-4 border rounded-lg flex items-start animate-fade-in ${
      isError
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    }`}>
      <AlertIcon className={`w-5 h-5 mr-2 flex-shrink-0 mt-0.5 ${
        isError
          ? 'text-red-600 dark:text-red-400'
          : 'text-green-600 dark:text-green-400'
      }`} />
      <span className={`text-sm ${
        isError
          ? 'text-red-800 dark:text-red-300'
          : 'text-green-800 dark:text-green-300'
      }`}>
        {message}
      </span>
    </div>
  );
}

interface PasswordInputFieldProps {
  helperText?: string;
  label: string;
  minLength?: number;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
  showValue: boolean;
  value: string;
}

function PasswordInputField({
  helperText,
  label,
  minLength,
  onChange,
  onToggleVisibility,
  showValue,
  value,
}: PasswordInputFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <div className="relative">
        <input
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
          required
          minLength={minLength}
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
        >
          {showValue ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>
      {helperText && <p className="text-xs text-sanctuary-500 mt-1">{helperText}</p>}
    </div>
  );
}

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
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <PasswordFormHeader />

      <form onSubmit={onSubmit} className="p-6 space-y-6">
        {passwordError && <PasswordStatusAlert message={passwordError} tone="error" />}

        {passwordSuccess && (
          <PasswordStatusAlert
            message="Password changed successfully"
            tone="success"
          />
        )}

        <PasswordInputField
          label="Current Password"
          onChange={onCurrentPasswordChange}
          onToggleVisibility={onToggleShowCurrentPassword}
          showValue={showCurrentPassword}
          value={currentPassword}
        />

        <PasswordInputField
          helperText="Minimum 6 characters"
          label="New Password"
          minLength={6}
          onChange={onNewPasswordChange}
          onToggleVisibility={onToggleShowNewPassword}
          showValue={showNewPassword}
          value={newPassword}
        />

        <PasswordInputField
          label="Confirm New Password"
          minLength={6}
          onChange={onConfirmPasswordChange}
          onToggleVisibility={onToggleShowConfirmPassword}
          showValue={showConfirmPassword}
          value={confirmPassword}
        />

        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 flex justify-end">
          <Button type="submit" isLoading={isChangingPassword} disabled={passwordSuccess}>
            {passwordSuccess ? 'Password Changed' : 'Change Password'}
          </Button>
        </div>
      </form>
    </div>
  );
};
