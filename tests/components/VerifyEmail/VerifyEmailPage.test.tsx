import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { VerifyEmailPage } from '../../../src/components/VerifyEmail/VerifyEmailPage';
import * as authApi from '../../../src/api/auth';
import { ApiError } from '../../../src/api/client';

vi.mock('../../../src/api/auth', () => ({
  verifyEmail: vi.fn(),
  resendPendingVerification: vi.fn(),
}));

const renderPage = (search: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/verify-email${search}`]}>
        <VerifyEmailPage />
      </MemoryRouter>
    </StrictMode>,
  );

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies the token once (StrictMode-safe) and shows success with a sign in link', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({
      success: true,
      message: 'Email verified successfully',
      email: 'a@example.com',
    });

    renderPage('?token=tok-1');

    expect(screen.getByRole('status')).toHaveTextContent('Verifying');
    expect(await screen.findByText('Email verified successfully')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
    expect(authApi.verifyEmail).toHaveBeenCalledWith('tok-1');
  });

  it('shows the server message and a resend form for an expired link', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError('This verification link has expired. Please request a new one.', 400),
    );

    renderPage('?token=old');

    expect(await screen.findByText('This verification link has expired. Please request a new one.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Request a new verification email' })).toBeInTheDocument();
  });

  it('falls back to a generic message for non-API failures', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(new Error('network down'));

    renderPage('?token=tok');

    expect(await screen.findByText('Email verification failed')).toBeInTheDocument();
  });

  it('does not POST and offers the resend form when the link has no token', () => {
    renderPage('');

    expect(authApi.verifyEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Request a new verification email' })).toBeInTheDocument();
  });

  it('submits the resend form credentials and shows the server confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.resendPendingVerification).mockResolvedValue({
      success: true,
      message: 'If the account needs verification, a new email has been sent.',
    });
    renderPage('');

    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() => expect(authApi.resendPendingVerification).toHaveBeenCalledWith({ username: 'alice', password: 'pw' }));
    expect(await screen.findByText('If the account needs verification, a new email has been sent.')).toBeInTheDocument();
  });

  it.each([
    ['an ApiError', new ApiError('Too many verification email requests.', 429), 'Too many verification email requests.'],
    ['another error', new Error('boom'), 'Could not request a new verification email'],
  ])('shows feedback when the resend fails with %s', async (_name, error, expected) => {
    const user = userEvent.setup();
    vi.mocked(authApi.resendPendingVerification).mockRejectedValue(error);
    renderPage('');

    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('resets to verifying and ignores stale completions when the query token changes while mounted', async () => {
    let resolveFirst!: (val: { success: boolean; message: string; email: string }) => void;
    let rejectFirst!: (err: Error) => void;
    let resolveSecond!: (val: { success: boolean; message: string; email: string }) => void;
    vi.mocked(authApi.verifyEmail)
      .mockReturnValueOnce(new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    let navigateTo!: (path: string) => void;
    function Harness() {
      const navigate = useNavigate();
      navigateTo = navigate;
      return <VerifyEmailPage />;
    }

    render(
      <MemoryRouter initialEntries={['/verify-email?token=tok-1']}>
        <Harness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Verifying');

    // Switch token before tok-1 settles
    act(() => {
      navigateTo('/verify-email?token=tok-2');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');

    // Stale tok-1 resolves late — must be ignored
    await act(async () => {
      resolveFirst({ success: true, message: 'Stale token 1 verified', email: 'old@example.com' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale token 1 verified')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');

    // tok-2 resolves — displayed
    await act(async () => {
      resolveSecond({ success: true, message: 'Token 2 verified', email: 'new@example.com' });
      await Promise.resolve();
    });
    expect(await screen.findByText('Token 2 verified')).toBeInTheDocument();

    // Switch to tok-3 after tok-2 succeeded — must immediately show Verifying, not stale Token 2 verified
    let rejectThird!: (err: Error) => void;
    vi.mocked(authApi.verifyEmail).mockReturnValueOnce(
      new Promise((_, reject) => { rejectThird = reject; }),
    );
    act(() => {
      navigateTo('/verify-email?token=tok-3');
    });
    expect(screen.queryByText('Token 2 verified')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');

    // Switch to tok-4 before tok-3 rejects — late rejection from tok-3 must be ignored
    vi.mocked(authApi.verifyEmail).mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      navigateTo('/verify-email?token=tok-4');
    });
    await act(async () => {
      rejectThird(new Error('stale error'));
      await Promise.resolve();
    });
    expect(screen.queryByText('Email verification failed')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');
    void rejectFirst;
  });
});
