import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../src/api/admin';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';

const log = createLogger('NodeConfig');

export type ProxyTestStatus = 'idle' | 'testing' | 'success' | 'error';
export type ProxyPreset = 'tor' | 'tor-browser' | 'tor-container';

export function useProxyTorControls({
  nodeConfig,
  setNodeConfig,
  torContainerStatus,
  setTorContainerStatus,
  showCustomProxy,
  setShowCustomProxy,
}: {
  nodeConfig: NodeConfigType | null;
  setNodeConfig: Dispatch<SetStateAction<NodeConfigType | null>>;
  torContainerStatus: adminApi.TorContainerStatus | null;
  setTorContainerStatus: Dispatch<SetStateAction<adminApi.TorContainerStatus | null>>;
  showCustomProxy: boolean;
  setShowCustomProxy: Dispatch<SetStateAction<boolean>>;
}) {
  const [proxyTestStatus, setProxyTestStatus] = useState<ProxyTestStatus>('idle');
  const [proxyTestMessage, setProxyTestMessage] = useState('');
  const [isTorContainerLoading, setIsTorContainerLoading] = useState(false);
  const [torContainerMessage, setTorContainerMessage] = useState('');

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
      setProxyTestStatus(result.success ? 'success' : 'error');
      setProxyTestMessage(result.message || (result.success ? 'Proxy connection successful' : 'Proxy connection failed'));
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

  const handleProxyPreset = (preset: ProxyPreset) => {
    if (!nodeConfig) return;

    const nextConfig = preset === 'tor-container'
      ? createBundledTorConfig(nodeConfig)
      : createCustomTorConfig(nodeConfig, preset);
    setNodeConfig(nextConfig);
    setShowCustomProxy(preset !== 'tor-container');
  };

  const handleTorContainerToggle = async () => {
    if (!torContainerStatus) return;

    setIsTorContainerLoading(true);
    setTorContainerMessage('');

    try {
      if (torContainerStatus.running) {
        await stopTorContainer({
          torContainerStatus,
          nodeConfig,
          setNodeConfig,
          setTorContainerStatus,
          setTorContainerMessage,
        });
      } else {
        await startTorContainer({
          torContainerStatus,
          setTorContainerStatus,
          setTorContainerMessage,
        });
      }
    } catch (error) {
      log.error('Tor container toggle error', { error });
      setTorContainerMessage(extractErrorMessage(error, 'Failed to toggle Tor container'));
    } finally {
      setIsTorContainerLoading(false);
      setTimeout(() => {
        void refreshTorContainerStatus(setTorContainerStatus);
      }, 2000);
    }
  };

  return {
    proxyTestStatus,
    proxyTestMessage,
    isTorContainerLoading,
    torContainerMessage,
    handleTestProxy,
    handleProxyPreset,
    handleTorContainerToggle,
    refreshTorContainerStatus: () => refreshTorContainerStatus(setTorContainerStatus),
    toggleCustomProxy: () => setShowCustomProxy(!showCustomProxy),
  };
}

function createBundledTorConfig(config: NodeConfigType): NodeConfigType {
  return {
    ...config,
    proxyEnabled: true,
    proxyHost: 'tor',
    proxyPort: 9050,
    proxyUsername: undefined,
    proxyPassword: undefined,
  };
}

function createCustomTorConfig(config: NodeConfigType, preset: Exclude<ProxyPreset, 'tor-container'>): NodeConfigType {
  return {
    ...config,
    proxyEnabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: preset === 'tor' ? 9050 : 9150,
    proxyUsername: undefined,
    proxyPassword: undefined,
  };
}

async function startTorContainer({
  torContainerStatus,
  setTorContainerStatus,
  setTorContainerMessage,
}: {
  torContainerStatus: adminApi.TorContainerStatus;
  setTorContainerStatus: Dispatch<SetStateAction<adminApi.TorContainerStatus | null>>;
  setTorContainerMessage: (message: string) => void;
}) {
  setTorContainerMessage(torContainerStatus.exists ? 'Starting Tor (10-30s)...' : 'Installing Tor (may take a minute)...');
  const result = await adminApi.startTorContainer();
  if (!result.success) {
    setTorContainerMessage(result.message);
    return;
  }

  setTorContainerMessage('Bootstrapping Tor network...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  setTorContainerStatus({ ...torContainerStatus, exists: true, running: true, status: 'running' });
  setTorContainerMessage('Tor ready');
}

async function stopTorContainer({
  torContainerStatus,
  nodeConfig,
  setNodeConfig,
  setTorContainerStatus,
  setTorContainerMessage,
}: {
  torContainerStatus: adminApi.TorContainerStatus;
  nodeConfig: NodeConfigType | null;
  setNodeConfig: Dispatch<SetStateAction<NodeConfigType | null>>;
  setTorContainerStatus: Dispatch<SetStateAction<adminApi.TorContainerStatus | null>>;
  setTorContainerMessage: (message: string) => void;
}) {
  const result = await adminApi.stopTorContainer();
  if (!result.success) {
    setTorContainerMessage(result.message);
    return;
  }

  setTorContainerMessage('Tor stopped. Re-enabling will take 10-30s to bootstrap.');
  setTorContainerStatus({ ...torContainerStatus, running: false, status: 'exited' });
  if (nodeConfig?.proxyHost === 'tor') {
    setNodeConfig(prev => prev ? { ...prev, proxyEnabled: false, proxyHost: undefined, proxyPort: undefined } : prev);
  }
}

async function refreshTorContainerStatus(
  setTorContainerStatus: Dispatch<SetStateAction<adminApi.TorContainerStatus | null>>
) {
  try {
    const status = await adminApi.getTorContainerStatus();
    setTorContainerStatus(status);
  } catch (error) {
    log.error('Failed to refresh Tor container status', { error });
  }
}
