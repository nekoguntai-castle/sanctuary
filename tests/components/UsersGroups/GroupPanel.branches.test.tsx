import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GroupPanel } from '../../../components/UsersGroups/GroupPanel';
import type { AdminGroup } from '../../../src/api/admin';

const makeGroup = (overrides: Partial<AdminGroup> = {}): AdminGroup => ({
  id: 'group-1',
  name: 'Operators',
  description: null,
  purpose: null,
  createdAt: '2026-03-02T00:00:00.000Z',
  members: [],
  ...overrides,
});

const renderPanel = (overrides: Partial<React.ComponentProps<typeof GroupPanel>> = {}) => {
  const onNewGroupChange = vi.fn();
  const onCreateGroup = vi.fn();
  const onEditGroup = vi.fn();
  const onDeleteGroup = vi.fn();

  const view = render(
    <GroupPanel
      groups={[]}
      newGroup=""
      isCreatingGroup={false}
      onNewGroupChange={onNewGroupChange}
      onCreateGroup={onCreateGroup}
      onEditGroup={onEditGroup}
      onDeleteGroup={onDeleteGroup}
      {...overrides}
    />
  );

  return { ...view, onNewGroupChange, onCreateGroup, onEditGroup, onDeleteGroup };
};

describe('GroupPanel branch coverage', () => {
  it('covers create-button disabled states, change handling, and enter-submit path', () => {
    const { onCreateGroup, onNewGroupChange, rerender } = renderPanel({ newGroup: '' });

    const input = screen.getByPlaceholderText('New group name');
    const createButton = screen.getByRole('button', { name: /Create/ });

    expect(createButton).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Ops' } });
    expect(onNewGroupChange).toHaveBeenCalledWith('Ops');

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCreateGroup).toHaveBeenCalledTimes(1);

    rerender(
      <GroupPanel
        groups={[]}
        newGroup="Ops"
        isCreatingGroup={true}
        onNewGroupChange={onNewGroupChange}
        onCreateGroup={onCreateGroup}
        onEditGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();

    rerender(
      <GroupPanel
        groups={[]}
        newGroup="Ops"
        isCreatingGroup={false}
        onNewGroupChange={onNewGroupChange}
        onCreateGroup={onCreateGroup}
        onEditGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
      />
    );

    const enabledCreateButton = screen.getByRole('button', { name: /Create/ });
    expect(enabledCreateButton).not.toBeDisabled();

    fireEvent.click(enabledCreateButton);
    expect(onCreateGroup).toHaveBeenCalledTimes(2);
  });

  it('covers empty state and member/admin rendering branches with edit/delete actions', () => {
    const groups: AdminGroup[] = [
      makeGroup({ id: 'group-empty', name: 'Empty Group', members: [] }),
      makeGroup({
        id: 'group-members',
        name: 'Core Team',
        members: [
          { userId: 'u-admin', username: 'alice', role: 'admin' },
          { userId: 'u-user', username: 'bob', role: 'member' },
        ],
      }),
    ];

    const { onEditGroup, onDeleteGroup, rerender } = renderPanel({ groups });

    expect(screen.getByText('No members')).toBeInTheDocument();
    expect(screen.getByText('alice (admin)')).toBeInTheDocument();
    expect(screen.getByText(/^bob/)).toBeInTheDocument();
    expect(screen.queryByText('bob (admin)')).not.toBeInTheDocument();

    const editButtons = screen.getAllByTitle('Edit group');
    const deleteButtons = screen.getAllByTitle('Delete group');

    fireEvent.click(editButtons[0]);
    fireEvent.click(deleteButtons[1]);

    expect(onEditGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-empty' }));
    expect(onDeleteGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-members' }));

    rerender(
      <GroupPanel
        groups={[]}
        newGroup=""
        isCreatingGroup={false}
        onNewGroupChange={vi.fn()}
        onCreateGroup={vi.fn()}
        onEditGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
      />
    );

    expect(screen.getByText('No groups found')).toBeInTheDocument();
  });
});
