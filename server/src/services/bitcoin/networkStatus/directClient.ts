/**
 * Attempt-scoped direct singleton Electrum client for status fallback.
 *
 * This never touches the pool's cache (unlike `getNodeClient`, which can
 * transparently return a `PooledNodeClient` facade in pool mode) and never
 * triggers a second configuration read: the connection config is passed in,
 * already resolved from the same snapshot used for the rest of the attempt.
 * The client is connected, identity-verified, probed, and disconnected
 * within this one call — nothing survives the attempt.
 */

import { ElectrumClient } from '../electrum';
import { verifyNodeClientNetwork } from '../networkIdentity';
import type { NetworkType } from '../electrumPool';
import type { ResolvedConnectionConfig } from '../electrum/connectionConfigResolver';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';
import { probeVersionAndHeight } from './probeVersionAndHeight';

const log = createLogger('BITCOIN_NETWORK:DIRECT_CLIENT');

export interface DirectStatusResult {
  ok: boolean;
  version: { server: string; protocol: string } | null;
  blockHeight?: number;
  identityMismatch: boolean;
}

export async function probeDirectSingleton(
  connectionConfig: ResolvedConnectionConfig,
  network: NetworkType,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DirectStatusResult> {
  // When a proxy (Tor) is enabled, a short status-probe bound is too tight
  // for circuit establishment; let the client fall back to its own
  // Tor-aware default (electrumClient.ts multiplies request/batch timeouts
  // by config.torTimeoutMultiplier) rather than forcing `timeoutMs` here.
  const connectionTimeoutMs = connectionConfig.proxy?.enabled ? undefined : options.timeoutMs;

  const client = new ElectrumClient({
    host: connectionConfig.host,
    port: connectionConfig.port,
    protocol: connectionConfig.protocol,
    network,
    allowSelfSignedCert: connectionConfig.allowSelfSignedCert,
    proxy: connectionConfig.proxy,
    ...(connectionTimeoutMs !== undefined ? { connectionTimeoutMs } : {}),
  });

  try {
    await client.connect();

    try {
      await verifyNodeClientNetwork(client, network, { signal: options.signal, timeoutMs: options.timeoutMs });
    } catch (identityError) {
      log.warn('Direct singleton status attempt failed identity verification', {
        network,
        error: getErrorMessage(identityError),
      });
      return { ok: false, version: null, identityMismatch: true };
    }

    const result = await probeVersionAndHeight(client);
    if (result.ok) {
      return { ok: true, version: result.version, blockHeight: result.blockHeight, identityMismatch: false };
    }

    log.debug('Direct singleton status probe RPC failed', { error: getErrorMessage(result.failure) });
    return { ok: false, version: null, identityMismatch: false };
  } catch (connectError) {
    log.debug('Direct singleton status attempt failed to connect', { error: getErrorMessage(connectError) });
    return { ok: false, version: null, identityMismatch: false };
  } finally {
    try {
      client.disconnect();
    } catch (disconnectError) {
      // Never let a disconnect error replace the primary outcome above, and
      // never log connection secrets — only the sanitized error message.
      log.debug('Direct singleton status attempt disconnect failed', {
        error: getErrorMessage(disconnectError),
      });
    }
  }
}
