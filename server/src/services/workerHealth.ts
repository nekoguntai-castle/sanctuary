/**
 * Worker Health Monitor
 *
 * Periodically checks the background worker health endpoint so the API can
 * expose a single top-level health signal.
 */

import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('WORKER_HEALTH:SVC');

type WorkerHealthLevel = 'unknown' | 'healthy' | 'degraded' | 'unreachable';

interface WorkerHealthPayload {
  status?: string;
  components?: Record<string, unknown>;
  timestamp?: string;
}

interface WorkerHealthDetails {
  status?: string;
  components?: Record<string, unknown>;
  timestamp?: string;
  httpStatus?: number;
}

export interface WorkerHealthStatus {
  healthy: boolean;
  running: boolean;
  status: WorkerHealthLevel;
  failures: number;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  responseTimeMs: number | null;
  error?: string;
  worker?: WorkerHealthDetails;
}

const state: WorkerHealthStatus = {
  healthy: false,
  running: false,
  status: 'unknown',
  failures: 0,
  lastCheckedAt: null,
  lastHealthyAt: null,
  responseTimeMs: null,
};

let monitorTimer: NodeJS.Timeout | null = null;
let activeCheck: Promise<boolean> | null = null;

function cloneStatus(): WorkerHealthStatus {
  const worker = state.worker
    ? {
        ...state.worker,
        components: state.worker.components ? { ...state.worker.components } : undefined,
      }
    : undefined;

  return {
    ...state,
    worker,
  };
}

function parseWorkerPayload(payload: unknown): WorkerHealthPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const value = payload as Record<string, unknown>;

  return {
    status: typeof value.status === 'string' ? value.status : undefined,
    components: value.components && typeof value.components === 'object'
      ? value.components as Record<string, unknown>
      : undefined,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : undefined,
  };
}

async function runHealthCheck(): Promise<boolean> {
  if (activeCheck) {
    return activeCheck;
  }

  activeCheck = (async () => {
    const { healthUrl, healthTimeoutMs } = getConfig().worker;
    const startedAt = Date.now();
    const previousHealthy = state.healthy;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(healthTimeoutMs),
      });

      let payload: WorkerHealthPayload | undefined;
      try {
        payload = parseWorkerPayload(await response.json());
      } catch (error) {
        log.debug('Failed to parse worker health payload (non-critical)', { error: getErrorMessage(error) });
        payload = undefined;
      }

      const now = new Date().toISOString();
      const responseTimeMs = Date.now() - startedAt;
      const responseStatus = payload?.status?.toLowerCase();
      const explicitlyDegraded = responseStatus === 'degraded' || responseStatus === 'error' || responseStatus === 'unhealthy';
      const healthy = response.ok && !explicitlyDegraded;

      state.healthy = healthy;
      state.status = healthy ? 'healthy' : (response.ok ? 'degraded' : 'unreachable');
      state.lastCheckedAt = now;
      state.responseTimeMs = responseTimeMs;
      state.error = healthy
        ? undefined
        : `Worker health endpoint returned ${response.status}${payload?.status ? ` (${payload.status})` : ''}`;
      state.worker = {
        status: payload?.status,
        components: payload?.components,
        timestamp: payload?.timestamp,
        httpStatus: response.status,
      };

      if (healthy) {
        state.lastHealthyAt = now;
        state.failures = 0;
      } else {
        state.failures += 1;
      }

      if (previousHealthy !== healthy) {
        if (healthy) {
          log.info('Worker health restored', {
            url: healthUrl,
            latencyMs: responseTimeMs,
          });
        } else {
          log.warn('Worker health degraded', {
            url: healthUrl,
            httpStatus: response.status,
            workerStatus: payload?.status,
            failures: state.failures,
          });
        }
      }

      return healthy;
    } catch (error) {
      const now = new Date().toISOString();
      const responseTimeMs = Date.now() - startedAt;
      const errorMessage = getErrorMessage(error);

      state.healthy = false;
      state.status = 'unreachable';
      state.failures += 1;
      state.lastCheckedAt = now;
      state.responseTimeMs = responseTimeMs;
      state.error = errorMessage;
      state.worker = undefined;

      if (previousHealthy) {
        log.warn('Worker health became unreachable', {
          url: healthUrl,
          error: errorMessage,
          failures: state.failures,
        });
      }

      return false;
    }
  })();

  try {
    return await activeCheck;
  } finally {
    activeCheck = null;
  }
}

/**
 * Start worker health monitoring.
 * Throws on initial health check failure so startup manager can retry/fail fast.
 */
export async function startWorkerHealthMonitor(): Promise<void> {
  if (monitorTimer) {
    log.info('Worker health monitor already running');
    return;
  }

  const { healthCheckIntervalMs, healthUrl, healthTimeoutMs } = getConfig().worker;

  state.running = true;
  const initialHealthy = await runHealthCheck();

  if (!initialHealthy) {
    state.running = false;
    throw new Error(`Worker health check failed at startup: ${state.error ?? 'unknown error'}`);
  }

  monitorTimer = setInterval(() => {
    void runHealthCheck();
  }, healthCheckIntervalMs);
  monitorTimer.unref?.();

  log.info('Worker health monitor started', {
    url: healthUrl,
    intervalMs: healthCheckIntervalMs,
    timeoutMs: healthTimeoutMs,
  });
}

/**
 * Stop worker health monitoring.
 */
export async function stopWorkerHealthMonitor(): Promise<void> {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }

  state.running = false;

  if (activeCheck) {
    try {
      await activeCheck;
    } catch (error) {
      /* v8 ignore next -- stop-time active health check failures are best-effort logging only */
      log.debug('Active health check failed during stop', { error: String(error) });
    }
  }

  log.info('Worker health monitor stopped');
}

/**
 * Get the latest known worker health status.
 */
export function getWorkerHealthStatus(): WorkerHealthStatus {
  return cloneStatus();
}
