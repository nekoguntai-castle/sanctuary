import {
  WORKER_CIRCUIT_BREAKER_NAME_PATTERN,
  WORKER_CIRCUIT_BREAKERS_MAX,
  type WalletSyncExecutionDiagnostics,
  type WorkerCircuitBreaker,
  type WorkerDiagnosticsResponse,
} from '../../internal/workerDiagnostics/protocol';
import { bucketAge, bucketCount } from '../../internal/workerDiagnostics/buckets';

export { bucketAge, bucketCount } from '../../internal/workerDiagnostics/buckets';

export interface WorkerDiagnosticsSource {
  workerStartedAt: number;
  concurrency: number;
  redisConnected: boolean;
  databaseConnected?: boolean;
  notificationConsumerRunning: boolean;
  transactionHandlerRegistered: boolean;
  notificationTelemetryWriter?: {
    observation: 'observed';
    circuit: 'closed' | 'open';
    droppedEvents: 'zero' | 'one' | 'two_to_five' | 'six_to_twenty' | 'over_twenty';
  } | { observation: 'unavailable' };
  walletSyncExecution?: WalletSyncExecutionDiagnostics;
  /** Set only when the request asked for the worker's circuit breakers. */
  circuitBreakers?: readonly WorkerCircuitBreakerSource[];
  electrum: {
    managerRunning: boolean;
    connected: boolean;
    subscriptionOwner: boolean;
    subscribedAddresses: number;
  };
  telegramCircuit?: {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    totalRequests: number;
    lastFailure: number | string | null;
    lastSuccess?: number | string | null;
    lastFailureClass?:
      | 'none'
      | 'invalid_configuration'
      | 'authentication'
      | 'permission'
      | 'rate_limited'
      | 'provider_rejected'
      | 'provider_unavailable'
      | 'timeout'
      | 'circuit_open'
      | 'network'
      | 'unknown'
      | 'other';
  };
}

export interface WorkerCircuitBreakerSource {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  totalRequests: number;
  lastFailure: string | null;
  lastSuccess: string | null;
}

/**
 * Bucket the worker's circuit breakers for the wire. A breaker whose name is
 * not a plain identifier is left out rather than failing the whole response.
 */
function bucketCircuitBreakers(
  breakers: readonly WorkerCircuitBreakerSource[],
  nowMs: number,
): WorkerCircuitBreaker[] {
  return breakers
    .filter((breaker) => WORKER_CIRCUIT_BREAKER_NAME_PATTERN.test(breaker.name))
    .slice(0, WORKER_CIRCUIT_BREAKERS_MAX)
    .map((breaker) => ({
      name: breaker.name,
      state: breaker.state,
      failures: bucketCount(breaker.failures),
      totalRequests: bucketCount(breaker.totalRequests),
      lastFailureAge: bucketAge(breaker.lastFailure, nowMs),
      lastSuccessAge: bucketAge(breaker.lastSuccess, nowMs),
    }));
}

export function buildWorkerDiagnosticsSnapshot(
  source: WorkerDiagnosticsSource,
  nowMs = Date.now(),
): WorkerDiagnosticsResponse {
  const ready = source.redisConnected && source.notificationConsumerRunning;
  const uptime = bucketAge(source.workerStartedAt, nowMs);
  return {
    protocolVersion: 1,
    sampledAt: new Date(nowMs).toISOString(),
    worker: {
      readiness: ready ? 'ready' : 'degraded',
      uptime: uptime === 'never' ? '<1m' : uptime,
      concurrency: bucketCount(source.concurrency),
    },
    notificationPipeline: {
      consumerRunning: source.notificationConsumerRunning,
      transactionHandlerRegistered: source.transactionHandlerRegistered,
    },
    redis: { state: source.redisConnected ? 'connected' : 'disconnected' },
    database: {
      state: source.databaseConnected === undefined
        ? 'unknown'
        : source.databaseConnected ? 'connected' : 'disconnected',
    },
    electrum: {
      managerRunning: source.electrum.managerRunning,
      connected: source.electrum.connected,
      subscriptionOwner: source.electrum.subscriptionOwner,
      subscribedAddresses: bucketCount(source.electrum.subscribedAddresses),
    },
    telegram: source.telegramCircuit
      ? {
          circuitState: source.telegramCircuit.state,
          failures: bucketCount(source.telegramCircuit.failures),
          totalRequests: bucketCount(source.telegramCircuit.totalRequests),
          lastFailureAge: bucketAge(source.telegramCircuit.lastFailure, nowMs),
          lastSuccessAge: bucketAge(source.telegramCircuit.lastSuccess ?? null, nowMs),
          lastFailureClass: source.telegramCircuit.lastFailureClass ?? 'unknown',
        }
      : {
          circuitState: 'not-registered',
          failures: '0',
          totalRequests: '0',
          lastFailureAge: 'never',
          lastSuccessAge: 'never',
          lastFailureClass: 'none',
        },
    notificationTelemetryWriter:
      source.notificationTelemetryWriter ?? { observation: 'unavailable' },
    ...(source.walletSyncExecution === undefined
      ? {}
      : { walletSyncExecution: source.walletSyncExecution }),
    ...(source.circuitBreakers === undefined
      ? {}
      : { circuitBreakers: bucketCircuitBreakers(source.circuitBreakers, nowMs) }),
  };
}
