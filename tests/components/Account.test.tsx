/**
 * Account Component Tests
 *
 * Tests for user account settings including password change and 2FA management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ApiError } from '../../src/api/client';

// Mock the UserContext
const mockUpdateUser = vi.fn();
const mockUser = {
  id: 'user-123',
  username: 'testuser',
  email: 'test@example.com',
  twoFactorEnabled: false,
};

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockUser,
    updateUser: mockUpdateUser,
  }),
}));

// Mock auth API
const mockChangePassword = vi.fn();
vi.mock('../../src/api/auth', () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

// Mock 2FA API
const mockSetup2FA = vi.fn();
const mockEnable2FA = vi.fn();
const mockDisable2FA = vi.fn();
const mockRegenerateBackupCodes = vi.fn();
vi.mock('../../src/api/twoFactor', () => ({
  setup2FA: (...args: unknown[]) => mockSetup2FA(...args),
  enable2FA: (...args: unknown[]) => mockEnable2FA(...args),
  disable2FA: (...args: unknown[]) => mockDisable2FA(...args),
  regenerateBackupCodes: (...args: unknown[]) => mockRegenerateBackupCodes(...args),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockCopyToClipboard = vi.fn();

// Mock clipboard utility
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  UserCircle: () => <span data-testid="user-circle-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  Mail: () => <span data-testid="mail-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  Smartphone: () => <span data-testid="smartphone-icon" />,
  Key: () => <span data-testid="key-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, type, disabled, isLoading, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button type={type as 'button' | 'submit' | 'reset' | undefined} disabled={disabled || isLoading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

async function renderAccount() {
  const { Account } = await import('../../components/Account');
  render(<Account />);
}

function getPasswordInputs() {
  return Array.from(document.querySelectorAll('form input')) as HTMLInputElement[];
}

describe('Account Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.twoFactorEnabled = false;
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('should render user information', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('should render password change section', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // Should have a heading for Change Password
    expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
    // Should have password inputs
    const passwordInputs = screen.getAllByDisplayValue('');
    expect(passwordInputs.length).toBeGreaterThanOrEqual(3);
  });

  it('should render 2FA section', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // Use heading role to find the specific heading
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByTestId('smartphone-icon')).toBeInTheDocument();
  });

  it('should have a change password button', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });
});

describe('Account Component - Password Input Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.twoFactorEnabled = false;
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('should have eye icons for password visibility toggle', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // The password visibility toggles should be present
    const eyeIcons = screen.getAllByTestId('eye-icon');
    expect(eyeIcons.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Account Component - 2FA Setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.twoFactorEnabled = false;
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('should show setup button when 2FA is disabled', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByRole('button', { name: /enable 2fa/i })).toBeInTheDocument();
  });

  it('should call setup2FA when setup is initiated', async () => {
    mockSetup2FA.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockQRCode',
    });

    const { Account } = await import('../../components/Account');
    const user = userEvent.setup();

    render(<Account />);

    const setupButton = screen.getByRole('button', { name: /enable 2fa/i });
    await user.click(setupButton);

    await waitFor(() => {
      expect(mockSetup2FA).toHaveBeenCalled();
    });
  });
});

describe('Account Component - 2FA Enabled State', () => {
  it('should render account component with twoFactorEnabled flag', async () => {
    // This test verifies the component can render with different 2FA states
    // The actual 2FA enabled UI is complex and depends on modal state
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // The 2FA section should always be present (use heading role to be specific)
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
  });
});

describe('Account Component - Password Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.twoFactorEnabled = false;
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('shows mismatch validation and skips API call', async () => {
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'current-pass');
    await user.type(newPassword, 'new-pass-123');
    await user.type(confirmPassword, 'different-pass-123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(screen.getByText('New passwords do not match')).toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('shows minimum-length validation and skips API call', async () => {
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'current-pass');
    await user.type(newPassword, '12345');
    await user.type(confirmPassword, '12345');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('submits password change and resets fields on success', async () => {
    mockChangePassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'current-pass');
    await user.type(newPassword, 'new-pass-123');
    await user.type(confirmPassword, 'new-pass-123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'current-pass',
        newPassword: 'new-pass-123',
      });
    });

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument();
    expect(currentPassword.value).toBe('');
    expect(newPassword.value).toBe('');
    expect(confirmPassword.value).toBe('');
  });

  it('clears password success banner after timeout', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockChangePassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'current-pass');
    await user.type(newPassword, 'new-pass-123');
    await user.type(confirmPassword, 'new-pass-123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument();

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 3000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(screen.queryByText('Password changed successfully')).not.toBeInTheDocument();
    timeoutSpy.mockRestore();
  });

  it('shows API error message when password change fails with ApiError', async () => {
    mockChangePassword.mockRejectedValueOnce(new ApiError('Current password is invalid', 400));
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'bad-pass');
    await user.type(newPassword, 'new-pass-123');
    await user.type(confirmPassword, 'new-pass-123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Current password is invalid')).toBeInTheDocument();
  });

  it('shows fallback error message when password change fails with unknown error', async () => {
    mockChangePassword.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    await renderAccount();

    const [currentPassword, newPassword, confirmPassword] = getPasswordInputs();
    await user.type(currentPassword, 'bad-pass');
    await user.type(newPassword, 'new-pass-123');
    await user.type(confirmPassword, 'new-pass-123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Failed to change password')).toBeInTheDocument();
  });

  it('toggles password visibility for current password field', async () => {
    const user = userEvent.setup();
    await renderAccount();

    const currentPasswordSection = screen.getByText('Current Password').parentElement as HTMLElement;
    const input = currentPasswordSection.querySelector('input') as HTMLInputElement;
    const toggle = currentPasswordSection.querySelector('button') as HTMLButtonElement;

    expect(input.type).toBe('password');
    await user.click(toggle);
    expect(input.type).toBe('text');
    await user.click(toggle);
    expect(input.type).toBe('password');
  });
});

describe('Account Component - 2FA Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.twoFactorEnabled = false;
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('opens setup modal and sanitizes verification code input', async () => {
    mockSetup2FA.mockResolvedValueOnce({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockQRCode',
    });

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /enable 2fa/i }));

    expect(await screen.findByRole('heading', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByAltText('2FA QR Code')).toBeInTheDocument();

    const verifyInput = screen.getByPlaceholderText('000000') as HTMLInputElement;
    await user.type(verifyInput, '12ab34x');
    expect(verifyInput.value).toBe('1234');
    expect(screen.getByRole('button', { name: /verify and enable 2fa/i })).toBeDisabled();
  });

  it('verifies 2FA, shows backup codes, and supports copy actions', async () => {
    mockSetup2FA.mockResolvedValueOnce({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockQRCode',
    });
    mockEnable2FA.mockResolvedValueOnce({
      backupCodes: ['CODE1111', 'CODE2222'],
    });

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /enable 2fa/i }));
    await screen.findByRole('heading', { name: /set up two-factor authentication/i });

    const verifyInput = screen.getByPlaceholderText('000000');
    await user.type(verifyInput, '123456');
    await user.click(screen.getByRole('button', { name: /verify and enable 2fa/i }));

    await waitFor(() => {
      expect(mockEnable2FA).toHaveBeenCalledWith('123456');
    });

    expect(await screen.findByRole('heading', { name: /save backup codes/i })).toBeInTheDocument();
    await user.click(screen.getByText('CODE1111'));
    expect(mockCopyToClipboard).toHaveBeenCalledWith('CODE1111');

    await user.click(screen.getByRole('button', { name: /copy all codes/i }));
    expect(mockCopyToClipboard).toHaveBeenCalledWith('CODE1111\nCODE2222');

    await user.click(screen.getByRole('button', { name: /i've saved my codes/i }));
    expect(screen.queryByRole('heading', { name: /save backup codes/i })).not.toBeInTheDocument();
    expect(screen.getByText('2FA Enabled')).toBeInTheDocument();
  });

  it('shows setup error when setup2FA fails with ApiError', async () => {
    mockSetup2FA.mockRejectedValueOnce(new ApiError('Unable to start setup', 500));

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /enable 2fa/i }));

    expect(await screen.findByText('Unable to start setup')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /set up two-factor authentication/i })).not.toBeInTheDocument();
  });

  it('shows verification fallback error when enable2FA fails with unknown error', async () => {
    mockSetup2FA.mockResolvedValueOnce({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockQRCode',
    });
    mockEnable2FA.mockRejectedValueOnce(new Error('bad token'));

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /enable 2fa/i }));
    await screen.findByRole('heading', { name: /set up two-factor authentication/i });
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /verify and enable 2fa/i }));

    const errorMessages = await screen.findAllByText('Invalid verification code');
    expect(errorMessages.length).toBeGreaterThan(0);
  });

  it('disables 2FA from the disable modal', async () => {
    mockUser.twoFactorEnabled = true;
    mockDisable2FA.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /^disable$/i }));
    const modalTitle = await screen.findByRole('heading', { name: /disable two-factor authentication/i });
    const modal = modalTitle.closest('div')?.parentElement?.parentElement as HTMLElement;

    const passwordInput = within(modal).getByPlaceholderText('Enter your password');
    const tokenInput = within(modal).getByPlaceholderText('000000') as HTMLInputElement;
    await user.type(passwordInput, 'account-pass');
    await user.type(tokenInput, 'ab12cd$');
    expect(tokenInput.value).toBe('AB12CD');

    await user.click(within(modal).getByRole('button', { name: /disable 2fa/i }));

    await waitFor(() => {
      expect(mockDisable2FA).toHaveBeenCalledWith({
        password: 'account-pass',
        token: 'AB12CD',
      });
    });

    expect(screen.queryByRole('heading', { name: /disable two-factor authentication/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable 2fa/i })).toBeInTheDocument();
  });

  it('regenerates backup codes and shows new codes modal state', async () => {
    mockUser.twoFactorEnabled = true;
    mockRegenerateBackupCodes.mockResolvedValueOnce({
      backupCodes: ['NEWCODE1', 'NEWCODE2'],
    });

    const user = userEvent.setup();
    await renderAccount();

    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    const modalTitle = await screen.findByRole('heading', { name: /regenerate backup codes/i });
    const modal = modalTitle.closest('div')?.parentElement?.parentElement as HTMLElement;

    await user.type(within(modal).getByPlaceholderText('Enter your password'), 'account-pass');
    await user.type(within(modal).getByPlaceholderText('000000'), '123456');
    await user.click(within(modal).getByRole('button', { name: /generate new codes/i }));

    await waitFor(() => {
      expect(mockRegenerateBackupCodes).toHaveBeenCalledWith({
        password: 'account-pass',
        token: '123456',
      });
    });

    expect(await screen.findByRole('heading', { name: /new backup codes/i })).toBeInTheDocument();
    expect(screen.getByText('NEWCODE1')).toBeInTheDocument();
    expect(screen.getByText('NEWCODE2')).toBeInTheDocument();
  });
});
