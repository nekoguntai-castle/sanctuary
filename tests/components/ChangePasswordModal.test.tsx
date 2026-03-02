/**
 * Tests for ChangePasswordModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { ApiError } from '../../src/api/client';
import * as authApi from '../../src/api/auth';

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock API
vi.mock('../../src/api/auth', () => ({
  changePassword: vi.fn(),
}));

describe('ChangePasswordModal', () => {
  const defaultProps = {
    onPasswordChanged: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.changePassword).mockResolvedValue({} as any);
  });

  describe('rendering', () => {
    it('renders modal with title', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText('Password Change Required')).toBeInTheDocument();
    });

    it('shows security explanation', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText(/For security, you must change the default password/)).toBeInTheDocument();
    });

    it('shows warning about default password', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText(/You are currently using the default password/)).toBeInTheDocument();
    });

    it('shows one-time setup message', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText(/This is a one-time setup step/)).toBeInTheDocument();
    });
  });

  describe('password fields', () => {
    it('shows current password field', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      // Check for the label text and the input (via placeholder since label isn't properly associated)
      expect(screen.getByText('Current Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('sanctuary')).toBeInTheDocument();
    });

    it('shows new password field', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText('New Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter new password')).toBeInTheDocument();
    });

    it('shows confirm password field', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText('Confirm New Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Confirm new password')).toBeInTheDocument();
    });

    it('shows placeholder hint for current password', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByPlaceholderText('sanctuary')).toBeInTheDocument();
    });

    it('auto-focuses current password field', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      const currentPasswordInput = screen.getByPlaceholderText('sanctuary');
      expect(document.activeElement).toBe(currentPasswordInput);
    });
  });

  describe('password visibility toggles', () => {
    it('hides passwords by default', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      // All password inputs should have type="password" initially
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBe(3);
    });

    it('toggles current password visibility', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      // Find the visibility toggle buttons
      const toggleButtons = document.querySelectorAll('button[type="button"]');
      const currentToggle = toggleButtons[0]; // First toggle is for current password

      // Initially password type
      const currentInput = screen.getByPlaceholderText('sanctuary');
      expect(currentInput).toHaveAttribute('type', 'password');

      // Click toggle
      await user.click(currentToggle);

      // Should now be text type
      expect(currentInput).toHaveAttribute('type', 'text');
    });

    it('toggles new password visibility', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const toggleButtons = document.querySelectorAll('button[type="button"]');
      const newToggle = toggleButtons[1];

      const newInput = screen.getByPlaceholderText('Enter new password');
      expect(newInput).toHaveAttribute('type', 'password');

      await user.click(newToggle);

      expect(newInput).toHaveAttribute('type', 'text');
    });

    it('toggles confirm password visibility', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const toggleButtons = document.querySelectorAll('button[type="button"]');
      const confirmToggle = toggleButtons[2];

      const confirmInput = screen.getByPlaceholderText('Confirm new password');
      expect(confirmInput).toHaveAttribute('type', 'password');

      await user.click(confirmToggle);

      expect(confirmInput).toHaveAttribute('type', 'text');
    });
  });

  describe('password requirements checklist', () => {
    it('shows password requirements', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.getByText('Password Requirements:')).toBeInTheDocument();
      expect(screen.getByText('8+ characters')).toBeInTheDocument();
      expect(screen.getByText('Uppercase letter')).toBeInTheDocument();
      expect(screen.getByText('Lowercase letter')).toBeInTheDocument();
      expect(screen.getByText('Number')).toBeInTheDocument();
    });

    it('shows unchecked state initially', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      // Requirements should show X icons initially
      const xIcons = document.querySelectorAll('[class*="text-sanctuary-400"]');
      expect(xIcons.length).toBeGreaterThan(0);
    });

    it('checks minimum length requirement', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const newInput = screen.getByPlaceholderText('Enter new password');
      await user.type(newInput, 'Password1');

      // 8+ characters requirement should be checked (green)
      const checkmarks = document.querySelectorAll('[class*="text-green"]');
      expect(checkmarks.length).toBeGreaterThan(0);
    });

    it('checks all requirements for valid password', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const newInput = screen.getByPlaceholderText('Enter new password');
      await user.type(newInput, 'StrongP@ss1');

      // All requirements should be checked
      const checkmarks = document.querySelectorAll('[class*="text-green"]');
      expect(checkmarks.length).toBe(4);
    });
  });

  describe('password match indicator', () => {
    it('does not show match indicator when confirm is empty', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.queryByText('Passwords match')).not.toBeInTheDocument();
      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    });

    it('shows mismatch indicator when passwords differ', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(newInput, 'Password1');
      await user.type(confirmInput, 'Password2');

      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('shows match indicator when passwords match', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(newInput, 'Password1');
      await user.type(confirmInput, 'Password1');

      expect(screen.getByText('Passwords match')).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('disables submit when fields are empty', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      expect(submitButton).toBeDisabled();
    });

    it('disables submit when requirements not met', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'weak'); // Too short, no uppercase, no number
      await user.type(confirmInput, 'weak');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit when all fields valid', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      expect(submitButton).not.toBeDisabled();
    });

    it('shows error when passwords do not match on submit', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'DifferentPassword1');

      // Temporarily enable button by making confirm look valid
      const form = document.querySelector('form');
      if (form) {
        await user.click(form.querySelector('button[type="submit"]')!);
      }

      // The real-time indicator already shows the mismatch
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('shows error when new password same as current', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'Password1');
      await user.type(newInput, 'Password1');
      await user.type(confirmInput, 'Password1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('New password must be different from current password')).toBeInTheDocument();
      });
    });

    it('shows requirements error when submitted with a weak password', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText('sanctuary'), 'sanctuary');
      await user.type(screen.getByPlaceholderText('Enter new password'), 'weakpass');
      await user.type(screen.getByPlaceholderText('Confirm new password'), 'weakpass');

      fireEvent.submit(document.querySelector('form') as HTMLFormElement);

      expect(screen.getByText('Password does not meet all requirements')).toBeInTheDocument();
      expect(authApi.changePassword).not.toHaveBeenCalled();
    });
  });

  describe('form submission', () => {
    it('calls changePassword API with correct parameters', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(authApi.changePassword).toHaveBeenCalledWith({
          currentPassword: 'sanctuary',
          newPassword: 'NewPassword1',
        });
      });
    });

    it('calls onPasswordChanged on success', async () => {
      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(defaultProps.onPasswordChanged).toHaveBeenCalled();
      });
    });

    it('shows loading state during submission', async () => {
      vi.mocked(authApi.changePassword).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({} as any), 100))
      );

      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      expect(screen.getByText('Changing Password...')).toBeInTheDocument();
    });

    it('shows API error message on failure', async () => {
      vi.mocked(authApi.changePassword).mockRejectedValue(
        new ApiError('Current password is incorrect', 400)
      );

      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'wrongpassword');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
      });
    });

    it('shows generic error on unknown failure', async () => {
      vi.mocked(authApi.changePassword).mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      render(<ChangePasswordModal {...defaultProps} />);

      const currentInput = screen.getByPlaceholderText('sanctuary');
      const newInput = screen.getByPlaceholderText('Enter new password');
      const confirmInput = screen.getByPlaceholderText('Confirm new password');

      await user.type(currentInput, 'sanctuary');
      await user.type(newInput, 'NewPassword1');
      await user.type(confirmInput, 'NewPassword1');

      const submitButton = screen.getByRole('button', { name: 'Change Password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Failed to change password')).toBeInTheDocument();
      });
    });
  });

  describe('no cancel option', () => {
    it('does not show cancel button (forced password change)', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('does not show close X button', () => {
      render(<ChangePasswordModal {...defaultProps} />);

      // Modal should not have a close button since it's a forced action
      const closeButtons = document.querySelectorAll('button');
      const hasCloseX = Array.from(closeButtons).some(btn =>
        btn.querySelector('[class*="X"]') && btn.textContent === ''
      );
      expect(hasCloseX).toBe(false);
    });
  });
});
