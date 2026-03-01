/**
 * Acquisition Queue
 *
 * Manages connection acquisition queueing when the pool is exhausted.
 * Handles timeout management and queue draining when connections are released.
 */

import {
  electrumPoolAcquisitionsTotal,
  electrumPoolAcquisitionDuration,
} from '../../../observability/metrics';
import type {
  PooledConnection,
  PooledConnectionHandle,
  WaitingRequest,
  NetworkType,
} from './types';

/**
 * Activate a connection for use in pool mode.
 * Records metrics and returns a handle with a release function.
 */
export function activateConnection(
  conn: PooledConnection,
  purpose: string | undefined,
  startTime: number,
  network: NetworkType,
  stats: { totalAcquisitions: number; totalAcquisitionTimeMs: number },
  processWaitingQueue: () => void,
): PooledConnectionHandle {
  conn.state = 'active';
  conn.lastUsedAt = new Date();
  conn.useCount++;

  const acquisitionTime = Date.now() - startTime;
  stats.totalAcquisitions++;
  stats.totalAcquisitionTimeMs += acquisitionTime;

  // Record acquisition metrics
  electrumPoolAcquisitionsTotal.inc({ network });
  electrumPoolAcquisitionDuration.observe({ network }, acquisitionTime / 1000);

  const release = () => {
    if (conn.state === 'active' && !conn.isDedicated) {
      conn.state = 'idle';
      conn.lastUsedAt = new Date();
      processWaitingQueue();
    }
  };

  return {
    client: conn.client,
    release,
    async withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T> {
      try {
        return await fn(conn.client);
      } finally {
        release();
      }
    },
  };
}

/**
 * Activate connection in single-mode (no state tracking, no-op release).
 */
export function activateConnectionSingleMode(
  conn: PooledConnection,
  startTime: number,
  network: NetworkType,
  stats: { totalAcquisitions: number; totalAcquisitionTimeMs: number },
): PooledConnectionHandle {
  conn.lastUsedAt = new Date();
  conn.useCount++;

  const acquisitionTime = Date.now() - startTime;
  stats.totalAcquisitions++;
  stats.totalAcquisitionTimeMs += acquisitionTime;

  // Record acquisition metrics
  electrumPoolAcquisitionsTotal.inc({ network });
  electrumPoolAcquisitionDuration.observe({ network }, acquisitionTime / 1000);

  // In single mode, release is a no-op since we always use the same connection
  const release = () => {};

  return {
    client: conn.client,
    release,
    async withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T> {
      return await fn(conn.client);
    },
  };
}

/**
 * Process the waiting queue when a connection becomes available.
 */
export function processWaitingQueue(
  waitingQueue: WaitingRequest[],
  findIdleConnection: () => PooledConnection | null,
  activateConn: (conn: PooledConnection, purpose: string | undefined, startTime: number) => PooledConnectionHandle,
): void {
  if (waitingQueue.length === 0) return;

  const conn = findIdleConnection();
  if (!conn) return;

  const request = waitingQueue.shift();
  if (!request) return;

  clearTimeout(request.timeoutId);

  const handle = activateConn(conn, request.purpose, request.startTime);
  request.resolve(handle);
}

// Re-import ElectrumClient type for withClient generic
import { ElectrumClient } from '../electrum';
