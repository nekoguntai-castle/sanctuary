import React from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { UsersGroupsLoadedView } from './UsersGroupsLoadedView';
import { useUsersGroupsController } from './useUsersGroupsController';

export const UsersGroups: React.FC = () => {
  const controller = useUsersGroupsController();

  if (controller.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading users and groups...</div>;
  }

  if (controller.loadError !== null) {
    return (
      <div className="space-y-4">
        <ErrorAlert message={`Failed to load users and groups: ${controller.loadError}`} />
        <Button variant="secondary" onClick={() => { void controller.retryLoad(); }}>Retry</Button>
      </div>
    );
  }

  return <UsersGroupsLoadedView controller={controller} />;
};
