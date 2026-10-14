/**
 * useLoginFlow - State management hook for the login/register/2FA flow
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useUser } from '../../contexts/UserContext';
import { getRegistrationStatus, resendPendingVerification } from '../../api/auth';
import { ApiError } from '../../api/client';
import type { ResendFeedback } from '../VerifyEmail/useVerifyEmail';
import { checkApiHealth } from '../../api/health';

export function useLoginFlow() {
  const {
    login,
    register,
    verify2FA,
    cancel2FA,
    twoFactorPending,
    isLoading: isBootLoading,
    error,
    notice,
    clearError,
    clearNotice,
  } = useUser();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const twoFactorInputRef = useRef<HTMLInputElement>(null);
  const apiCheckGenerationRef = useRef(0);
  const [darkMode, setDarkMode] = useState(false);
  // Track the submit state locally in addition to reading the boot
  // loading flag from UserContext.
  //
  // ADR 0001 / 0002 Phase 4/6 UX invariants:
  //
  //   - During the boot `/auth/me` check, the submit button must be
  //     disabled so the user cannot fire a login API call that races
  //     the boot authentication probe. A raced login against a session
  //     that is actually already authenticated can produce a confusing
  //     error flash or a benign double-request.
  //
  //   - During the boot check, the button label must still read
  //     "Sign In" (not "Signing in..."). The user has not clicked
  //     anything yet; showing "Signing in..." is confusing and also
  //     breaks the E2E test `auth.spec.ts:14` which looks for
  //     `getByRole('button', { name: /sign in/i })`.
  //
  //   - During actual submission (after the user clicks Sign In), the
  //     button must be disabled AND show the "Signing in..." label.
  //
  // Splitting into `isBootLoading` (from UserContext) and `isSubmitting`
  // (local) lets LoginForm/TwoFactorScreen pass the former as `disabled`
  // and the latter as `isLoading`, so the text and spinner reflect only
  // real submissions while the button stays un-pressable during boot.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set when the last sign-in was refused because the email is unverified;
  // offers a credentialed resend (the user has no session to resend with).
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendFeedback, setResendFeedback] = useState<ResendFeedback | null>(null);

  // Apply system color scheme preference on login screen
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applySystemTheme = (isDark: boolean) => {
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Apply initial preference
    applySystemTheme(mediaQuery.matches);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => applySystemTheme(e.matches);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Check API status and registration status on mount
  useEffect(() => {
    const abortController = new AbortController();
    const checkGeneration = apiCheckGenerationRef.current + 1;
    apiCheckGenerationRef.current = checkGeneration;
    const isCurrentCheck = () => (
      apiCheckGenerationRef.current === checkGeneration &&
      !abortController.signal.aborted
    );

    const checkApi = async () => {
      try {
        const connected = await checkApiHealth({ signal: abortController.signal });
        if (!isCurrentCheck()) return;

        if (connected) {
          setApiStatus('connected');

          try {
            const regStatus = await getRegistrationStatus();
            if (isCurrentCheck()) {
              setRegistrationEnabled(regStatus.enabled);
            }
          } catch {
            if (isCurrentCheck()) {
              setRegistrationEnabled(false);
            }
          }
        } else {
          setApiStatus('error');
        }
      } catch {
        if (isCurrentCheck()) {
          setApiStatus('error');
        }
      }
    };

    void checkApi();

    return () => {
      apiCheckGenerationRef.current += 1;
      abortController.abort();
    };
  }, []);

  // Focus 2FA input when it appears
  useEffect(() => {
    if (twoFactorPending && twoFactorInputRef.current) {
      twoFactorInputRef.current.focus();
    }
  }, [twoFactorPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders: the submit button is already disabled via
    // the Button `disabled` prop during boot, but refuse to fire the
    // login/register API call here too so an Enter keypress on the form
    // cannot sneak past the button state and race the /auth/me probe.
    if (isBootLoading || isSubmitting) return;
    clearError();
    clearNotice();
    setEmailVerificationRequired(false);
    setResendFeedback(null);
    setIsSubmitting(true);
    try {
      if (isRegisterMode) {
        await register(username, password, email);
      } else {
        const result = await login(username, password);
        setEmailVerificationRequired(result.emailVerificationRequired === true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBootLoading || isSubmitting) return;
    clearError();
    clearNotice();
    setIsSubmitting(true);
    try {
      await verify2FA(twoFactorCode);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setIsResendingVerification(true);
    setResendFeedback(null);
    try {
      const response = await resendPendingVerification({ username, password });
      setResendFeedback({ kind: 'success', message: response.message });
    } catch (err) {
      setResendFeedback({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not request a new verification email',
      });
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleCancel2FA = () => {
    setTwoFactorCode('');
    cancel2FA();
    clearNotice();
  };

  const toggleMode = useCallback(() => {
    setIsRegisterMode(prev => !prev);
    setEmailVerificationRequired(false);
    setResendFeedback(null);
    clearError();
    clearNotice();
    setUsername('');
    setPassword('');
    setEmail('');
  }, [clearError, clearNotice]);

  return {
    // State
    isRegisterMode,
    username,
    password,
    email,
    apiStatus,
    registrationEnabled,
    twoFactorCode,
    twoFactorInputRef,
    darkMode,
    twoFactorPending,
    isLoading: isSubmitting,
    isBootLoading,
    error,
    notice,
    emailVerificationRequired,
    isResendingVerification,
    resendFeedback,

    // Setters
    setUsername,
    setPassword,
    setEmail,
    setTwoFactorCode,

    // Actions
    handleSubmit,
    handle2FASubmit,
    handleCancel2FA,
    handleResendVerification,
    toggleMode,
  };
}
