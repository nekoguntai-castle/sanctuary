import React, { useState, useEffect } from 'react';
import { NodeConfig as NodeConfigType, ElectrumServer } from '../../types';
import { Button } from '../ui/Button';
import { Check, AlertCircle } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import { ExternalServicesSection } from './ExternalServicesSection';
import { NetworkConnectionsSection } from './NetworkConnectionsSection';
import { ProxyTorSection } from './ProxyTorSection';
import { SectionId, NetworkTab } from './types';

const log = createLogger('NodeConfig');

export const NodeConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);

  // All electrum servers (will be filtered by network for each card)
  const [allServers, setAllServers] = useState<ElectrumServer[]>([]);

  // Collapsible sections - only one open at a time
  const [expandedSection, setExpandedSection] = useState<SectionId | null>(null);

  // Network tabs
  const [activeNetworkTab, setActiveNetworkTab] = useState<NetworkTab>('mainnet');

  // Proxy test state
  const [proxyTestStatus, setProxyTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [proxyTestMessage, setProxyTestMessage] = useState<string>('');

  // Tor container state
  const [torContainerStatus, setTorContainerStatus] = useState<adminApi.TorContainerStatus | null>(null);
  const [isTorContainerLoading, setIsTorContainerLoading] = useState(false);
  const [torContainerMessage, setTorContainerMessage] = useState<string>('');

  // Pool stats for health history
  const [poolStats, setPoolStats] = useState<bitcoinApi.PoolStats | null>(null);

  // Show custom proxy fields
  const [showCustomProxy, setShowCustomProxy] = useState(false);

  // Fetch pool stats for health history
  const fetchPoolStats = async () => {
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

  useEffect(() => {
    const loadData = async () => {
      try {
        const [nc, serverList, torStatus] = await Promise.all([
          adminApi.getNodeConfig(),
          adminApi.getElectrumServers().catch(() => []),
          adminApi.getTorContainerStatus().catch(() => null),
        ]);
        setNodeConfig(nc);
        setAllServers(serverList);
        if (torStatus) setTorContainerStatus(torStatus);
        // Show custom proxy fields if not using bundled Tor
        if (nc?.proxyEnabled && nc.proxyHost !== 'tor') {
          setShowCustomProxy(true);
        }
        // Also fetch pool stats
        fetchPoolStats();
      } catch (error) {
        log.error('Failed to load data', { error });
        // Set default node config if API call fails
        setNodeConfig({
          type: 'electrum',
          explorerUrl: 'https://mempool.space',
          feeEstimatorUrl: 'https://mempool.space',
          mempoolEstimator: 'mempool_space',
          mainnetMode: 'pool',
          mainnetSingletonHost: 'electrum.blockstream.info',
          mainnetSingletonPort: 50002,
          mainnetSingletonSsl: true,
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          mainnetPoolLoadBalancing: 'round_robin',
          testnetEnabled: false,
          testnetMode: 'singleton',
          testnetSingletonHost: 'electrum.blockstream.info',
          testnetSingletonPort: 60002,
          testnetSingletonSsl: true,
          testnetPoolMin: 1,
          testnetPoolMax: 3,
          testnetPoolLoadBalancing: 'round_robin',
          signetEnabled: false,
          signetMode: 'singleton',
          signetSingletonHost: 'electrum.mutinynet.com',
          signetSingletonPort: 50002,
          signetSingletonSsl: true,
          signetPoolMin: 1,
          signetPoolMax: 3,
          signetPoolLoadBalancing: 'round_robin',
        });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleSaveNodeConfig = async () => {
    if (!nodeConfig) return;

    setIsSavingNode(true);
    setNodeSaveError(null);
    setNodeSaveSuccess(false);

    try {
      await adminApi.updateNodeConfig(nodeConfig);
      setNodeSaveSuccess(true);
      setTimeout(() => setNodeSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to save node config', { error });
      setNodeSaveError('Failed to save node configuration');
    } finally {
      setIsSavingNode(false);
    }
  };

  // Test connection handler for NetworkConnectionCard
  const handleTestConnection = async (host: string, port: number, ssl: boolean) => {
    try {
      const result = await adminApi.testElectrumConnection({
        host,
        port,
        useSsl: ssl,
      });
      return result;
    } catch (error) {
      return {
        success: false,
        message: extractErrorMessage(error, 'Connection failed'),
      };
    }
  };

  // Get servers filtered by network
  const getServersForNetwork = (network: 'mainnet' | 'testnet' | 'signet') => {
    return allServers.filter(s => s.network === network).sort((a, b) => a.priority - b.priority);
  };

  // Update servers for a specific network
  const handleServersChange = (network: 'mainnet' | 'testnet' | 'signet', servers: ElectrumServer[]) => {
    setAllServers(prev => [
      ...prev.filter(s => s.network !== network),
      ...servers,
    ]);
  };

  const handleTestProxy = async () => {
    if (!nodeConfig?.proxyHost || !nodeConfig?.proxyPort) return;

    setProxyTestStatus('testing');
    setProxyTestMessage('Verifying Tor connection via .onion address...');

    try {
      const result = await adminApi.testProxy({
        host: nodeConfig.proxyHost,
        port: nodeConfig.proxyPort,
        username: nodeConfig.proxyUsername,
        password: nodeConfig.proxyPassword,
      });

      if (result.success) {
        setProxyTestStatus('success');
        setProxyTestMessage(result.message || 'Proxy connection successful');
      } else {
        setProxyTestStatus('error');
        setProxyTestMessage(result.message || 'Proxy connection failed');
      }
    } catch (error) {
      log.error('Proxy test error', { error });
      setProxyTestStatus('error');
      setProxyTestMessage(extractErrorMessage(error, 'Failed to test proxy'));
    }

    setTimeout(() => {
      setProxyTestStatus('idle');
      setProxyTestMessage('');
    }, 10000);
  };

  const handleProxyPreset = (preset: 'tor' | 'tor-browser' | 'tor-container') => {
    // nodeConfig is guaranteed truthy — proxy UI only renders after config loads
    const config = nodeConfig!;

    if (preset === 'tor-container') {
      setNodeConfig({
        ...config,
        proxyEnabled: true,
        proxyHost: 'tor',
        proxyPort: 9050,
        proxyUsername: undefined,
        proxyPassword: undefined,
      });
      setShowCustomProxy(false);
    } else {
      const port = preset === 'tor' ? 9050 : 9150;
      setNodeConfig({
        ...config,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: port,
        proxyUsername: undefined,
        proxyPassword: undefined,
      });
      setShowCustomProxy(true);
    }
  };

  const handleTorContainerToggle = async () => {
    if (!torContainerStatus) return;

    setIsTorContainerLoading(true);
    setTorContainerMessage('');

    try {
      if (torContainerStatus.running) {
        // Stopping Tor - warn about bootstrap time
        const result = await adminApi.stopTorContainer();
        if (result.success) {
          setTorContainerMessage('Tor stopped. Re-enabling will take 10-30s to bootstrap.');
          setTorContainerStatus({ ...torContainerStatus, running: false, status: 'exited' });
          // If we were using bundled Tor, disable proxy
          if (nodeConfig?.proxyHost === 'tor') {
            setNodeConfig((prev) =>
              prev
                ? { ...prev, proxyEnabled: false, proxyHost: undefined, proxyPort: undefined }
                : prev
            );
          }
        } else {
          setTorContainerMessage(result.message);
        }
      } else {
        setTorContainerMessage(torContainerStatus.exists ? 'Starting Tor (10-30s)...' : 'Installing Tor (may take a minute)...');
        const result = await adminApi.startTorContainer();
        if (result.success) {
          // Wait a moment for Tor to bootstrap
          setTorContainerMessage('Bootstrapping Tor network...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          setTorContainerStatus({ ...torContainerStatus, exists: true, running: true, status: 'running' });
          setTorContainerMessage('Tor ready');
        } else {
          setTorContainerMessage(result.message);
        }
      }
    } catch (error) {
      log.error('Tor container toggle error', { error });
      setTorContainerMessage(extractErrorMessage(error, 'Failed to toggle Tor container'));
    } finally {
      setIsTorContainerLoading(false);
      setTimeout(async () => {
        const status = await adminApi.getTorContainerStatus().catch(() => null);
        if (status) setTorContainerStatus(status);
      }, 2000);
    }
  };

  const refreshTorContainerStatus = async () => {
    try {
      const status = await adminApi.getTorContainerStatus();
      setTorContainerStatus(status);
    } catch (error) {
      log.error('Failed to refresh Tor container status', { error });
    }
  };

  const toggleSection = (section: SectionId) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  // Generate summaries for collapsed sections
  const getExternalServicesSummary = () => {
    const explorer = nodeConfig?.explorerUrl?.replace('https://', '') || 'mempool.space';
    const feeSource = nodeConfig?.feeEstimatorUrl ? 'Mempool API' : 'Electrum';
    return `${explorer} • ${feeSource}`;
  };

  const getNetworksSummary = () => {
    const mainnetServers = getServersForNetwork('mainnet').length;
    const testnetEnabled = nodeConfig?.testnetEnabled;
    const signetEnabled = nodeConfig?.signetEnabled;
    const parts = [`Mainnet (${mainnetServers})`];
    if (testnetEnabled) parts.push('Testnet');
    if (signetEnabled) parts.push('Signet');
    return parts.join(' • ');
  };

  const getProxySummary = () => {
    if (!nodeConfig?.proxyEnabled) return 'Disabled';
    if (nodeConfig.proxyHost === 'tor') return 'Bundled Tor';
    return `${nodeConfig.proxyHost}:${nodeConfig.proxyPort}`;
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading node configuration...</div>;

  return (
    <div className="space-y-4 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Node Configuration</h2>
          <p className="text-sm text-sanctuary-500">Configure network settings for the Bitcoin backend</p>
        </div>
        <Button onClick={handleSaveNodeConfig} isLoading={isSavingNode}>
          Save All Settings
        </Button>
      </div>

      {/* Status Messages */}
      {nodeConfig && (nodeSaveError || nodeSaveSuccess) && (
        <div className="space-y-2">
          {nodeSaveError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mr-2 flex-shrink-0" />
              <span className="text-sm text-red-800 dark:text-red-300">{nodeSaveError}</span>
            </div>
          )}
          {nodeSaveSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center animate-fade-in">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400 mr-2 flex-shrink-0" />
              <span className="text-sm text-green-800 dark:text-green-300">Node configuration saved successfully</span>
            </div>
          )}
        </div>
      )}

      {nodeConfig && (
        <div className="space-y-3">
          {/* Section 1: External Services */}
          <ExternalServicesSection
            nodeConfig={nodeConfig}
            onConfigChange={setNodeConfig}
            expanded={expandedSection === 'external'}
            onToggle={() => toggleSection('external')}
            summary={getExternalServicesSummary()}
          />

          {/* Section 2: Network Connections */}
          <NetworkConnectionsSection
            nodeConfig={nodeConfig}
            servers={allServers}
            poolStats={poolStats}
            activeNetworkTab={activeNetworkTab}
            onNetworkTabChange={setActiveNetworkTab}
            onConfigChange={setNodeConfig}
            onServersChange={handleServersChange}
            onTestConnection={handleTestConnection}
            expanded={expandedSection === 'networks'}
            onToggle={() => toggleSection('networks')}
            summary={getNetworksSummary()}
          />

          {/* Section 3: Proxy / Tor */}
          <ProxyTorSection
            nodeConfig={nodeConfig}
            onConfigChange={setNodeConfig}
            torContainerStatus={torContainerStatus}
            isTorContainerLoading={isTorContainerLoading}
            torContainerMessage={torContainerMessage}
            showCustomProxy={showCustomProxy}
            proxyTestStatus={proxyTestStatus}
            proxyTestMessage={proxyTestMessage}
            onProxyPreset={handleProxyPreset}
            onToggleCustomProxy={() => setShowCustomProxy(!showCustomProxy)}
            onTorContainerToggle={handleTorContainerToggle}
            onRefreshTorStatus={refreshTorContainerStatus}
            onTestProxy={handleTestProxy}
            expanded={expandedSection === 'proxy'}
            onToggle={() => toggleSection('proxy')}
            summary={getProxySummary()}
          />
        </div>
      )}
    </div>
  );
};
