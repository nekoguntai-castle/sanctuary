import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { EditGroupModal } from '../../../src/components/UsersGroups/EditGroupModal';

const baseGroup = {
  id: 'group-1',
  name: 'Operators',
  description: null,
  purpose: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [{ userId: 'u1', username: 'alice', role: 'member' }],
};

const users = [
  {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    isAdmin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'u2',
    username: 'bob',
    email: 'bob@example.com',
    isAdmin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('EditGroupModal branch coverage', () => {
  it('returns null when group is not provided', () => {
    const { container } = render(
      <EditGroupModal
        group={null}
        users={users as any}
        isUpdating={false}
        error={null}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('covers error + empty-users branch', () => {
    render(
      <EditGroupModal
        group={baseGroup as any}
        users={[]}
        isUpdating={false}
        error="Unable to update"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('Unable to update')).toBeInTheDocument();
    expect(screen.getByText('No users available')).toBeInTheDocument();
  });

  it('covers group name editing and toggleMember remove/add paths', () => {
    const onUpdate = vi.fn();
    render(
      <EditGroupModal
        group={baseGroup as any}
        users={users as any}
        isUpdating={false}
        error={null}
        onClose={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Operators'), {
      target: { value: 'Operators Updated' },
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // remove existing member (u1)
    fireEvent.click(checkboxes[1]); // add new member (u2)

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onUpdate).toHaveBeenCalledWith({
      name: 'Operators Updated',
      memberIds: ['u2'],
    });
  });
});
