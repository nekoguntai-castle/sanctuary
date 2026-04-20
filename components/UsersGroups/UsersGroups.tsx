import React from 'react';
import { UsersGroupsLoadedView } from './UsersGroupsLoadedView';
import { useUsersGroupsController } from './useUsersGroupsController';

export const UsersGroups: React.FC = () => {
  const controller = useUsersGroupsController();

  if (controller.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading users and groups...</div>;
  }

  return <UsersGroupsLoadedView controller={controller} />;
};
