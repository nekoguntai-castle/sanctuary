/**
 * Hooks for the email verification page: completing verification from the
 * emailed token, and asking for a new link with credentials (the user has no
 * session to use the authenticated resend with).
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import * as authApi from '../../api/auth';
import { apiErrorMessageOr } from '../../api/client';

export type VerifyStatus = 'missing-token' | 'verifying' | 'success' | 'error';

interface VerifyState {
  status: VerifyStatus;
  message: string | null;
}

export function useVerifyEmail(): VerifyState {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get('token');
  const [result, setResult] = useState<VerifyState | null>(null);
  // StrictMode runs effects twice; the token is single-use, so POST it once.
  const postedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || postedTokenRef.current === token) return;
    postedTokenRef.current = token;

    authApi.verifyEmail(token).then(
      (response) => setResult({ status: 'success', message: response.message }),
      (err: unknown) => setResult({
        status: 'error',
        message: apiErrorMessageOr(err, 'Email verification failed'),
      }),
    );
  }, [token]);

  if (!token) return { status: 'missing-token', message: null };
  return result ?? { status: 'verifying', message: null };
}

export interface ResendFeedback {
  kind: 'success' | 'error';
  message: string;
}

export function useResendPendingForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<ResendFeedback | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    setFeedback(null);
    try {
      const response = await authApi.resendPendingVerification({ username, password });
      setFeedback({ kind: 'success', message: response.message });
    } catch (err) {
      setFeedback({ kind: 'error', message: apiErrorMessageOr(err, 'Could not request a new verification email') });
    } finally {
      setIsSending(false);
    }
  };

  return { username, password, isSending, feedback, setUsername, setPassword, submit };
}
