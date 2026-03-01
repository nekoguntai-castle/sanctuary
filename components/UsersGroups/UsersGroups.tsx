import React, { useState, useEffect } from 'react';
import * as adminApi from '../../src/api/admin';
import { AdminUser, AdminGroup } from '../../src/api/admin';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';
import { UserPanel } from './UserPanel';
import { GroupPanel } from './GroupPanel';
import { CreateUserModal } from './CreateUserModal';
import { EditUserModal } from './EditUserModal';
import { EditGroupModal } from './EditGroupModal';

const log = createLogger('UsersGroups');

export const UsersGroups: React.FC = () => {
  const { handleError } = useErrorHandler();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);

  // Loading states using hook
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isCreatingUser, error: createUserError, execute: runCreateUser, clearError: clearCreateUserError } = useLoadingState();
  const { loading: isUpdatingUser, error: editUserError, execute: runUpdateUser, clearError: clearEditUserError } = useLoadingState();
  const { loading: isCreatingGroup, execute: runCreateGroup } = useLoadingState();
  const { loading: isUpdatingGroup, error: editGroupError, execute: runUpdateGroup, clearError: clearEditGroupError } = useLoadingState();

  // Modal visibility state
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);

  // Create Group State
  const [newGroup, setNewGroup] = useState('');

  const loadData = () => runLoad(async () => {
    const [usersData, groupsData] = await Promise.all([
      adminApi.getUsers(),
      adminApi.getGroups()
    ]);
    setUsers(usersData);
    setGroups(groupsData);
  });

  useEffect(() => {
    loadData();
  }, []);

  // User CRUD handlers
  const handleCreateUser = async (data: { username: string; password: string; email: string; isAdmin: boolean }) => {
    if (!data.username.trim() || !data.password.trim()) return;

    const result = await runCreateUser(async () => {
      await adminApi.createUser({
        username: data.username.trim(),
        password: data.password,
        email: data.email.trim() || undefined,
        isAdmin: data.isAdmin
      });
    });

    if (result !== null) {
      setShowCreateUser(false);
      loadData();
    }
  };

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user);
    clearEditUserError();
  };

  const handleUpdateUser = async (data: { username: string; password: string; email: string; isAdmin: boolean }) => {
    if (!editingUser) return;

    const updateData: adminApi.UpdateUserRequest = {};

    if (data.username !== editingUser.username) {
      updateData.username = data.username;
    }
    if (data.email !== (editingUser.email || '')) {
      updateData.email = data.email || undefined;
    }
    if (data.isAdmin !== editingUser.isAdmin) {
      updateData.isAdmin = data.isAdmin;
    }
    if (data.password) {
      updateData.password = data.password;
    }

    const result = await runUpdateUser(async () => {
      await adminApi.updateUser(editingUser.id, updateData);
    });

    if (result !== null) {
      setEditingUser(null);
      loadData();
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteUser(user.id);
      loadData();
    } catch (error) {
      log.error('Delete user error', { error });
      handleError(error, 'Delete User Failed');
    }
  };

  // Group CRUD handlers
  const handleCreateGroup = async () => {
    if (!newGroup.trim()) return;

    const result = await runCreateGroup(async () => {
      await adminApi.createGroup({ name: newGroup.trim() });
    });

    if (result !== null) {
      setNewGroup('');
      loadData();
    }
  };

  const handleDeleteGroup = async (group: AdminGroup) => {
    if (!confirm(`Are you sure you want to delete group "${group.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteGroup(group.id);
      loadData();
    } catch (error) {
      log.error('Delete group error', { error });
      handleError(error, 'Delete Group Failed');
    }
  };

  const handleEditGroup = (group: AdminGroup) => {
    setEditingGroup(group);
    clearEditGroupError();
  };

  const handleUpdateGroup = async (data: { name: string; memberIds: string[] }) => {
    if (!editingGroup) return;

    const result = await runUpdateGroup(async () => {
      await adminApi.updateGroup(editingGroup.id, {
        name: data.name,
        memberIds: data.memberIds,
      });
    });

    if (result !== null) {
      setEditingGroup(null);
      loadData();
    }
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading users and groups...</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Users & Groups</h2>
        <p className="text-sanctuary-500">Manage system users and groups</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <UserPanel
          users={users}
          onCreateUser={() => { setShowCreateUser(true); clearCreateUserError(); }}
          onEditUser={handleEditUser}
          onDeleteUser={handleDeleteUser}
        />

        <GroupPanel
          groups={groups}
          newGroup={newGroup}
          isCreatingGroup={isCreatingGroup}
          onNewGroupChange={setNewGroup}
          onCreateGroup={handleCreateGroup}
          onEditGroup={handleEditGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </div>

      <CreateUserModal
        isOpen={showCreateUser}
        isCreating={isCreatingUser}
        error={createUserError}
        onClose={() => setShowCreateUser(false)}
        onCreate={handleCreateUser}
      />

      <EditUserModal
        user={editingUser}
        isUpdating={isUpdatingUser}
        error={editUserError}
        onClose={() => setEditingUser(null)}
        onUpdate={handleUpdateUser}
      />

      <EditGroupModal
        group={editingGroup}
        users={users}
        isUpdating={isUpdatingGroup}
        error={editGroupError}
        onClose={() => setEditingGroup(null)}
        onUpdate={handleUpdateGroup}
      />
    </div>
  );
};
