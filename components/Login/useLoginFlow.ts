/**
 * useLoginFlow - State management hook for the login/register/2FA flow
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useUser } from '../../contexts/UserContext';
import { getRegistrationStatus } from '../../src/api/auth';

export function useLoginFlow() {
  const {
    login,
    register,
    verify2FA,
    cancel2FA,
    twoFactorPending,
    isLoading: isBootLoading,
    error,
    clearError,
  } = useUser();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const twoFactorInputRef = useRef<HTMLInputElement>(null);
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
    const checkApi = async () => {
      try {
        const response = await fetch('/api/v1/health');
        if (response.ok || response.status === 401) {
          setApiStatus('connected');

          try {
            const regStatus = await getRegistrationStatus();
            setRegistrationEnabled(regStatus.enabled);
          } catch {
            setRegistrationEnabled(false);
          }
        } else {
          setApiStatus('error');
        }
      } catch {
        setApiStatus('error');
      }
    };
    checkApi();
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
    setIsSubmitting(true);
    try {
      if (isRegisterMode) {
        await register(username, password, email || undefined);
      } else {
        await login(username, password);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBootLoading || isSubmitting) return;
    clearError();
    setIsSubmitting(true);
    try {
      await verify2FA(twoFactorCode);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel2FA = () => {
    setTwoFactorCode('');
    cancel2FA();
  };

  const toggleMode = useCallback(() => {
    setIsRegisterMode(prev => !prev);
    clearError();
    setUsername('');
    setPassword('');
    setEmail('');
  }, [clearError]);

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

    // Setters
    setUsername,
    setPassword,
    setEmail,
    setTwoFactorCode,

    // Actions
    handleSubmit,
    handle2FASubmit,
    handleCancel2FA,
    toggleMode,
  };
}
