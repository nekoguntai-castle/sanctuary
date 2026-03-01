import React, { useState, useEffect } from 'react';
import { ElectrumServer } from '../../types';
import {
  Server,
  Plus,
  Globe,
  Activity,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import { ServerRow } from './ServerRow';
import { ServerForm } from './ServerForm';
import { PRESET_SERVERS } from './constants';
import { Network, ElectrumServerSettingsProps, NewServerData } from './types';

const log = createLogger('ElectrumServerSettings');

export const ElectrumServerSettings: React.FC<ElectrumServerSettingsProps> = ({
  poolEnabled = false,
  onPoolEnabledChange,
}) => {
  const [selectedNetwork, setSelectedNetwork] = useState<Network>('mainnet');
  const [servers, setServers] = useState<Record<Network, ElectrumServer[]>>({
    mainnet: [],
    testnet: [],
    signet: [],
  });
  const [loading, setLoading] = useState(true);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServer, setNewServer] = useState<NewServerData>({
    label: '',
    host: '',
    port: 50002,
    useSsl: true,
  });
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [serverTestErrors, setServerTestErrors] = useState<Record<string, string>>({});
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);
  const [poolStats, setPoolStats] = useState<bitcoinApi.PoolStats | null>(null);

  useEffect(() => {
    loadServers();
    loadPoolStats();
  }, []);

  // Periodically refresh pool stats
  useEffect(() => {
    const interval = setInterval(loadPoolStats, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      // Load servers for all networks
      const [mainnetServers, testnetServers, signetServers] = await Promise.all([
        adminApi.getElectrumServers('mainnet').catch(() => []),
        adminApi.getElectrumServers('testnet').catch(() => []),
        adminApi.getElectrumServers('signet').catch(() => []),
      ]);

      setServers({
        mainnet: mainnetServers,
        testnet: testnetServers,
        signet: signetServers,
      });
    } catch (error) {
      log.error('Failed to load servers', { error });
    } finally {
      setLoading(false);
    }
  };

  const loadPoolStats = async () => {
    try {
      const status = await bitcoinApi.getStatus();
      if (status.pool?.stats) {
        setPoolStats(status.pool.stats);
      }
    } catch (error) {
      // Silently fail - pool stats are optional enhancement
      log.debug('Failed to load pool stats', { error });
    }
  };

  // Get pool stats for a specific server by ID
  const getServerPoolStats = (serverId: string): bitcoinApi.ServerStats | undefined => {
    return poolStats?.servers?.find(s => s.serverId === serverId);
  };

  const handleAddServer = async () => {
    try {
      setServerActionLoading('add');
      const server = await adminApi.addElectrumServer({
        ...newServer,
        network: selectedNetwork,
        enabled: true,
        priority: servers[selectedNetwork].length + 1,
      });

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: [...prev[selectedNetwork], server],
      }));

      setIsAddingServer(false);
      setNewServer({ label: '', host: '', port: 50002, useSsl: true });
    } catch (error) {
      log.error('Failed to add server', { error });
      alert(extractErrorMessage(error, 'Failed to add server'));
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleUpdateServer = async (id: string, updates: Partial<ElectrumServer>) => {
    try {
      setServerActionLoading(id);
      const updatedServer = await adminApi.updateElectrumServer(id, updates);

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: prev[selectedNetwork].map((s) =>
          s.id === id ? updatedServer : s
        ),
      }));

      if (editingServerId === id) {
        setEditingServerId(null);
        setNewServer({ label: '', host: '', port: 50002, useSsl: true });
      }
    } catch (error) {
      log.error('Failed to update server', { error });
      alert(extractErrorMessage(error, 'Failed to update server'));
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;

    try {
      setServerActionLoading(id);
      await adminApi.deleteElectrumServer(id);

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: prev[selectedNetwork].filter((s) => s.id !== id),
      }));
    } catch (error) {
      log.error('Failed to delete server', { error });
      alert('Failed to delete server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleTestServer = async (id: string) => {
    setServerTestStatus((prev) => ({ ...prev, [id]: 'testing' }));
    setServerTestErrors((prev) => ({ ...prev, [id]: '' }));

    try {
      const result = await adminApi.testElectrumServer(id);

      if (result.success) {
        setServerTestStatus((prev) => ({ ...prev, [id]: 'success' }));
        setTimeout(() => {
          setServerTestStatus((prev) => ({ ...prev, [id]: 'idle' }));
        }, 3000);
      } else {
        setServerTestStatus((prev) => ({ ...prev, [id]: 'error' }));
        setServerTestErrors((prev) => ({ ...prev, [id]: result.message || 'Connection failed' }));
      }
    } catch (error) {
      log.error('Server test failed', { error });
      setServerTestStatus((prev) => ({ ...prev, [id]: 'error' }));
      setServerTestErrors((prev) => ({ ...prev, [id]: extractErrorMessage(error, 'Test failed') }));
    }
  };

  const handleMoveServer = async (id: string, direction: 'up' | 'down') => {
    const sortedServers = [...servers[selectedNetwork]].sort((a, b) => a.priority - b.priority);
    const index = sortedServers.findIndex((s) => s.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sortedServers.length - 1) return;

    const newServers = [...sortedServers];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

    const updatedServers = newServers.map((s, i) => ({ ...s, priority: i }));
    const serverIds = updatedServers.map((s) => s.id);

    setServers((prev) => ({
      ...prev,
      [selectedNetwork]: updatedServers,
    }));

    try {
      await adminApi.reorderElectrumServers(serverIds);
    } catch (error) {
      log.error('Failed to reorder servers', { error });
      // Reload on error
      loadServers();
    }
  };

  const handleQuickAddServer = (preset: { name: string; host: string; port: number; useSsl: boolean }) => {
    setNewServer({
      label: preset.name,
      host: preset.host,
      port: preset.port,
      useSsl: preset.useSsl,
    });
    setIsAddingServer(true);
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

  const handleFormCancel = () => {
    setIsAddingServer(false);
    setEditingServerId(null);
    setNewServer({ label: '', host: '', port: 50002, useSsl: true });
  };

  const handleFormSubmit = () => {
    if (editingServerId) {
      handleUpdateServer(editingServerId, newServer);
    } else {
      handleAddServer();
    }
  };

  const currentServers = servers[selectedNetwork] || [];
  const presetServers = PRESET_SERVERS[selectedNetwork] || [];

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading server configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Network Tabs */}
      <div className="flex space-x-1 p-1 surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700">
        {(['mainnet', 'testnet', 'signet'] as Network[]).map((network) => {
          const serverCount = servers[network]?.length || 0;
          const healthyCount = servers[network]?.filter(s => s.enabled && s.isHealthy !== false).length || 0;

          return (
            <button
              key={network}
              onClick={() => setSelectedNetwork(network)}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                selectedNetwork === network
                  ? network === 'mainnet'
                    ? 'bg-mainnet-100 dark:bg-mainnet-900/30 text-mainnet-700 dark:text-mainnet-100 shadow-sm'
                    : network === 'testnet'
                    ? 'bg-testnet-100 dark:bg-testnet-900/30 text-testnet-700 dark:text-testnet-100 shadow-sm'
                    : 'bg-signet-100 dark:bg-signet-900/30 text-signet-700 dark:text-signet-100 shadow-sm'
                  : 'text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <span className="capitalize">{network}</span>
                {serverCount > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedNetwork === network
                      ? network === 'mainnet'
                        ? 'bg-mainnet-200 dark:bg-mainnet-800/50'
                        : network === 'testnet'
                        ? 'bg-testnet-200 dark:bg-testnet-800/50'
                        : 'bg-signet-200 dark:bg-signet-800/50'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-700'
                  }`}>
                    {healthyCount}/{serverCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Network Info Banner */}
      <div className={`p-4 rounded-xl border ${
        selectedNetwork === 'mainnet'
          ? 'bg-mainnet-50 dark:bg-mainnet-900/10 border-mainnet-200 dark:border-mainnet-800'
          : selectedNetwork === 'testnet'
          ? 'bg-testnet-50 dark:bg-testnet-900/10 border-testnet-200 dark:border-testnet-800'
          : 'bg-signet-50 dark:bg-signet-900/10 border-signet-200 dark:border-signet-800'
      }`}>
        <div className="flex items-start space-x-3">
          <Globe className={`w-5 h-5 mt-0.5 ${
            selectedNetwork === 'mainnet'
              ? 'text-mainnet-600 dark:text-mainnet-200'
              : selectedNetwork === 'testnet'
              ? 'text-testnet-600 dark:text-testnet-200'
              : 'text-signet-600 dark:text-signet-200'
          }`} />
          <div className="flex-1">
            <h4 className={`text-sm font-medium mb-1 ${
              selectedNetwork === 'mainnet'
                ? 'text-mainnet-900 dark:text-mainnet-50'
                : selectedNetwork === 'testnet'
                ? 'text-testnet-900 dark:text-testnet-50'
                : 'text-signet-900 dark:text-signet-50'
            }`}>
              {selectedNetwork === 'mainnet' && 'Bitcoin Mainnet'}
              {selectedNetwork === 'testnet' && 'Bitcoin Testnet'}
              {selectedNetwork === 'signet' && 'Bitcoin Signet'}
            </h4>
            <p className={`text-xs ${
              selectedNetwork === 'mainnet'
                ? 'text-mainnet-700 dark:text-mainnet-200'
                : selectedNetwork === 'testnet'
                ? 'text-testnet-700 dark:text-testnet-200'
                : 'text-signet-700 dark:text-signet-200'
            }`}>
              {selectedNetwork === 'mainnet' && 'Production network with real Bitcoin. Use trusted servers only.'}
              {selectedNetwork === 'testnet' && 'Test network with worthless test coins. Safe for development and testing.'}
              {selectedNetwork === 'signet' && 'Alternative test network with more control. Ideal for development.'}
            </p>
          </div>
        </div>
      </div>

      {/* Preset Servers */}
      {presetServers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-sanctuary-400" />
            <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Quick Add Presets</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presetServers.map((server) => (
              <button
                key={`${server.host}:${server.port}`}
                onClick={() => handleQuickAddServer(server)}
                className="text-left px-3 py-2 text-xs rounded-lg border surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
              >
                <div className="font-medium">{server.name}</div>
                <div className="text-[10px] text-sanctuary-500 font-mono truncate">
                  {server.host}:{server.port}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sanctuary-400" />
            <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
              Configured Servers
            </label>
            <span className="text-xs text-sanctuary-400">
              ({currentServers.length} server{currentServers.length !== 1 ? 's' : ''})
            </span>
          </div>
          <button
            onClick={() => {
              setIsAddingServer(true);
              setEditingServerId(null);
              setNewServer({ label: '', host: '', port: selectedNetwork === 'testnet' ? 60002 : 50002, useSsl: true });
            }}
            className="flex items-center space-x-1 text-xs px-2 py-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add Server</span>
          </button>
        </div>

        {/* Server Items */}
        <div className="space-y-2">
          {[...currentServers].sort((a, b) => a.priority - b.priority).map((server, index) => (
            <ServerRow
              key={server.id}
              server={server}
              index={index}
              totalCount={currentServers.length}
              testStatus={serverTestStatus[server.id] || 'idle'}
              testError={serverTestErrors[server.id] || ''}
              actionLoading={serverActionLoading === server.id}
              poolServerStats={getServerPoolStats(server.id)}
              onMoveServer={handleMoveServer}
              onTestServer={handleTestServer}
              onToggleEnabled={(id, enabled) => handleUpdateServer(id, { enabled })}
              onEditServer={handleEditServer}
              onDeleteServer={handleDeleteServer}
            />
          ))}

          {currentServers.length === 0 && (
            <div className="text-center py-8 text-sanctuary-500 text-sm">
              No servers configured for {selectedNetwork}. Add a server to get started.
            </div>
          )}
        </div>

        {/* Add/Edit Server Form */}
        {isAddingServer && (
          <ServerForm
            editingServerId={editingServerId}
            newServer={newServer}
            onNewServerChange={setNewServer}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
            isLoading={serverActionLoading !== null}
          />
        )}
      </div>
    </div>
  );
};
