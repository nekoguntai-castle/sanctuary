import type {
  WalletSyncExecutionDiagnostics,
  WorkerDiagnosticsResponse,
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
  };
}
