import * as blockchain from './blockchain';
import { getElectrumClient } from './electrum';
import { getElectrumPoolAsync } from './electrumPool';
import type { PooledConnectionHandle } from './electrumPool/types';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../constants';
import { systemSettingRepository } from '../../repositories';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';
import { SystemSettingSchemas } from '../../utils/safeJson';

const log = createLogger('BITCOIN_NETWORK:SVC');

type ElectrumPool = Awaited<ReturnType<typeof getElectrumPoolAsync>>;
type ElectrumPoolStats = ReturnType<ElectrumPool['getPoolStats']>;

export interface BitcoinNetworkStatus {
  connected: true;
  server: string;
  protocol: string;
  blockHeight?: number;
  network: 'mainnet';
  explorerUrl: string;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  pool: {
    enabled: boolean;
    stats: ElectrumPoolStats | null;
  } | null;
}

export async function getBitcoinNetworkStatus(): Promise<BitcoinNetworkStatus> {
  const nodeConfig = await nodeConfigRepository.findDefault();

  let version: { server: string; protocol: string } | null = null;
  let blockHeight: number | undefined;
  let poolStats: ElectrumPoolStats | null = null;
  let poolHandle: PooledConnectionHandle | null = null;

  const usePool = nodeConfig?.poolEnabled || nodeConfig?.mainnetMode === 'pool';
  if (nodeConfig?.type === 'electrum' && usePool) {
    try {
      const pool = await getElectrumPoolAsync();
      if (pool.isPoolInitialized()) {
        poolStats = pool.getPoolStats();

        if (poolStats.idleConnections > 0 || poolStats.activeConnections > 0) {
          poolHandle = await pool.acquire({ purpose: 'status', timeoutMs: 5000 });
          const [ver, height] = await Promise.all([
            poolHandle.client.getServerVersion(),
            poolHandle.client.getBlockHeight(),
          ]);
          version = ver;
          blockHeight = height;
        }
      }
    } catch (poolError) {
      log.debug('Pool status check failed, falling back to singleton', { error: String(poolError) });
    } finally {
      if (poolHandle) {
        poolHandle.release();
      }
    }
  }

  if (!version) {
    const client = getElectrumClient();
    if (!client.isConnected()) {
      await client.connect();
    }
    const [ver, height] = await Promise.all([
      client.getServerVersion(),
      blockchain.getBlockHeight(),
    ]);
    version = ver;
    blockHeight = height;
  }

  const [confirmationThreshold, deepConfirmationThreshold] = await Promise.all([
    systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD),
    systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number, DEFAULT_DEEP_CONFIRMATION_THRESHOLD),
  ]);

  return {
    connected: true,
    server: version.server,
    protocol: version.protocol,
    blockHeight,
    network: 'mainnet',
    explorerUrl: nodeConfig?.explorerUrl || 'https://mempool.space',
    confirmationThreshold,
    deepConfirmationThreshold,
    pool: nodeConfig?.type === 'electrum' ? {
      enabled: nodeConfig.poolEnabled,
      stats: poolStats,
    } : null,
  };
}
