/**
 * Electrum Pool - Public API
 *
 * Barrel file re-exporting all public types and functions.
 * External consumers should import from this module.
 */

// Core class
export { ElectrumPool } from './electrumPool';

// Types
export type {
  LoadBalancingStrategy,
  NetworkType,
  ProxyConfig,
  ServerConfig,
  ServerStats,
  HealthCheckResult,
  BackoffConfig,
  ElectrumPoolConfig,
  ConnectionState,
  PooledConnection,
  PoolStats,
  AcquireOptions,
  PooledConnectionHandle,
  WaitingRequest,
  ServerState,
} from './types';

// Singleton/registry functions
export {
  getElectrumPool,
  getElectrumPoolAsync,
  getElectrumPoolForNetwork,
  initializeElectrumPool,
  shutdownElectrumPool,
  resetElectrumPool,
  resetElectrumPoolForNetwork,
  getPoolConfig,
  isPoolEnabled,
  reloadElectrumServers,
  getElectrumServers,
} from './poolRegistry';
