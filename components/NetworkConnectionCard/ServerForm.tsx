import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import type { NetworkColors, PresetServer, NewServerState } from './types';

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
}) => (
  <div className="mt-3 p-4 surface-muted rounded-xl space-y-3">
    <div className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
      {editingServerId ? 'Edit Server' : 'Add New Server'}
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Label</label>
        <input
          type="text"
          value={newServer.label}
          onChange={(e) => onSetNewServer({ ...newServer, label: e.target.value })}
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
          placeholder="My Server"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
        <input
          type="text"
          value={newServer.host}
          onChange={(e) => onSetNewServer({ ...newServer, host: e.target.value })}
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
          placeholder="electrum.example.com"
        />
      </div>
      <div className="flex space-x-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
          <input
            type="number"
            value={newServer.port}
            onChange={(e) => onSetNewServer({ ...newServer, port: parseInt(e.target.value, 10) || 50002 })}
            className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">SSL</label>
          <button
            onClick={() => onSetNewServer({ ...newServer, useSsl: !newServer.useSsl })}
            className={`px-3 py-2 rounded-lg text-sm ${
              newServer.useSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
            }`}
          >
            {newServer.useSsl ? 'SSL' : 'TCP'}
          </button>
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onAddPreset(preset)}
            className="px-2 py-1 text-xs rounded bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500 hover:bg-sanctuary-200"
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="flex space-x-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!newServer.label || !newServer.host || serverActionLoading === 'add' || serverActionLoading === editingServerId}
        >
          {(serverActionLoading === 'add' || serverActionLoading === editingServerId) ? (
            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> {editingServerId ? 'Updating' : 'Adding'}</>
          ) : (
            editingServerId ? 'Update Server' : 'Add Server'
          )}
        </Button>
      </div>
    </div>
  </div>
);
