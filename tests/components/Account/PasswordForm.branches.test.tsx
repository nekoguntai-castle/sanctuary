import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { PasswordForm } from '../../../src/components/Account/PasswordForm';

const buildProps = (overrides: Partial<React.ComponentProps<typeof PasswordForm>> = {}) => ({
  currentPassword: 'old-pass',
  newPassword: 'new-pass',
  confirmPassword: 'new-pass',
  showCurrentPassword: false,
  showNewPassword: false,
  showConfirmPassword: false,
  isChangingPassword: false,
  passwordSuccess: false,
  passwordError: null,
  onCurrentPasswordChange: vi.fn(),
  onNewPasswordChange: vi.fn(),
  onConfirmPasswordChange: vi.fn(),
  onToggleShowCurrentPassword: vi.fn(),
  onToggleShowNewPassword: vi.fn(),
  onToggleShowConfirmPassword: vi.fn(),
  onSubmit: vi.fn((e: any) => e.preventDefault()),
  ...overrides,
});

describe('Account PasswordForm branch coverage', () => {
  it('covers visible-input/icon branches for new and confirm password', () => {
    const props = buildProps({
      showNewPassword: true,
      showConfirmPassword: true,
    });

    render(<PasswordForm {...props} />);

    const inputs = screen.getAllByDisplayValue(/-pass$/) as HTMLInputElement[];
    // currentPassword, newPassword, confirmPassword
    expect(inputs[1].type).toBe('text');
    expect(inputs[2].type).toBe('text');
    expect(document.querySelectorAll('.lucide-eye-off').length).toBeGreaterThanOrEqual(2);

    const toggleButtons = screen.getAllByRole('button').filter((btn) => btn.getAttribute('type') === 'button');
    fireEvent.click(toggleButtons[1]);
    fireEvent.click(toggleButtons[2]);
    expect(props.onToggleShowNewPassword).toHaveBeenCalledTimes(1);
    expect(props.onToggleShowConfirmPassword).toHaveBeenCalledTimes(1);
  });

  it('covers passwordSuccess submit-label branch', () => {
    render(<PasswordForm {...buildProps({ passwordSuccess: true })} />);
    expect(screen.getByRole('button', { name: 'Password Changed' })).toBeDisabled();
  });
});
