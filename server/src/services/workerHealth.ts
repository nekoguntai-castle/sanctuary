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

interface Monitor {
  healthUrl: string;
  healthTimeoutMs: number;
  timer?: NodeJS.Timeout;
  activeCheck?: Promise<boolean>;
  startup?: Promise<void>;
}

let monitor: Monitor | undefined;

function resetState(): void {
  state.healthy = false;
  state.running = false;
  state.status = 'unknown';
  state.failures = 0;
  state.lastCheckedAt = null;
  state.lastHealthyAt = null;
  state.responseTimeMs = null;
  state.error = undefined;
  state.worker = undefined;
}

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

function logHealthTransition(
  healthy: boolean,
  healthUrl: string,
  responseTimeMs: number,
  httpStatus: number,
  payload: WorkerHealthPayload | undefined,
): void {
  if (healthy) {
    log.info('Worker health restored', {
      url: healthUrl,
      latencyMs: responseTimeMs,
    });
  } else {
    log.warn('Worker health degraded', {
      url: healthUrl,
      httpStatus,
      workerStatus: payload?.status,
      failures: state.failures,
    });
  }
}

function recordResponse(
  response: Response,
  payload: WorkerHealthPayload | undefined,
  healthUrl: string,
  startedAt: number,
  previousHealthy: boolean,
): boolean {
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
    logHealthTransition(healthy, healthUrl, responseTimeMs, response.status, payload);
  }

  return healthy;
}

async function checkHealth(owner: Monitor): Promise<boolean> {
  const { healthUrl, healthTimeoutMs } = owner;
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

    if (monitor !== owner) {
      return false;
    }

    return recordResponse(response, payload, healthUrl, startedAt, previousHealthy);
  } catch (error) {
    if (monitor !== owner) {
      return false;
    }

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
}

function runHealthCheck(owner: Monitor): Promise<boolean> {
  owner.activeCheck ??= checkHealth(owner).finally(() => {
    owner.activeCheck = undefined;
  });
  return owner.activeCheck;
}

/**
 * Start worker health monitoring.
 * Throws on initial health check failure so startup manager can retry/fail fast.
 */
export async function startWorkerHealthMonitor(): Promise<void> {
  if (monitor) {
    log.info('Worker health monitor already running');
    return monitor.startup;
  }

  const { healthUrl, healthTimeoutMs, healthCheckIntervalMs } = getConfig().worker;
  const owner: Monitor = { healthUrl, healthTimeoutMs };
  monitor = owner;
  owner.startup = startPolling(owner, healthCheckIntervalMs);
  return owner.startup;
}

async function startPolling(owner: Monitor, healthCheckIntervalMs: number): Promise<void> {
  state.running = true;
  const initialHealthy = await runHealthCheck(owner);
  if (monitor !== owner) return;

  if (!initialHealthy) {
    monitor = undefined;
    state.running = false;
    throw new Error(`Worker health check failed at startup: ${state.error ?? 'unknown error'}`);
  }

  owner.timer = setInterval(() => {
    void runHealthCheck(owner);
  }, healthCheckIntervalMs);
  owner.timer.unref?.();

  log.info('Worker health monitor started', {
    url: owner.healthUrl,
    intervalMs: healthCheckIntervalMs,
    timeoutMs: owner.healthTimeoutMs,
  });
}

/**
 * Stop worker health monitoring.
 */
export async function stopWorkerHealthMonitor(): Promise<void> {
  const stopped = monitor;
  monitor = undefined;
  if (stopped?.timer) clearInterval(stopped.timer);
  resetState();
  await stopped?.activeCheck;
  log.info('Worker health monitor stopped');
}

/**
 * Get the latest known worker health status.
 */
export function getWorkerHealthStatus(): WorkerHealthStatus {
  return cloneStatus();
}
