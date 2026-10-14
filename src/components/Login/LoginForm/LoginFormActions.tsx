import React from 'react';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { NoticeAlert } from '../../ui/NoticeAlert';
import type { ResendFeedback } from '../../VerifyEmail/useVerifyEmail';

const getSubmitLabel = (isLoading: boolean, isRegisterMode: boolean): string => {
  if (isLoading) {
    return isRegisterMode ? 'Creating account...' : 'Signing in...';
  }

  return isRegisterMode ? 'Create Account' : 'Sign In';
};

const getToggleLabel = (isRegisterMode: boolean): string =>
  isRegisterMode ? 'Already have an account? Sign in' : "Don't have an account? Register";

const shouldShowRegistrationToggle = (
  registrationEnabled: boolean,
  isRegisterMode: boolean,
): boolean => registrationEnabled || isRegisterMode;

interface LoginFormActionsProps {
  isRegisterMode: boolean;
  registrationEnabled: boolean;
  isLoading: boolean;
  isBootLoading: boolean;
  error: string | null;
  notice: string | null;
  showResendVerification: boolean;
  isResendingVerification: boolean;
  resendFeedback: ResendFeedback | null;
  onResendVerification: () => void;
  onToggleMode: () => void;
}

export const LoginFormActions: React.FC<LoginFormActionsProps> = ({
  isRegisterMode,
  registrationEnabled,
  isLoading,
  isBootLoading,
  error,
  notice,
  showResendVerification,
  isResendingVerification,
  resendFeedback,
  onResendVerification,
  onToggleMode,
}) => (
  <>
    <NoticeAlert message={notice} className="text-center" />
    <ErrorAlert message={error} className="text-center" />

    {showResendVerification && (
      <div className="space-y-2 text-center">
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-center"
          isLoading={isResendingVerification}
          onClick={onResendVerification}
        >
          Resend verification email
        </Button>
        <NoticeAlert message={resendFeedback?.kind === 'success' ? resendFeedback.message : null} />
        <ErrorAlert message={resendFeedback?.kind === 'error' ? resendFeedback.message : null} />
      </div>
    )}

    <div className="space-y-3 login-reveal-4">
      <Button
        type="submit"
        className="w-full justify-center py-3"
        isLoading={isLoading}
        disabled={isBootLoading}
      >
        {getSubmitLabel(isLoading, isRegisterMode)}
      </Button>

      {shouldShowRegistrationToggle(registrationEnabled, isRegisterMode) && (
        <button
          type="button"
          onClick={onToggleMode}
          className="w-full text-sm text-sanctuary-500 dark:text-sanctuary-400 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors"
        >
          {getToggleLabel(isRegisterMode)}
        </button>
      )}
    </div>
  </>
);
