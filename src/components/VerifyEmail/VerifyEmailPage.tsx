/**
 * VerifyEmailPage - Landing page for the emailed verification link
 * (/#/verify-email?token=...). Works with or without a session.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { NoticeAlert } from '../ui/NoticeAlert';
import { useResendPendingForm, useVerifyEmail } from './useVerifyEmail';

const INPUT_CLASS =
  'appearance-none rounded-md block w-full px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 sm:text-sm';

const SignInLink: React.FC = () => (
  <Link to="/" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
    Sign in
  </Link>
);

const ResendForm: React.FC = () => {
  const { username, password, isSending, feedback, setUsername, setPassword, submit } = useResendPendingForm();

  return (
    <form onSubmit={submit} className="space-y-3 text-left" aria-label="Request a new verification email">
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Enter your username and password to get a new verification link.
      </p>
      <div>
        <label htmlFor="resend-username" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Username</label>
        <input id="resend-username" autoComplete="username" className={INPUT_CLASS} required value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        <label htmlFor="resend-password" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Password</label>
        <input id="resend-password" type="password" autoComplete="current-password" className={INPUT_CLASS} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <NoticeAlert message={feedback?.kind === 'success' ? feedback.message : null} />
      <ErrorAlert message={feedback?.kind === 'error' ? feedback.message : null} />
      <Button type="submit" className="w-full justify-center" isLoading={isSending}>
        Send a new link
      </Button>
    </form>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { status, message } = useVerifyEmail();

  return (
    <div className="min-h-screen flex items-center justify-center bg-atmospheric p-4">
      <div className="w-full max-w-md rounded-xl surface-glass shadow-sm p-6 space-y-4 text-center">
        <h1 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-100">Email verification</h1>

        {status === 'verifying' && (
          <p role="status" className="text-sm text-sanctuary-500 dark:text-sanctuary-400">Verifying your email address...</p>
        )}

        {status === 'success' && (
          <>
            <NoticeAlert message={message} />
            <SignInLink />
          </>
        )}

        {status === 'error' && <ErrorAlert message={message} />}

        {status === 'missing-token' && (
          <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
            This verification link is incomplete. Request a new one below.
          </p>
        )}

        {(status === 'error' || status === 'missing-token') && (
          <>
            <ResendForm />
            <SignInLink />
          </>
        )}
      </div>
    </div>
  );
};
