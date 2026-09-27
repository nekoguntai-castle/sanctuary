import { useCallback, useEffect, useState } from 'react';
import type { ElectrumServer, NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../api/admin';
import * as bitcoinApi from '../../api/bitcoin';
import { createLogger } from '../../utils/logger';
import { useLatestRequest } from '../../hooks/useLatestRequest';
import { extractErrorMessage } from '../../utils/errorHandler';
import { shouldShowCustomProxy } from './nodeConfigData';

const log = createLogger('NodeConfig');

export function useNodeConfigData() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadOwner = useLatestRequest();
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [allServers, setAllServers] = useState<ElectrumServer[]>([]);
  const [torContainerStatus, setTorContainerStatus] = useState<adminApi.TorContainerStatus | null>(null);
  const [poolStats, setPoolStats] = useState<bitcoinApi.PoolStats | null>(null);
  const [showCustomProxy, setShowCustomProxy] = useState(false);

  const retryLoad = useCallback(async () => {
    const token = loadOwner.begin();
    setLoading(true);
    setLoadError(null);
    setNodeConfig(null);
    try {
      const [config, serverList, torStatus] = await loadNodeConfigSources();
      if (!loadOwner.isCurrent(token)) return;

      setNodeConfig(config);
      setAllServers(serverList);
      if (torStatus) setTorContainerStatus(torStatus);
      setShowCustomProxy(shouldShowCustomProxy(config));
      void fetchPoolStats(setPoolStats);
    } catch (error) {
      if (loadOwner.isCurrent(token)) {
        log.error('Failed to load data', { error });
        setLoadError(extractErrorMessage(error, 'Settings are unavailable'));
      }
    } finally {
      if (loadOwner.isCurrent(token)) setLoading(false);
    }
  }, [loadOwner]);

  useEffect(() => {
    void retryLoad();
  }, [retryLoad]);

  return {
    loading,
    loadError,
    retryLoad,
    nodeConfig,
    setNodeConfig,
    allServers,
    setAllServers,
    torContainerStatus,
    setTorContainerStatus,
    poolStats,
    showCustomProxy,
    setShowCustomProxy,
  };
}

async function loadNodeConfigSources() {
  return Promise.all([
    adminApi.getNodeConfig(),
    adminApi.getElectrumServers().catch(() => []),
    adminApi.getTorContainerStatus().catch(() => null),
  ]);
}

async function fetchPoolStats(setPoolStats: (stats: bitcoinApi.PoolStats) => void) {
  try {
    const status = await bitcoinApi.getStatus();
    if (status.pool?.stats) setPoolStats(status.pool.stats);
  } catch (error) {
    log.debug('Failed to load pool stats', { error });
  }
}
