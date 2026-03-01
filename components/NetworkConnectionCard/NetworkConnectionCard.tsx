import React, { useState } from 'react';
import { ElectrumServer } from '../../types';
import {
  Radio,
  Layers,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import type { NetworkConnectionCardProps, NewServerState, PresetServer } from './types';
import { NETWORK_COLORS, PRESET_SERVERS } from './constants';
import {
  getDefaultPort,
  getNetworkEnabled,
  getNetworkMode,
  getNetworkSingletonHost,
  getNetworkSingletonPort,
  getNetworkSingletonSsl,
  getNetworkPoolMin,
  getNetworkPoolMax,
  getNetworkPoolLoadBalancing,
} from './networkConfigHelpers';
import { SingletonConfig } from './SingletonConfig';
import { PoolConfig } from './PoolConfig';

const log = createLogger('NetworkConnectionCard');

export const NetworkConnectionCard: React.FC<NetworkConnectionCardProps> = ({
  network,
  config,
  servers,
  poolStats,
  onConfigChange,
  onServersChange,
  onTestConnection,
}) => {
  // Get pool stats for a specific server by ID
  const getServerPoolStats = (serverId: string): bitcoinApi.ServerStats | undefined => {
    return poolStats?.servers?.find(s => s.serverId === serverId);
  };
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServer, setNewServer] = useState<NewServerState>({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const colors = NETWORK_COLORS[network];
  const presets = PRESET_SERVERS[network];

  // Get network-specific config values
  const isEnabled = network === 'mainnet' ? true : getNetworkEnabled(network, config);
  const mode = getNetworkMode(network, config);
  const singletonHost = getNetworkSingletonHost(network, config);
  const singletonPort = getNetworkSingletonPort(network, config);
  const singletonSsl = getNetworkSingletonSsl(network, config);
  const poolMin = getNetworkPoolMin(network, config);
  const poolMax = getNetworkPoolMax(network, config);
  const poolLoadBalancing = getNetworkPoolLoadBalancing(network, config);

  const updateNetworkConfig = (field: string, value: unknown) => {
    const prefix = network;
    const fieldMap: Record<string, string> = {
      enabled: `${prefix}Enabled`,
      mode: `${prefix}Mode`,
      singletonHost: `${prefix}SingletonHost`,
      singletonPort: `${prefix}SingletonPort`,
      singletonSsl: `${prefix}SingletonSsl`,
      poolMin: `${prefix}PoolMin`,
      poolMax: `${prefix}PoolMax`,
      poolLoadBalancing: `${prefix}PoolLoadBalancing`,
    };
    onConfigChange({ [fieldMap[field]]: value });
  };

  const handleTestSingleton = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await onTestConnection(singletonHost, singletonPort, singletonSsl);
      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (error) {
      setTestStatus('error');
      setTestMessage(extractErrorMessage(error, 'Connection failed'));
    }
  };

  const handleTestServer = async (server: ElectrumServer) => {
    setServerTestStatus(prev => ({ ...prev, [server.id]: 'testing' }));
    try {
      const result = await onTestConnection(server.host, server.port, server.useSsl);
      const status = result.success ? 'success' : 'error';
      setServerTestStatus(prev => ({ ...prev, [server.id]: status }));
      // Auto-clear status after 5 seconds
      setTimeout(() => {
        setServerTestStatus(prev => ({ ...prev, [server.id]: 'idle' }));
      }, 5000);
    } catch {
      setServerTestStatus(prev => ({ ...prev, [server.id]: 'error' }));
      // Auto-clear error status after 5 seconds
      setTimeout(() => {
        setServerTestStatus(prev => ({ ...prev, [server.id]: 'idle' }));
      }, 5000);
    }
  };

  const handleAddServer = async () => {
    if (!newServer.label || !newServer.host) return;
    setServerActionLoading('add');
    try {
      const server = await adminApi.addElectrumServer({
        ...newServer,
        network,
        enabled: true,
        priority: servers.length + 1,
      });
      onServersChange([...servers, server]);
      setNewServer({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
      setIsAddingServer(false);
    } catch (error) {
      log.error('Failed to add server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleUpdateServer = async () => {
    if (!editingServerId || !newServer.label || !newServer.host) return;
    setServerActionLoading(editingServerId);
    try {
      const updatedServer = await adminApi.updateElectrumServer(editingServerId, newServer);
      onServersChange(servers.map(s => s.id === editingServerId ? updatedServer : s));
      setNewServer({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
      setEditingServerId(null);
      setIsAddingServer(false);
    } catch (error) {
      log.error('Failed to update server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleEditServer = (server: ElectrumServer) => {
    setEditingServerId(server.id);
    setNewServer({
      label: server.label,
      host: server.host,
      port: server.port,
      useSsl: server.useSsl,
    });
    setIsAddingServer(true);
  };

  const handleDeleteServer = async (serverId: string) => {
    setServerActionLoading(serverId);
    try {
      await adminApi.deleteElectrumServer(serverId);
      onServersChange(servers.filter(s => s.id !== serverId));
    } catch (error) {
      log.error('Failed to delete server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleToggleServer = async (server: ElectrumServer) => {
    setServerActionLoading(server.id);
    try {
      await adminApi.updateElectrumServer(server.id, { enabled: !server.enabled });
      onServersChange(servers.map(s => s.id === server.id ? { ...s, enabled: !s.enabled } : s));
    } catch (error) {
      log.error('Failed to toggle server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleMoveServer = async (serverId: string, direction: 'up' | 'down') => {
    const index = servers.findIndex(s => s.id === serverId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === servers.length - 1) return;

    const newServers = [...servers];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

    // Update priorities
    const reordered = newServers.map((s, i) => ({ ...s, priority: i }));
    onServersChange(reordered);

    try {
      await adminApi.reorderElectrumServers(reordered.map(s => s.id));
    } catch (error) {
      log.error('Failed to reorder servers', { error });
    }
  };

  const handleAddPreset = (preset: PresetServer) => {
    setNewServer({
      label: preset.name,
      host: preset.host,
      port: preset.port,
      useSsl: preset.useSsl,
    });
    setIsAddingServer(true);
  };

  const handleCancelEdit = () => {
    setIsAddingServer(false);
    setEditingServerId(null);
    setNewServer({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
  };

  return (
      <div className="space-y-6">
        {/* Mode Selector */}
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">Connection Mode</label>
          <div className="flex space-x-3">
            <button
              onClick={() => updateNetworkConfig('mode', 'singleton')}
              className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                mode === 'singleton'
                  ? `${colors.border} ${colors.bg}`
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Radio className={`w-4 h-4 ${mode === 'singleton' ? colors.text : 'text-sanctuary-400'}`} />
                <span className={`font-medium ${mode === 'singleton' ? colors.text : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                  Singleton
                </span>
              </div>
              <p className="text-xs text-sanctuary-500 mt-1 text-left">Single server connection</p>
            </button>
            <button
              onClick={() => updateNetworkConfig('mode', 'pool')}
              className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                mode === 'pool'
                  ? `${colors.border} ${colors.bg}`
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Layers className={`w-4 h-4 ${mode === 'pool' ? colors.text : 'text-sanctuary-400'}`} />
                <span className={`font-medium ${mode === 'pool' ? colors.text : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                  Pool
                </span>
              </div>
              <p className="text-xs text-sanctuary-500 mt-1 text-left">Multi-server with failover</p>
            </button>
          </div>
        </div>

        {/* Singleton Config */}
        {mode === 'singleton' && (
          <SingletonConfig
            singletonHost={singletonHost}
            singletonPort={singletonPort}
            singletonSsl={singletonSsl}
            colors={colors}
            presets={presets}
            testStatus={testStatus}
            testMessage={testMessage}
            onUpdateConfig={updateNetworkConfig}
            onTestSingleton={handleTestSingleton}
          />
        )}

        {/* Pool Config */}
        {mode === 'pool' && (
          <PoolConfig
            servers={servers}
            poolStats={poolStats}
            colors={colors}
            presets={presets}
            showAdvanced={showAdvanced}
            isAddingServer={isAddingServer}
            editingServerId={editingServerId}
            newServer={newServer}
            serverActionLoading={serverActionLoading}
            serverTestStatus={serverTestStatus}
            poolMin={poolMin}
            poolMax={poolMax}
            poolLoadBalancing={poolLoadBalancing}
            onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
            onUpdateConfig={updateNetworkConfig}
            onSetIsAddingServer={setIsAddingServer}
            onSetEditingServerId={setEditingServerId}
            onSetNewServer={setNewServer}
            onTestServer={handleTestServer}
            onToggleServer={handleToggleServer}
            onMoveServer={handleMoveServer}
            onEditServer={handleEditServer}
            onDeleteServer={handleDeleteServer}
            onAddPreset={handleAddPreset}
            onAddServer={handleAddServer}
            onUpdateServer={handleUpdateServer}
            onCancelEdit={handleCancelEdit}
            getDefaultPort={() => getDefaultPort(network)}
            getServerPoolStats={getServerPoolStats}
          />
        )}
      </div>
  );
};
