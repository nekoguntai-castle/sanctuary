import React from 'react';
import {
  Plus,
  Server,
  ChevronRight,
  Settings2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ElectrumServer } from '../../types';
import type { NetworkColors, PresetServer, NewServerState } from './types';
import { ServerRow } from './ServerRow';
import { ServerForm } from './ServerForm';
import * as bitcoinApi from '../../src/api/bitcoin';

interface PoolConfigProps {
  servers: ElectrumServer[];
  poolStats?: bitcoinApi.PoolStats | null;
  colors: NetworkColors;
  presets: PresetServer[];
  showAdvanced: boolean;
  isAddingServer: boolean;
  editingServerId: string | null;
  newServer: NewServerState;
  serverActionLoading: string | null;
  serverTestStatus: Record<string, 'idle' | 'testing' | 'success' | 'error'>;
  poolMin: number;
  poolMax: number;
  poolLoadBalancing: string;
  onToggleAdvanced: () => void;
  onUpdateConfig: (field: string, value: unknown) => void;
  onSetIsAddingServer: (value: boolean) => void;
  onSetEditingServerId: (id: string | null) => void;
  onSetNewServer: (server: NewServerState) => void;
  onTestServer: (server: ElectrumServer) => void;
  onToggleServer: (server: ElectrumServer) => void;
  onMoveServer: (serverId: string, direction: 'up' | 'down') => void;
  onEditServer: (server: ElectrumServer) => void;
  onDeleteServer: (serverId: string) => void;
  onAddPreset: (preset: PresetServer) => void;
  onAddServer: () => void;
  onUpdateServer: () => void;
  onCancelEdit: () => void;
  getDefaultPort: () => number;
  getServerPoolStats: (serverId: string) => bitcoinApi.ServerStats | undefined;
}

export const PoolConfig: React.FC<PoolConfigProps> = ({
  servers,
  colors,
  presets,
  showAdvanced,
  isAddingServer,
  editingServerId,
  newServer,
  serverActionLoading,
  serverTestStatus,
  poolMin,
  poolMax,
  poolLoadBalancing,
  onToggleAdvanced,
  onUpdateConfig,
  onSetIsAddingServer,
  onSetEditingServerId,
  onSetNewServer,
  onTestServer,
  onToggleServer,
  onMoveServer,
  onEditServer,
  onDeleteServer,
  onAddPreset,
  onAddServer,
  onUpdateServer,
  onCancelEdit,
  getDefaultPort,
  getServerPoolStats,
}) => (
  <div className="space-y-4">
    {/* Advanced Pool Settings Toggle */}
    <button
      onClick={onToggleAdvanced}
      className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-800 dark:hover:text-sanctuary-200"
    >
      <Settings2 className="w-4 h-4" />
      <span>Advanced Settings</span>
      <ChevronRight className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
    </button>

    {/* Pool Settings (hidden by default) */}
    {showAdvanced && (
      <div className="p-4 surface-muted rounded-lg">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Min Connections</label>
            <Input
              type="number"
              value={poolMin}
              onChange={(e) => onUpdateConfig('poolMin', parseInt(e.target.value, 10) || 1)}
              min={1}
              max={poolMax}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Max Connections</label>
            <Input
              type="number"
              value={poolMax}
              onChange={(e) => onUpdateConfig('poolMax', parseInt(e.target.value, 10) || 5)}
              min={poolMin}
              max={20}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Strategy</label>
            <select
              value={poolLoadBalancing}
              onChange={(e) => onUpdateConfig('poolLoadBalancing', e.target.value)}
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm"
            >
              <option value="round_robin">Round Robin</option>
              <option value="least_connections">Least Connections</option>
              <option value="failover_only">Failover Only</option>
            </select>
          </div>
        </div>
      </div>
    )}

    {/* Server List */}
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Pool Servers ({servers.length})
        </label>
        <Button variant="secondary" size="sm" onClick={() => {
          onSetEditingServerId(null);
          onSetNewServer({ label: '', host: '', port: getDefaultPort(), useSsl: true });
          onSetIsAddingServer(true);
        }}>
          <Plus className="w-4 h-4 mr-1" /> Add Server
        </Button>
      </div>

      {servers.length === 0 && !isAddingServer && (
        <div className="p-4 text-center text-sanctuary-500 surface-muted rounded-lg">
          <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No servers configured</p>
          <div className="flex flex-wrap justify-center gap-2 mt-3">
            {presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => onAddPreset(preset)}
                className="px-2 py-1 text-xs rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700"
              >
                + {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {servers.length > 0 && (
        <div className="space-y-2">
          {servers.map((server, index) => (
            <ServerRow
              key={server.id}
              server={server}
              index={index}
              totalServers={servers.length}
              serverTestStatus={serverTestStatus[server.id] || 'idle'}
              serverActionLoading={serverActionLoading}
              serverPoolStats={getServerPoolStats(server.id)}
              onTestServer={onTestServer}
              onToggleServer={onToggleServer}
              onMoveServer={onMoveServer}
              onEditServer={onEditServer}
              onDeleteServer={onDeleteServer}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Server Form */}
      {isAddingServer && (
        <ServerForm
          editingServerId={editingServerId}
          newServer={newServer}
          serverActionLoading={serverActionLoading}
          colors={colors}
          presets={presets}
          onSetNewServer={onSetNewServer}
          onAddPreset={onAddPreset}
          onCancel={onCancelEdit}
          onSubmit={editingServerId ? onUpdateServer : onAddServer}
        />
      )}
    </div>
  </div>
);
