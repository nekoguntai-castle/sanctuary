import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateUserModal } from '../../../components/UsersGroups/CreateUserModal';

vi.mock('../../../components/UsersGroups/PasswordRequirements', () => ({
  PasswordRequirements: ({ password }: { password: string }) => (
    <div data-testid="password-requirements">{password.length}</div>
  ),
}));

const defaultProps = {
  isOpen: true,
  isCreating: false,
  error: null as string | null,
  onClose: vi.fn(),
  onCreate: vi.fn(),
};

describe('CreateUserModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<CreateUserModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('submits entered values including email and admin toggle', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateUserModal {...defaultProps} onCreate={onCreate} />);

    await user.type(screen.getByPlaceholderText('Enter username'), 'alice');
    await user.type(screen.getByPlaceholderText('Enter password'), 'SecurePass123!');
    await user.type(screen.getByPlaceholderText('user@example.com'), 'alice@example.com');

    const adminToggle = screen.getByText('Administrator privileges').previousElementSibling as HTMLButtonElement;
    await user.click(adminToggle);

    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(onCreate).toHaveBeenCalledWith({
      username: 'alice',
      password: 'SecurePass123!',
      email: 'alice@example.com',
      isAdmin: true,
    });
  });

  it('toggles password visibility and resets form state when closing from backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<CreateUserModal {...defaultProps} onClose={onClose} />);

    const usernameInput = screen.getByPlaceholderText('Enter username');
    const passwordInput = screen.getByPlaceholderText('Enter password');
    const emailInput = screen.getByPlaceholderText('user@example.com');
    const adminToggle = screen.getByText('Administrator privileges').previousElementSibling as HTMLButtonElement;
    const passwordToggle = passwordInput.parentElement?.querySelector('button[type="button"]') as HTMLButtonElement;

    await user.type(usernameInput, 'bob');
    await user.type(passwordInput, 'MyPassword');
    await user.type(emailInput, 'bob@example.com');
    await user.click(adminToggle);
    await user.click(passwordToggle);
    expect(passwordInput).toHaveAttribute('type', 'text');

    const overlay = container.querySelector('.fixed.inset-0') as HTMLElement;
    await user.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(usernameInput).toHaveValue('');
    expect(passwordInput).toHaveValue('');
    expect(emailInput).toHaveValue('');
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Create User' })).toBeDisabled();
  });

  it('shows provided error text', () => {
    render(<CreateUserModal {...defaultProps} error="Username already exists" />);
    expect(screen.getByText('Username already exists')).toBeInTheDocument();
  });
});
