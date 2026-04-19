import { useEffect, useState } from 'react';
import type { ElectrumServer, NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createLogger } from '../../utils/logger';
import { DEFAULT_NODE_CONFIG, shouldShowCustomProxy } from './nodeConfigData';

const log = createLogger('NodeConfig');

export function useNodeConfigData() {
  const [loading, setLoading] = useState(true);
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [allServers, setAllServers] = useState<ElectrumServer[]>([]);
  const [torContainerStatus, setTorContainerStatus] = useState<adminApi.TorContainerStatus | null>(null);
  const [poolStats, setPoolStats] = useState<bitcoinApi.PoolStats | null>(null);
  const [showCustomProxy, setShowCustomProxy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [config, serverList, torStatus] = await loadNodeConfigSources();
        /* v8 ignore next -- unmount guard for an async load race */
        if (cancelled) return;

        setNodeConfig(config);
        setAllServers(serverList);
        if (torStatus) setTorContainerStatus(torStatus);
        setShowCustomProxy(shouldShowCustomProxy(config));
        void fetchPoolStats(setPoolStats);
      } catch (error) {
        log.error('Failed to load data', { error });
        /* v8 ignore next -- unmount guard for an async load race */
        if (!cancelled) setNodeConfig(DEFAULT_NODE_CONFIG);
      } finally {
        /* v8 ignore next -- unmount guard for an async load race */
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    loading,
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
