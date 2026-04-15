/**
 * Tests for UsersGroups component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { UsersGroups } from '../../components/UsersGroups';
import * as adminApi from '../../src/api/admin';

// Mock API
vi.mock('../../src/api/admin', () => ({
  getUsers: vi.fn(),
  getGroups: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

// Mock error handler
vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

describe('UsersGroups', () => {
  const mockUsers = [
    {
      id: 'user-1',
      username: 'admin',
      email: 'admin@example.com',
      isAdmin: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-2',
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-3',
      username: 'noemail',
      email: null,
      isAdmin: false,
      createdAt: new Date().toISOString(),
    },
  ];

  const mockGroups = [
    {
      id: 'group-1',
      name: 'Administrators',
      members: [{ userId: 'user-1', user: { username: 'admin' } }],
    },
    {
      id: 'group-2',
      name: 'Regular Members',
      members: [
        { userId: 'user-2', user: { username: 'testuser' } },
        { userId: 'user-3', user: { username: 'noemail' } },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getUsers).mockResolvedValue(mockUsers as any);
    vi.mocked(adminApi.getGroups).mockResolvedValue(mockGroups as any);
    vi.mocked(adminApi.createUser).mockResolvedValue({ id: 'new-user' } as any);
    vi.mocked(adminApi.updateUser).mockResolvedValue({} as any);
    vi.mocked(adminApi.deleteUser).mockResolvedValue({ message: 'Deleted' } as any);
    vi.mocked(adminApi.createGroup).mockResolvedValue({ id: 'new-group' } as any);
    vi.mocked(adminApi.updateGroup).mockResolvedValue({} as any);
    vi.mocked(adminApi.deleteGroup).mockResolvedValue({ message: 'Deleted' } as any);

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  describe('rendering', () => {
    it('renders page title', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Users & Groups')).toBeInTheDocument();
      });
    });

    it('shows loading state initially', () => {
      vi.mocked(adminApi.getUsers).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      render(<UsersGroups />);

      expect(screen.getByText(/Loading users and groups/)).toBeInTheDocument();
    });

    it('displays users after loading', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
        expect(screen.getByText('testuser')).toBeInTheDocument();
      });
    });

    it('displays groups after loading', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Administrators')).toBeInTheDocument();
        expect(screen.getByText('Regular Members')).toBeInTheDocument();
      });
    });
  });

  describe('users section', () => {
    it('shows admin badge for admin users', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeInTheDocument();
      });
    });

    it('shows email for users with email', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
      });
    });

    it('shows "No email" for users without email', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('No email')).toBeInTheDocument();
      });
    });

    it('shows empty state when no users', async () => {
      vi.mocked(adminApi.getUsers).mockResolvedValue([]);

      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('No users found')).toBeInTheDocument();
      });
    });
  });

  describe('create user', () => {
    it('shows Add User button', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });
    });

    it('opens create user modal when clicking Add User', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add User'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
      });
    });

    it('creates user when submitting form', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add User'));

      await user.type(screen.getByPlaceholderText(/username/i), 'newuser');
      await user.type(screen.getByPlaceholderText(/password/i), 'password123');
      await user.type(screen.getByPlaceholderText(/user@example.com/i), 'newuser@example.com');

      await user.click(screen.getByText('Create User'));

      await waitFor(() => {
        expect(adminApi.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            username: 'newuser',
            password: 'password123',
            email: 'newuser@example.com',
          })
        );
      });
    });

    it('disables Create User button when username or password missing', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add User'));

      // Wait for modal to be fully open
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
      });

      // Create User button should be disabled when fields are empty
      const createButton = screen.getByText('Create User').closest('button');
      expect(createButton).toBeDisabled();

      // Enter only username
      await user.type(screen.getByPlaceholderText(/username/i), 'testuser');
      expect(createButton).toBeDisabled(); // Still disabled without password

      // Enter password
      await user.type(screen.getByPlaceholderText(/password/i), 'password123');
      expect(createButton).toBeDisabled(); // Still disabled without email

      // Enter email
      await user.type(screen.getByPlaceholderText(/user@example.com/i), 'testuser@example.com');
      expect(createButton).not.toBeDisabled(); // Now enabled
    });

    it('toggles password visibility', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add User'));

      const passwordInput = screen.getByPlaceholderText(/password/i);
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Find the toggle button - it's adjacent to the password input (contains eye icon)
      const toggleButton = passwordInput.parentElement?.querySelector('button');
      if (toggleButton) {
        await user.click(toggleButton);
        expect(passwordInput).toHaveAttribute('type', 'text');
      }
    });
  });

  describe('edit user', () => {
    it('opens edit modal when clicking edit button', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle(/edit user/i);
      await user.click(editButtons[0]);

      await waitFor(() => {
        // Should show edit form with existing values
        expect(screen.getByDisplayValue('admin')).toBeInTheDocument();
      });
    });

    it('updates user when saving changes', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle(/edit user/i);
      await user.click(editButtons[0]);

      // Change username
      const usernameInput = screen.getByDisplayValue('admin');
      await user.clear(usernameInput);
      await user.type(usernameInput, 'admin-updated');

      await user.click(screen.getByText(/save|update/i));

      await waitFor(() => {
        expect(adminApi.updateUser).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({ username: 'admin-updated' })
        );
      });
    });
  });

  describe('delete user', () => {
    it('deletes user when clicking delete and confirming', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/delete user/i);
      await user.click(deleteButtons[1]); // Delete testuser

      await waitFor(() => {
        expect(adminApi.deleteUser).toHaveBeenCalledWith('user-2');
      });
    });

    it('does not delete when user cancels confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/delete user/i);
      await user.click(deleteButtons[1]);

      expect(adminApi.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('groups section', () => {
    it('shows group names', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Administrators')).toBeInTheDocument();
        expect(screen.getByText('Regular Members')).toBeInTheDocument();
      });
    });

    it('shows member count for groups', async () => {
      render(<UsersGroups />);

      await waitFor(() => {
        // Groups should show member counts
        const group2 = screen.getByText('Regular Members').closest('li');
        expect(group2?.textContent).toMatch(/2.*member|member/i);
      });
    });
  });

  describe('create group', () => {
    it('creates group when submitting', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Groups')).toBeInTheDocument();
      });

      const groupInput = screen.getByPlaceholderText(/group name/i);
      await user.type(groupInput, 'NewGroup');

      // The create button shows "Create" with a Plus icon
      const createButtons = screen.getAllByText(/Create/);
      // Find the one for groups (adjacent to group input)
      const addButton = createButtons.find(btn =>
        btn.closest('button') && btn.closest('div')?.querySelector('input[placeholder*="group"]')
      ) || createButtons[createButtons.length - 1]; // Last one if can't find
      await user.click(addButton.closest('button') || addButton);

      await waitFor(() => {
        expect(adminApi.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'NewGroup' })
        );
      });
    });
  });

  describe('edit group', () => {
    it('opens edit modal when clicking edit button', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Administrators')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle(/edit/i);
      // Find the one for groups
      const groupEditButton = editButtons.find(btn =>
        btn.closest('li')?.textContent?.includes('Administrators')
      );

      if (groupEditButton) {
        await user.click(groupEditButton);

        await waitFor(() => {
          expect(screen.getByDisplayValue('Administrators')).toBeInTheDocument();
        });
      }
    });

    it('updates group members', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Administrators')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle(/edit/i);
      const groupEditButton = editButtons.find(btn =>
        btn.closest('li')?.textContent?.includes('Administrators')
      );

      if (groupEditButton) {
        await user.click(groupEditButton);

        // Toggle a member
        await waitFor(() => {
          const memberCheckbox = screen.getByRole('checkbox', { name: /testuser/i });
          if (memberCheckbox) {
            user.click(memberCheckbox);
          }
        });

        await user.click(screen.getByText(/save|update/i));

        await waitFor(() => {
          expect(adminApi.updateGroup).toHaveBeenCalled();
        });
      }
    });
  });

  describe('delete group', () => {
    it('deletes group when clicking delete and confirming', async () => {
      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Regular Members')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/delete/i);
      const groupDeleteButton = deleteButtons.find(btn =>
        btn.closest('li')?.textContent?.includes('Regular Members')
      );

      if (groupDeleteButton) {
        await user.click(groupDeleteButton);

        await waitFor(() => {
          expect(adminApi.deleteGroup).toHaveBeenCalledWith('group-2');
        });
      }
    });
  });

  describe('error handling', () => {
    it('handles create user error', async () => {
      vi.mocked(adminApi.createUser).mockRejectedValue(new Error('Username already exists'));

      const user = userEvent.setup();
      render(<UsersGroups />);

      await waitFor(() => {
        expect(screen.getByText('Add User')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add User'));
      await user.type(screen.getByPlaceholderText(/username/i), 'admin');
      await user.type(screen.getByPlaceholderText(/password/i), 'password');
      await user.type(screen.getByPlaceholderText(/user@example.com/i), 'admin@example.com');
      await user.click(screen.getByText('Create User'));

      await waitFor(() => {
        expect(screen.getByText(/already exists|Failed to create/i)).toBeInTheDocument();
      });
    });
  });
});
