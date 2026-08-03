import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { UsersGroups } from '../../src/components/UsersGroups';
import * as adminApi from '../../src/api/admin';

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

vi.mock('../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/components/UsersGroups/UserPanel', () => ({
  UserPanel: ({ users, onCreateUser, onEditUser, onDeleteUser }: any) => (
    <div data-testid="mock-user-panel">
      <button onClick={onCreateUser}>open-create-user</button>
      <button onClick={() => onEditUser(users[0])}>open-edit-user</button>
      <button onClick={() => onDeleteUser(users[0])}>delete-first-user</button>
    </div>
  ),
}));

vi.mock('../../src/components/UsersGroups/GroupPanel', () => ({
  GroupPanel: ({ groups, newGroup, onNewGroupChange, onCreateGroup, onEditGroup, onDeleteGroup }: any) => (
    <div data-testid="mock-group-panel">
      <span data-testid="new-group-value">{newGroup}</span>
      <button onClick={() => onNewGroupChange('   ')}>set-empty-group</button>
      <button onClick={() => onNewGroupChange(' New Group ')}>set-valid-group</button>
      <button onClick={onCreateGroup}>create-group-action</button>
      <button onClick={() => onEditGroup(groups[0])}>open-edit-group</button>
      <button onClick={() => onDeleteGroup(groups[0])}>delete-first-group</button>
    </div>
  ),
}));

vi.mock('../../src/components/UsersGroups/CreateUserModal', () => ({
  CreateUserModal: ({ isOpen, onCreate, onClose }: any) =>
    isOpen ? (
      <div data-testid="mock-create-user-modal">
        <button onClick={onClose}>close-create-user</button>
        <button
          onClick={() =>
            onCreate({
              username: '   ',
              password: 'pw',
              email: '  ',
              isAdmin: false,
            })
          }
        >
          create-user-whitespace
        </button>
        <button
          onClick={() =>
            onCreate({
              username: '  alice  ',
              password: 'pw',
              email: '  alice@example.com  ',
              isAdmin: false,
            })
          }
        >
          create-user-valid
        </button>
      </div>
    ) : null,
}));

vi.mock('../../src/components/UsersGroups/EditUserModal', () => ({
  EditUserModal: ({ user, onUpdate, onClose }: any) => (
    <div data-testid="mock-edit-user-modal">
      <span data-testid="editing-user-state">{user ? 'set' : 'empty'}</span>
      <button onClick={onClose}>close-edit-user</button>
      <button
        onClick={() =>
          onUpdate({
            username: 'ignored',
            password: '',
            email: '',
            isAdmin: false,
          })
        }
      >
        force-update-user
      </button>
      {user && (
        <>
          <button
            onClick={() =>
              onUpdate({
                username: user.username,
                password: '',
                email: user.email || '',
                isAdmin: user.isAdmin,
              })
            }
          >
            update-user-nochange
          </button>
          <button
            onClick={() =>
              onUpdate({
                username: user.username,
                password: '',
                email: '',
                isAdmin: user.isAdmin,
              })
            }
          >
            update-user-email-clear
          </button>
          <button
            onClick={() =>
              onUpdate({
                username: user.username,
                password: 'new-pass',
                email: user.email || '',
                isAdmin: !user.isAdmin,
              })
            }
          >
            update-user-admin-pass
          </button>
        </>
      )}
    </div>
  ),
}));

vi.mock('../../src/components/UsersGroups/EditGroupModal', () => ({
  EditGroupModal: ({ group, onUpdate, onClose }: any) => (
    <div data-testid="mock-edit-group-modal">
      <span data-testid="editing-group-state">{group ? 'set' : 'empty'}</span>
      <button onClick={onClose}>close-edit-group</button>
      <button
        onClick={() =>
          onUpdate({
            name: 'ignored',
            memberIds: [],
          })
        }
      >
        force-update-group
      </button>
      {group && (
        <button
          onClick={() =>
            onUpdate({
              name: 'Updated Group',
              memberIds: ['user-1', 'user-2'],
            })
          }
        >
          update-group
        </button>
      )}
    </div>
  ),
}));

