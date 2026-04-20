import { useCallback, useEffect, useState } from 'react';
import * as adminApi from '../../src/api/admin';
import type { AdminGroup, AdminUser } from '../../src/api/admin';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';

const log = createLogger('UsersGroups');

interface UserFormData {
  username: string;
  password: string;
  email: string;
  isAdmin: boolean;
}

interface GroupFormData {
  name: string;
  memberIds: string[];
}

export const useUsersGroupsController = () => {
  const { handleError } = useErrorHandler();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);
  const [newGroup, setNewGroup] = useState('');

  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const {
    loading: isCreatingUser,
    error: createUserError,
    execute: runCreateUser,
    clearError: clearCreateUserError,
  } = useLoadingState();
  const {
    loading: isUpdatingUser,
    error: editUserError,
    execute: runUpdateUser,
    clearError: clearEditUserError,
  } = useLoadingState();
  const { loading: isCreatingGroup, execute: runCreateGroup } = useLoadingState();
  const {
    loading: isUpdatingGroup,
    error: editGroupError,
    execute: runUpdateGroup,
    clearError: clearEditGroupError,
  } = useLoadingState();

  const loadData = useCallback(
    () =>
      runLoad(async () => {
        const [usersData, groupsData] = await Promise.all([
          adminApi.getUsers(),
          adminApi.getGroups(),
        ]);
        setUsers(usersData);
        setGroups(groupsData);
      }),
    [runLoad]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateUser = useCallback(() => {
    setShowCreateUser(true);
    clearCreateUserError();
  }, [clearCreateUserError]);

  const closeCreateUser = useCallback(() => {
    setShowCreateUser(false);
  }, []);

  const handleCreateUser = useCallback(
    async (data: UserFormData) => {
      if (!data.username.trim() || !data.password.trim() || !data.email.trim()) return;

      const result = await runCreateUser(async () => {
        await adminApi.createUser({
          username: data.username.trim(),
          password: data.password,
          email: data.email.trim(),
          isAdmin: data.isAdmin,
        });
      });

      if (result !== null) {
        setShowCreateUser(false);
        loadData();
      }
    },
    [loadData, runCreateUser]
  );

  const handleEditUser = useCallback(
    (user: AdminUser) => {
      setEditingUser(user);
      clearEditUserError();
    },
    [clearEditUserError]
  );

  const closeEditUser = useCallback(() => {
    setEditingUser(null);
  }, []);

  const handleUpdateUser = useCallback(
    async (data: UserFormData) => {
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
    },
    [editingUser, loadData, runUpdateUser]
  );

  const handleDeleteUser = useCallback(
    async (user: AdminUser) => {
      if (!window.confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
        return;
      }

      try {
        await adminApi.deleteUser(user.id);
        loadData();
      } catch (error) {
        log.error('Delete user error', { error });
        handleError(error, 'Delete User Failed');
      }
    },
    [handleError, loadData]
  );

  const handleCreateGroup = useCallback(async () => {
    if (!newGroup.trim()) return;

    const result = await runCreateGroup(async () => {
      await adminApi.createGroup({ name: newGroup.trim() });
    });

    if (result !== null) {
      setNewGroup('');
      loadData();
    }
  }, [loadData, newGroup, runCreateGroup]);

  const handleEditGroup = useCallback(
    (group: AdminGroup) => {
      setEditingGroup(group);
      clearEditGroupError();
    },
    [clearEditGroupError]
  );

  const closeEditGroup = useCallback(() => {
    setEditingGroup(null);
  }, []);

  const handleUpdateGroup = useCallback(
    async (data: GroupFormData) => {
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
    },
    [editingGroup, loadData, runUpdateGroup]
  );

  const handleDeleteGroup = useCallback(
    async (group: AdminGroup) => {
      if (!window.confirm(`Are you sure you want to delete group "${group.name}"? This action cannot be undone.`)) {
        return;
      }

      try {
        await adminApi.deleteGroup(group.id);
        loadData();
      } catch (error) {
        log.error('Delete group error', { error });
        handleError(error, 'Delete Group Failed');
      }
    },
    [handleError, loadData]
  );

  return {
    users,
    groups,
    loading,
    showCreateUser,
    editingUser,
    editingGroup,
    newGroup,
    isCreatingUser,
    createUserError,
    isUpdatingUser,
    editUserError,
    isCreatingGroup,
    isUpdatingGroup,
    editGroupError,
    setNewGroup,
    openCreateUser,
    closeCreateUser,
    handleCreateUser,
    handleEditUser,
    closeEditUser,
    handleUpdateUser,
    handleDeleteUser,
    handleCreateGroup,
    handleEditGroup,
    closeEditGroup,
    handleUpdateGroup,
    handleDeleteGroup,
  };
};

export type UsersGroupsController = ReturnType<typeof useUsersGroupsController>;
