import type React from 'react';
import { useState } from 'react';
import type { ElectrumServer, NodeConfig as NodeConfigType } from '../../../types';
import * as adminApi from '../../../src/api/admin';
import type * as bitcoinApi from '../../../src/api/bitcoin';
import { createLogger } from '../../../utils/logger';
import { extractErrorMessage } from '../../../utils/errorHandler';
import { NETWORK_COLORS, PRESET_SERVERS } from '../constants';
import {
  getDefaultPort,
  getNetworkMode,
  getNetworkPoolLoadBalancing,
  getNetworkPoolMax,
  getNetworkPoolMin,
  getNetworkSingletonHost,
  getNetworkSingletonPort,
  getNetworkSingletonSsl,
} from '../networkConfigHelpers';
import type {
  ConnectionMode,
  NetworkConnectionCardProps,
  NewServerState,
  PresetServer,
} from '../types';

const log = createLogger('NetworkConnectionCard');

type ServerTestStatus = 'idle' | 'testing' | 'success' | 'error';

export function useNetworkConnectionCardController({
  network,
  config,
  servers,
  poolStats,
  onConfigChange,
  onServersChange,
  onTestConnection,
}: NetworkConnectionCardProps) {
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServer, setNewServer] = useState<NewServerState>(createEmptyServer(network));
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<ServerTestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, ServerTestStatus>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateNetworkConfig = (field: string, value: unknown) => {
    onConfigChange(createNetworkConfigPatch(network, field, value));
  };

  const handleModeChange = (nextMode: ConnectionMode) => {
    updateNetworkConfig('mode', nextMode);
  };

  const handleTestSingleton = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await onTestConnection(
        getNetworkSingletonHost(network, config),
        getNetworkSingletonPort(network, config),
        getNetworkSingletonSsl(network, config)
      );
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
      setServerTestStatus(prev => ({ ...prev, [server.id]: result.success ? 'success' : 'error' }));
      scheduleServerStatusClear(server.id, setServerTestStatus);
    } catch {
      setServerTestStatus(prev => ({ ...prev, [server.id]: 'error' }));
      scheduleServerStatusClear(server.id, setServerTestStatus);
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
      resetServerForm(network, setNewServer, setEditingServerId, setIsAddingServer);
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
      onServersChange(servers.map(server => server.id === editingServerId ? updatedServer : server));
      resetServerForm(network, setNewServer, setEditingServerId, setIsAddingServer);
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
      onServersChange(servers.filter(server => server.id !== serverId));
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
      onServersChange(servers.map(item => item.id === server.id ? { ...item, enabled: !item.enabled } : item));
    } catch (error) {
      log.error('Failed to toggle server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleMoveServer = async (serverId: string, direction: 'up' | 'down') => {
    const reordered = getReorderedServers(servers, serverId, direction);
    if (!reordered) return;

    onServersChange(reordered);
    try {
      await adminApi.reorderElectrumServers(reordered.map(server => server.id));
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
    resetServerForm(network, setNewServer, setEditingServerId, setIsAddingServer);
  };

  return {
    colors: NETWORK_COLORS[network],
    presets: PRESET_SERVERS[network],
    mode: getNetworkMode(network, config),
    singletonHost: getNetworkSingletonHost(network, config),
    singletonPort: getNetworkSingletonPort(network, config),
    singletonSsl: getNetworkSingletonSsl(network, config),
    poolMin: getNetworkPoolMin(network, config),
    poolMax: getNetworkPoolMax(network, config),
    poolLoadBalancing: getNetworkPoolLoadBalancing(network, config),
    isAddingServer,
    editingServerId,
    newServer,
    serverActionLoading,
    testStatus,
    testMessage,
    serverTestStatus,
    showAdvanced,
    setIsAddingServer,
    setEditingServerId,
    setNewServer,
    setShowAdvanced,
    updateNetworkConfig,
    handleModeChange,
    handleTestSingleton,
    handleTestServer,
    handleAddServer,
    handleUpdateServer,
    handleEditServer,
    handleDeleteServer,
    handleToggleServer,
    handleMoveServer,
    handleAddPreset,
    handleCancelEdit,
    getDefaultPort: () => getDefaultPort(network),
    getServerPoolStats: (serverId: string) => getServerPoolStats(poolStats, serverId),
  };
}

function createEmptyServer(network: NetworkConnectionCardProps['network']): NewServerState {
  return { label: '', host: '', port: getDefaultPort(network), useSsl: true };
}

function createNetworkConfigPatch(
  network: NetworkConnectionCardProps['network'],
  field: string,
  value: unknown
): Partial<NodeConfigType> {
  const fieldMap: Record<string, string> = {
    enabled: `${network}Enabled`,
    mode: `${network}Mode`,
    singletonHost: `${network}SingletonHost`,
    singletonPort: `${network}SingletonPort`,
    singletonSsl: `${network}SingletonSsl`,
    poolMin: `${network}PoolMin`,
    poolMax: `${network}PoolMax`,
    poolLoadBalancing: `${network}PoolLoadBalancing`,
  };

  return { [fieldMap[field]]: value } as Partial<NodeConfigType>;
}

function scheduleServerStatusClear(
  serverId: string,
  setServerTestStatus: React.Dispatch<React.SetStateAction<Record<string, ServerTestStatus>>>
) {
  setTimeout(() => {
    setServerTestStatus(prev => ({ ...prev, [serverId]: 'idle' }));
  }, 5000);
}

function resetServerForm(
  network: NetworkConnectionCardProps['network'],
  setNewServer: React.Dispatch<React.SetStateAction<NewServerState>>,
  setEditingServerId: React.Dispatch<React.SetStateAction<string | null>>,
  setIsAddingServer: React.Dispatch<React.SetStateAction<boolean>>
) {
  setNewServer(createEmptyServer(network));
  setEditingServerId(null);
  setIsAddingServer(false);
}

function getReorderedServers(
  servers: ElectrumServer[],
  serverId: string,
  direction: 'up' | 'down'
): ElectrumServer[] | null {
  const index = servers.findIndex(server => server.id === serverId);
  if (index === -1) return null;
  if (direction === 'up' && index === 0) return null;
  if (direction === 'down' && index === servers.length - 1) return null;

  const newServers = [...servers];
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

  return newServers.map((server, priority) => ({ ...server, priority }));
}

function getServerPoolStats(
  poolStats: bitcoinApi.PoolStats | null | undefined,
  serverId: string
): bitcoinApi.ServerStats | undefined {
  return poolStats?.servers?.find(server => server.serverId === serverId);
}