describe('UsersGroups branch coverage', () => {
  const users = [
    {
      id: 'user-1',
      username: 'alpha',
      email: 'alpha@example.com',
      isAdmin: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const groups = [
    {
      id: 'group-1',
      name: 'Admins',
      members: [{ userId: 'user-1', user: { username: 'alpha' } }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getUsers).mockResolvedValue(users as any);
    vi.mocked(adminApi.getGroups).mockResolvedValue(groups as any);
    vi.mocked(adminApi.createUser).mockResolvedValue({ id: 'created-user' } as any);
    vi.mocked(adminApi.updateUser).mockResolvedValue({} as any);
    vi.mocked(adminApi.deleteUser).mockResolvedValue({ message: 'Deleted' } as any);
    vi.mocked(adminApi.createGroup).mockResolvedValue({ id: 'created-group' } as any);
    vi.mocked(adminApi.updateGroup).mockResolvedValue({} as any);
    vi.mocked(adminApi.deleteGroup).mockResolvedValue({ message: 'Deleted' } as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('covers create-user trim guard and successful trimmed payload', async () => {
    const user = userEvent.setup();
    render(<UsersGroups />);

    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('open-create-user'));
    await user.click(screen.getByText('create-user-whitespace'));
    expect(adminApi.createUser).not.toHaveBeenCalled();

    await user.click(screen.getByText('create-user-valid'));
    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith({
        username: 'alice',
        password: 'pw',
        email: 'alice@example.com',
        isAdmin: false,
      });
    });
  });

  it('covers update-user guard and selective update payload branches', async () => {
    const user = userEvent.setup();
    render(<UsersGroups />);

    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('force-update-user'));
    expect(adminApi.updateUser).not.toHaveBeenCalled();

    await user.click(screen.getByText('open-edit-user'));
    await user.click(screen.getByText('update-user-nochange'));
    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith('user-1', {});
    });

    await user.click(screen.getByText('open-edit-user'));
    await user.click(screen.getByText('update-user-email-clear'));
    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenLastCalledWith('user-1', { email: undefined });
    });

    await user.click(screen.getByText('open-edit-user'));
    await user.click(screen.getByText('update-user-admin-pass'));
    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenLastCalledWith('user-1', {
        isAdmin: false,
        password: 'new-pass',
      });
    });
  });

  it('covers edit-user email fallback compare branch when existing email is missing', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getUsers).mockResolvedValue([
      {
        ...users[0],
        email: undefined,
      },
    ] as any);

    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('open-edit-user'));
    await user.click(screen.getByText('update-user-nochange'));
    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith('user-1', {});
    });
  });

  it('keeps edit-user modal open when update fails (result null branch)', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.updateUser).mockRejectedValueOnce(new Error('update failed'));

    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('open-edit-user'));
    expect(screen.getByTestId('editing-user-state')).toHaveTextContent('set');

    await user.click(screen.getByText('update-user-admin-pass'));
    await waitFor(() => expect(adminApi.updateUser).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('editing-user-state')).toHaveTextContent('set');
  });

  it('covers create-group trim guard, failure branch, and delete-group confirm cancel', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.createGroup).mockRejectedValueOnce(new Error('group failed'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-group-panel')).toBeInTheDocument());

    await user.click(screen.getByText('set-empty-group'));
    await user.click(screen.getByText('create-group-action'));
    expect(adminApi.createGroup).not.toHaveBeenCalled();

    await user.click(screen.getByText('set-valid-group'));
    await user.click(screen.getByText('create-group-action'));
    await waitFor(() => {
      expect(adminApi.createGroup).toHaveBeenCalledWith({ name: 'New Group' });
    });

    expect(screen.getByTestId('new-group-value')).toHaveTextContent('New Group');

    await user.click(screen.getByText('delete-first-group'));
    expect(adminApi.deleteGroup).not.toHaveBeenCalled();
  });

  it('covers update-group guard and keeps edit-group state when update fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.updateGroup).mockRejectedValueOnce(new Error('update group failed'));

    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-group-panel')).toBeInTheDocument());

    await user.click(screen.getByText('force-update-group'));
    expect(adminApi.updateGroup).not.toHaveBeenCalled();

    await user.click(screen.getByText('open-edit-group'));
    expect(screen.getByTestId('editing-group-state')).toHaveTextContent('set');

    await user.click(screen.getByText('update-group'));
    await waitFor(() => {
      expect(adminApi.updateGroup).toHaveBeenCalledWith('group-1', {
        name: 'Updated Group',
        memberIds: ['user-1', 'user-2'],
      });
    });

    expect(screen.getByTestId('editing-group-state')).toHaveTextContent('set');
  });

  it('covers delete-user and delete-group API failure handlers', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.deleteUser).mockRejectedValueOnce(new Error('delete user failed'));
    vi.mocked(adminApi.deleteGroup).mockRejectedValueOnce(new Error('delete group failed'));

    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('delete-first-user'));
    await waitFor(() => expect(adminApi.deleteUser).toHaveBeenCalledWith('user-1'));

    await user.click(screen.getByText('delete-first-group'));
    await waitFor(() => expect(adminApi.deleteGroup).toHaveBeenCalledWith('group-1'));
  });

  it('covers modal close handlers for create-user, edit-user, and edit-group', async () => {
    const user = userEvent.setup();
    render(<UsersGroups />);
    await waitFor(() => expect(screen.getByTestId('mock-user-panel')).toBeInTheDocument());

    await user.click(screen.getByText('open-create-user'));
    expect(screen.getByTestId('mock-create-user-modal')).toBeInTheDocument();
    await user.click(screen.getByText('close-create-user'));
    await waitFor(() => {
      expect(screen.queryByTestId('mock-create-user-modal')).not.toBeInTheDocument();
    });

    await user.click(screen.getByText('open-edit-user'));
    expect(screen.getByTestId('editing-user-state')).toHaveTextContent('set');
    await user.click(screen.getByText('close-edit-user'));
    await waitFor(() => {
      expect(screen.getByTestId('editing-user-state')).toHaveTextContent('empty');
    });

    await user.click(screen.getByText('open-edit-group'));
    expect(screen.getByTestId('editing-group-state')).toHaveTextContent('set');
    await user.click(screen.getByText('close-edit-group'));
    await waitFor(() => {
      expect(screen.getByTestId('editing-group-state')).toHaveTextContent('empty');
    });
  });
});
