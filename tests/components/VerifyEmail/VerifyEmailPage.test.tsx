import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
});
