/**
 * Subscription Connection
 *
 * Manages the dedicated subscription connection used for
 * real-time blockchain event subscriptions (e.g., new blocks,
 * address notifications). Extracted from ElectrumPool to
 * isolate the reconnection/fallback logic.
 */

import { createLogger } from '../../../utils/logger';

import type { ElectrumClient } from '../electrum';
import type { PooledConnection, ElectrumPoolConfig } from './types';

const log = createLogger('ELECTRUM_POOL:SUB');

/**
 * Callbacks the subscription logic needs from the pool.
 * Keeps the function decoupled from the class without exposing private state.
 */
export interface SubscriptionDeps {
  findIdleConnection(): PooledConnection | null;
  createConnection(allowOverCapacity?: boolean): Promise<PooledConnection>;
  reconnectConnection(conn: PooledConnection): Promise<void>;
  hasAvailableCapacity(): boolean;
}

/**
 * Get or create the dedicated subscription connection.
 *
 * In single-connection mode the sole connection is returned directly.
 * In pool mode, we prefer reusing an existing healthy subscription
 * connection, then fall back to idle connections, then create a new one.
 */
export async function getSubscriptionConnection(
  connections: Map<string, PooledConnection>,
  subscriptionConnectionId: { value: string | null },
  config: ElectrumPoolConfig,
  deps: SubscriptionDeps,
): Promise<ElectrumClient> {
  // Single-connection mode - use the one connection for everything
  if (!config.enabled) {
    let conn = connections.values().next().value as PooledConnection | undefined;
    if (!conn || !conn.client.isConnected()) {
      if (conn) {
        await deps.reconnectConnection(conn);
      } else {
        await deps.createConnection();
      }
      conn = connections.values().next().value as PooledConnection;
    }
    return conn.client;
  }

  // Return existing subscription connection if available
  if (subscriptionConnectionId.value) {
    const conn = connections.get(subscriptionConnectionId.value);
    if (conn && conn.state !== 'closed' && conn.client.isConnected()) {
      return conn.client;
    }
    // Subscription connection is dead, clear it
    subscriptionConnectionId.value = null;
  }

  // Create or designate a subscription connection
  let conn = deps.findIdleConnection();
  if (!conn && deps.hasAvailableCapacity()) {
    conn = await deps.createConnection();
  }

  if (!conn) {
    // All connections are active, create one even if over limit for subscriptions
    log.warn('Creating extra connection for subscriptions (pool at capacity)');
    conn = await deps.createConnection(true);
  }

  conn.isDedicated = true;
  conn.state = 'active';
  subscriptionConnectionId.value = conn.id;

  log.info(`Designated connection ${conn.id} for subscriptions`);
  return conn.client;
}
