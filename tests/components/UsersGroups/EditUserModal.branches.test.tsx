import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { EditUserModal } from '../../../components/UsersGroups/EditUserModal';

describe('EditUserModal branch coverage', () => {
  const buildUser = (overrides: Partial<any> = {}) => ({
    id: 'user-1',
    username: 'alice',
    email: null,
    emailVerified: false,
    isAdmin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('returns null when user is not provided', () => {
    const { container } = render(
      <EditUserModal
        user={null}
        isUpdating={false}
        error={null}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('covers field updates, password visibility, admin toggle, and user-change reinitialization', () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn();

    const { container, rerender } = render(
      <EditUserModal
        user={buildUser()}
        isUpdating={false}
        error="Update failed"
        onClose={onClose}
        onUpdate={onUpdate}
      />
    );

    expect(screen.getByText('Update failed')).toBeInTheDocument();
    const usernameInput = screen.getByDisplayValue('alice') as HTMLInputElement;
    const emailInput = screen.getByPlaceholderText('user@example.com') as HTMLInputElement;
    expect(usernameInput.value).toBe('alice');
    expect(emailInput.value).toBe('');
    expect(screen.queryByText('At least 8 characters')).not.toBeInTheDocument();

    fireEvent.change(usernameInput, { target: { value: 'alice-updated' } });
    fireEvent.change(screen.getByPlaceholderText('Enter new password'), { target: { value: 'NewPass123' } });
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });

    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();

    const passwordInput = screen.getByPlaceholderText('Enter new password') as HTMLInputElement;
    const passwordToggle = passwordInput.parentElement?.querySelector('button') as HTMLButtonElement;
    expect(passwordInput.type).toBe('password');
    fireEvent.click(passwordToggle);
    expect(passwordInput.type).toBe('text');
    fireEvent.click(passwordToggle);
    expect(passwordInput.type).toBe('password');

    const adminLabel = screen.getByText('Administrator privileges');
    fireEvent.click(adminLabel.previousElementSibling as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onUpdate).toHaveBeenCalledWith({
      username: 'alice-updated',
      password: 'NewPass123',
      email: 'alice@example.com',
      isAdmin: true,
    });

    // Backdrop click closes modal.
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();

    // Rerender with a different user to cover form reset logic.
    rerender(
      <EditUserModal
        user={buildUser({ id: 'user-2', username: 'bob', email: 'bob@example.com', isAdmin: true })}
        isUpdating={false}
        error={null}
        onClose={onClose}
        onUpdate={onUpdate}
      />
    );

    expect((screen.getByDisplayValue('bob') as HTMLInputElement).value).toBe('bob');
    expect((screen.getByPlaceholderText('user@example.com') as HTMLInputElement).value).toBe('bob@example.com');
    expect((screen.getByPlaceholderText('Enter new password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Update failed')).not.toBeInTheDocument();
  });
});
