import React from 'react';
import { CreateUserModal } from './CreateUserModal';
import { EditGroupModal } from './EditGroupModal';
import { EditUserModal } from './EditUserModal';
import { GroupPanel } from './GroupPanel';
import { UserPanel } from './UserPanel';
import type { UsersGroupsController } from './useUsersGroupsController';

interface UsersGroupsLoadedViewProps {
  controller: UsersGroupsController;
}

export const UsersGroupsLoadedView: React.FC<UsersGroupsLoadedViewProps> = ({
  controller,
}) => (
  <div className="space-y-8 animate-fade-in pb-12">
    <div>
      <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
        Users & Groups
      </h2>
      <p className="text-sanctuary-500">Manage system users and groups</p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <UserPanel
        users={controller.users}
        onCreateUser={controller.openCreateUser}
        onEditUser={controller.handleEditUser}
        onDeleteUser={controller.handleDeleteUser}
      />

      <GroupPanel
        groups={controller.groups}
        newGroup={controller.newGroup}
        isCreatingGroup={controller.isCreatingGroup}
        onNewGroupChange={controller.setNewGroup}
        onCreateGroup={controller.handleCreateGroup}
        onEditGroup={controller.handleEditGroup}
        onDeleteGroup={controller.handleDeleteGroup}
      />
    </div>

    <CreateUserModal
      isOpen={controller.showCreateUser}
      isCreating={controller.isCreatingUser}
      error={controller.createUserError}
      onClose={controller.closeCreateUser}
      onCreate={controller.handleCreateUser}
    />

    <EditUserModal
      user={controller.editingUser}
      isUpdating={controller.isUpdatingUser}
      error={controller.editUserError}
      onClose={controller.closeEditUser}
      onUpdate={controller.handleUpdateUser}
    />

    <EditGroupModal
      group={controller.editingGroup}
      users={controller.users}
      isUpdating={controller.isUpdatingGroup}
      error={controller.editGroupError}
      onClose={controller.closeEditGroup}
      onUpdate={controller.handleUpdateGroup}
    />
  </div>
);
