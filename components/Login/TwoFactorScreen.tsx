/**
 * TwoFactorScreen - 2FA verification form shown after successful login with TOTP enabled
 */

import React from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { ArrowLeft } from 'lucide-react';
import { SanctuaryShieldLogo } from '../ui/CustomIcons';
import { LoginBackground } from './LoginBackground';
import { LoginLogoContainer } from './LoginLogoContainer';

interface TwoFactorScreenProps {
  darkMode: boolean;
  twoFactorCode: string;
  onTwoFactorCodeChange: (code: string) => void;
  twoFactorInputRef: React.RefObject<HTMLInputElement | null>;
  isLoading: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const TwoFactorScreen: React.FC<TwoFactorScreenProps> = ({
  darkMode,
  twoFactorCode,
  onTwoFactorCodeChange,
  twoFactorInputRef,
  isLoading,
  error,
  onSubmit,
  onCancel,
}) => (
  <LoginBackground darkMode={darkMode}>
    {/* Staggered entrance */}
    <div className="text-center login-reveal-1">
      <LoginLogoContainer>
        <SanctuaryShieldLogo className="h-10 w-10 text-primary-600 dark:text-primary-400" ready={twoFactorCode.length >= 6} />
      </LoginLogoContainer>
      <h2 className="mt-6 text-3xl font-medium text-sanctuary-900 dark:text-sanctuary-100 tracking-tight">
        Two-Factor Authentication
      </h2>
      <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Enter the 6-digit code from your authenticator app
      </p>
    </div>

    <form className="mt-8 space-y-6 login-reveal-2" onSubmit={onSubmit}>
      <div className="rounded-lg surface-elevated shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 p-6 space-y-4">
        {/* Input ripple effect */}
        <div className="input-ripple">
          <label htmlFor="twoFactorCode" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">
            Verification Code
          </label>
          <input
            ref={twoFactorInputRef}
            id="twoFactorCode"
            name="twoFactorCode"
            type="text"
            autoComplete="one-time-code"
            required
            value={twoFactorCode}
            onChange={(e) => onTwoFactorCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            className="appearance-none rounded-md block w-full px-4 py-3 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 text-center text-2xl tracking-[0.3em] font-mono transition-colors"
            placeholder="000000"
            maxLength={8}
          />
        </div>
        <p className="text-xs text-sanctuary-400 text-center">
          You can also enter a backup code if you don't have access to your authenticator app
        </p>
      </div>

      <ErrorAlert message={error} className="text-center" />

      <div className="space-y-3 login-reveal-3">
        <Button
          type="submit"
          className="w-full justify-center py-3"
          isLoading={isLoading}
          disabled={twoFactorCode.length < 6}
        >
          {isLoading ? 'Verifying...' : 'Verify'}
        </Button>

        <button
          type="button"
          onClick={onCancel}
          className="w-full flex items-center justify-center gap-2 text-sm text-sanctuary-500 dark:text-sanctuary-400 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </button>
      </div>
    </form>
  </LoginBackground>
);
