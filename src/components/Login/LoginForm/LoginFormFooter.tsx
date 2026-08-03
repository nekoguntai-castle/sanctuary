import React from 'react';
import type { LoginApiStatus } from './types';

const STATUS_MARK = '\u25cf';

const API_STATUS_VIEW: Record<LoginApiStatus, { className: string; text: string }> = {
  checking: {
    className: 'text-amber-600 dark:text-amber-400',
    text: `${STATUS_MARK} Connecting...`,
  },
  connected: {
    className: 'text-green-600 dark:text-green-400',
    text: `${STATUS_MARK} Connected`,
  },
  error: {
    className: 'text-red-600 dark:text-red-400',
    text: `${STATUS_MARK} Error`,
  },
};

const getFooterCopy = (isRegisterMode: boolean, registrationEnabled: boolean): string => {
  if (isRegisterMode) {
    return 'Create a new account to get started';
  }

  return registrationEnabled
    ? 'Use existing credentials to sign in'
    : 'Contact administrator for account access';
};

interface LoginFormFooterProps {
  apiStatus: LoginApiStatus;
  isRegisterMode: boolean;
  registrationEnabled: boolean;
}

export const LoginFormFooter: React.FC<LoginFormFooterProps> = ({
  apiStatus,
  isRegisterMode,
  registrationEnabled,
}) => {
  const statusView = API_STATUS_VIEW[apiStatus];

  return (
    <div className="text-center space-y-2 login-reveal-5">
      <p className="text-xs text-sanctuary-400 dark:text-sanctuary-600">
        Backend API: <span className={statusView.className}>{statusView.text}</span>
      </p>
      <p className="text-[10px] text-sanctuary-300 dark:text-sanctuary-600">
        {getFooterCopy(isRegisterMode, registrationEnabled)}
      </p>
    </div>
  );
};
