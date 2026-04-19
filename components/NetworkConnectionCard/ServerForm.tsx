import React from 'react';
import type { NetworkColors, PresetServer, NewServerState } from './types';
import { ServerFormActions } from './ServerForm/ServerFormActions';
import { ServerFields } from './ServerForm/ServerFields';

interface ServerFormProps {
  editingServerId: string | null;
  newServer: NewServerState;
  serverActionLoading: string | null;
  colors: NetworkColors;
  presets: PresetServer[];
  onSetNewServer: (server: NewServerState) => void;
  onAddPreset: (preset: PresetServer) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export const ServerForm: React.FC<ServerFormProps> = ({
  editingServerId,
  newServer,
  serverActionLoading,
  colors,
  presets,
  onSetNewServer,
  onAddPreset,
  onCancel,
  onSubmit,
}) => {
  const isSubmitting = serverActionLoading === 'add' || (!!editingServerId && serverActionLoading === editingServerId);
  const submitDisabled = !newServer.label || !newServer.host || isSubmitting;

  return (
    <div className="mt-3 p-4 surface-muted rounded-lg space-y-3">
      <div className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        {editingServerId ? 'Edit Server' : 'Add New Server'}
      </div>
      <ServerFields
        newServer={newServer}
        colors={colors}
        onSetNewServer={onSetNewServer}
      />
      <ServerFormActions
        editingServerId={editingServerId}
        isSubmitting={isSubmitting}
        submitDisabled={submitDisabled}
        presets={presets}
        onAddPreset={onAddPreset}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  );
};
