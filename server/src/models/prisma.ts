/**
 * Prisma Client Instance
 *
 * Singleton instance of Prisma Client for database operations.
 *
 * Features:
 * - PostgreSQL driver adapter (Prisma 7)
 * - Query extension for slow query detection and metrics
 * - Connection retry logic for startup resilience
 * - Graceful shutdown handling
 * - Periodic health check with auto-reconnection
 *
 * Connection pool and timeouts are configured via DATABASE_URL:
 * postgresql://user:pass@host:5432/db?connection_limit=30&pool_timeout=30&connect_timeout=10&statement_timeout=30000
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { dbQueryDuration } from '../observability/metrics';
import { resolvePrismaTransactionTimeoutOptions } from './prismaTransactionOptions';
export {
  resolvePrismaTransactionTimeoutOptions,
  type PrismaTransactionTimeoutEnv,
  type PrismaTransactionTimeoutOptions,
} from './prismaTransactionOptions';

const log = createLogger('INFRA:DB');

/**
 * Parse a positive-integer ms threshold from a raw env value.
 * Exported for unit testing; consumers should read SLOW_QUERY_THRESHOLD_MS instead.
 * @internal
 */
export function parseSlowQueryThresholdMs(raw: string | undefined): number {
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

// Slow query threshold in milliseconds. Configurable via SLOW_QUERY_THRESHOLD_MS env.
// Default of 50ms surfaces regressions in the 50-100ms band that the previous
// 100ms default silently dropped.
const SLOW_QUERY_THRESHOLD_MS = parseSlowQueryThresholdMs(process.env.SLOW_QUERY_THRESHOLD_MS);
const PRISMA_TRANSACTION_TIMEOUT_OPTIONS = resolvePrismaTransactionTimeoutOptions(process.env);

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
let lastDatabaseHealth: boolean | null = null;

// Create PostgreSQL adapter
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL || '',
});

/**
 * Map Prisma actions to operation categories for metrics
 * @internal Exported for testing
 */
export function getOperationType(action: string): string {
  if (['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'].includes(action)) {
    return 'select';
  }
  if (['create', 'createMany'].includes(action)) {
    return 'insert';
  }
  if (['update', 'updateMany', 'upsert'].includes(action)) {
    return 'update';
  }
  if (['delete', 'deleteMany'].includes(action)) {
    return 'delete';
  }
  return 'other';
}

// Rolling window for latency tracking (pool health watchdog)
const LATENCY_WINDOW_SIZE = 100;
const latencyWindow: number[] = [];

// Active query counter for connection draining on shutdown
let activeQueries = 0;

// Create Prisma client with query extension for metrics and slow query detection
const prisma = new PrismaClient({
  adapter,
  ...(PRISMA_TRANSACTION_TIMEOUT_OPTIONS === undefined
    ? {}
    : { transactionOptions: PRISMA_TRANSACTION_TIMEOUT_OPTIONS }),
}).$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        activeQueries++;
        const before = Date.now();
        try {
          const result = await query(args);
          const duration = Date.now() - before;

          // Record query duration metric
          const op = getOperationType(operation);
          dbQueryDuration.observe({ operation: op }, duration / 1000);

          // Record for pool health monitoring
          latencyWindow.push(duration);
          if (latencyWindow.length > LATENCY_WINDOW_SIZE) {
            latencyWindow.shift();
          }

          if (duration > SLOW_QUERY_THRESHOLD_MS) {
            log.warn(`Slow query (${duration}ms): ${model}.${operation}`, {
              model,
              action: operation,
              duration,
            });
          }

          return result;
        } finally {
          activeQueries--;
        }
      },
    },
  },
});

/**
 * Parse the connection-pool params we care about out of a DATABASE_URL so a
 * mis-tuned pool surfaces in startup logs instead of as a mystery stall.
 * Exported for unit testing.
 * @internal
 */
export function summarizeDatabaseUrlParams(
  databaseUrl: string | undefined,
): Record<string, string | undefined> {
  try {
    const url = new URL(databaseUrl || '');
    return {
      connection_limit: url.searchParams.get('connection_limit') ?? undefined,
      pool_timeout: url.searchParams.get('pool_timeout') ?? undefined,
      connect_timeout: url.searchParams.get('connect_timeout') ?? undefined,
      statement_timeout: url.searchParams.get('statement_timeout') ?? undefined,
    };
  } catch {
    return {};
  }
}

function waitForDatabaseRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Connect to the database with exponential-backoff retries.
 * When a signal is provided, aborting it cancels pending retry delays and
 * prevents an in-flight connection result from publishing health state.
 */
export async function connectWithRetry(signal?: AbortSignal): Promise<void> {
  let lastError: Error | null = null;

  const poolParams = summarizeDatabaseUrlParams(process.env.DATABASE_URL);
  log.info('Database connection pool configuration', {
    slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
    transactionMaxWaitMs: PRISMA_TRANSACTION_TIMEOUT_OPTIONS?.maxWait,
    transactionTimeoutMs: PRISMA_TRANSACTION_TIMEOUT_OPTIONS?.timeout,
    ...poolParams,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    signal?.throwIfAborted();
    try {
      log.info(`Connecting to database (attempt ${attempt}/${MAX_RETRIES})...`);
      await prisma.$connect();
      signal?.throwIfAborted();
      lastDatabaseHealth = true;
      log.info('Database connection established');
      return;
    } catch (error) {
      signal?.throwIfAborted();
      lastDatabaseHealth = false;
      lastError = error as Error;
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
        MAX_RETRY_DELAY_MS
      );

      if (attempt < MAX_RETRIES) {
        log.warn(`Database connection failed, retrying in ${delay}ms...`, {
          attempt,
          maxRetries: MAX_RETRIES,
          error: lastError.message,
        });
        await waitForDatabaseRetry(delay, signal);
      }
    }
  }

  log.error('Failed to connect to database after all retries', {
    maxRetries: MAX_RETRIES,
    error: lastError?.message,
  });
  throw lastError;
}

/**
 * Check database health
 * Returns true if database is accessible
 */
type DatabaseHealthProbe =
  | { healthy: true }
  | { healthy: false; error: unknown };

async function probeDatabaseHealth(): Promise<DatabaseHealthProbe> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error };
  }
}

function publishDatabaseHealth(probe: DatabaseHealthProbe): boolean {
  lastDatabaseHealth = probe.healthy;
  if (!probe.healthy) {
    log.error('Database health check failed', {
      error: getErrorMessage(probe.error),
    });
  }
  return probe.healthy;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  return publishDatabaseHealth(await probeDatabaseHealth());
}

/** Last connection/health fact observed by this process; null until observed. */
export function getLastDatabaseHealth(): boolean | null {
  return lastDatabaseHealth;
}

/**
 * Get database connection info for health endpoints
 */
export async function getDatabaseInfo(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: getErrorMessage(error),
    };
  }
}

// Maximum time to wait for active queries to complete during shutdown
const DRAIN_TIMEOUT_MS = 10_000;

/**
 * Graceful disconnect with connection draining.
 * Waits up to 10 seconds for in-flight queries to complete before disconnecting.
 */
export async function disconnect(): Promise<void> {
  log.info('Disconnecting from database...');

  // Wait for active queries to complete
  if (activeQueries > 0) {
    log.info(`Draining ${activeQueries} active queries (timeout: ${DRAIN_TIMEOUT_MS / 1000}s)...`);
    const drainStart = Date.now();

    while (activeQueries > 0 && (Date.now() - drainStart) < DRAIN_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (activeQueries > 0) {
      log.warn(`Force disconnecting with ${activeQueries} queries still active`);
    } else {
      log.info('All queries drained successfully');
    }
  }

  await prisma.$disconnect();
  lastDatabaseHealth = false;
  log.info('Database disconnected');
}

// Database health check and reconnection
/** Per-run ownership keeps stopped work from mutating a replacement monitor. */
interface DatabaseHealthMonitorRun {
  intervalMs: number;
  abortController: AbortController;
  timeout: NodeJS.Timeout | null;
  cyclePromise: Promise<void> | null;
  stopPromise: Promise<void> | null;
  stopping: boolean;
  consecutiveFailures: number;
}

let databaseHealthMonitor: DatabaseHealthMonitorRun | null = null;
const MAX_HEALTH_CHECK_INTERVAL_MS = 300_000; // 5 min cap

// =============================================================================
// Pool Health Watchdog
// =============================================================================

/**
 * Pool health metrics for monitoring
 */
export interface PoolHealthMetrics {
  /** Average query latency in ms */
  avgLatencyMs: number;
  /** Max query latency in ms */
  maxLatencyMs: number;
  /** Number of queries in the sample window */
  queryCount: number;
  /** Health status based on latency thresholds */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Warning message if status is not healthy */
  warning?: string;
}

// Pool health thresholds
let poolWarningThresholdMs = 100; // Warn if avg latency exceeds this
let poolCriticalThresholdMs = 500; // Critical if avg latency exceeds this

/**
 * Get pool health metrics
 */
export function getPoolHealthMetrics(): PoolHealthMetrics {
  if (latencyWindow.length === 0) {
    return {
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      queryCount: 0,
      status: 'healthy',
    };
  }

  const avgLatencyMs = latencyWindow.reduce((a, b) => a + b, 0) / latencyWindow.length;
  const maxLatencyMs = Math.max(...latencyWindow);

  let status: PoolHealthMetrics['status'] = 'healthy';
  let warning: string | undefined;

  if (avgLatencyMs > poolCriticalThresholdMs) {
    status = 'unhealthy';
    warning = `Average query latency ${avgLatencyMs.toFixed(0)}ms exceeds critical threshold ${poolCriticalThresholdMs}ms`;
  } else if (avgLatencyMs > poolWarningThresholdMs) {
    status = 'degraded';
    warning = `Average query latency ${avgLatencyMs.toFixed(0)}ms exceeds warning threshold ${poolWarningThresholdMs}ms`;
  }

  return {
    avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
    maxLatencyMs,
    queryCount: latencyWindow.length,
    status,
    warning,
  };
}

/**
 * Configure pool health thresholds
 */
export function configurePoolHealthThresholds(options: {
  warningThresholdMs?: number;
  criticalThresholdMs?: number;
}): void {
  if (options.warningThresholdMs !== undefined) {
    poolWarningThresholdMs = options.warningThresholdMs;
  }
  if (options.criticalThresholdMs !== undefined) {
    poolCriticalThresholdMs = options.criticalThresholdMs;
  }
}

function isActiveDatabaseHealthMonitor(run: DatabaseHealthMonitorRun): boolean {
  return databaseHealthMonitor === run && !run.stopping;
}

function getNextDatabaseHealthCheckDelay(run: DatabaseHealthMonitorRun): number {
  if (run.consecutiveFailures === 0) return run.intervalMs;
  return Math.min(
    run.intervalMs * Math.pow(2, run.consecutiveFailures),
    MAX_HEALTH_CHECK_INTERVAL_MS,
  );
}

async function runDatabaseHealthCheckCycle(run: DatabaseHealthMonitorRun): Promise<void> {
  const probe = await probeDatabaseHealth();
  // A stop or replacement revokes this run while any awaited I/O is pending.
  // Publish state, log, reconnect, and reschedule only while this run still owns the monitor.
  if (!isActiveDatabaseHealthMonitor(run)) return;
  const isHealthy = publishDatabaseHealth(probe);

  if (isHealthy) {
    if (run.consecutiveFailures > 0) {
      log.info(`Database health restored after ${run.consecutiveFailures} consecutive failures`);
    }
    run.consecutiveFailures = 0;
    return;
  }

  run.consecutiveFailures++;
  const nextDelay = getNextDatabaseHealthCheckDelay(run);
  log.warn(`Database connection lost, attempting reconnect`, {
    consecutiveFailures: run.consecutiveFailures,
    nextCheckIn: `${Math.round(nextDelay / 1000)}s`,
  });

  try {
    await prisma.$disconnect();
    if (!isActiveDatabaseHealthMonitor(run)) return;
    await connectWithRetry(run.abortController.signal);
    log.info('Database reconnection successful');
    run.consecutiveFailures = 0;
  } catch (error) {
    if (isActiveDatabaseHealthMonitor(run)) {
      log.error('Database reconnection failed', {
        error: getErrorMessage(error),
      });
    }
  }
}

function scheduleDatabaseHealthCheck(run: DatabaseHealthMonitorRun): void {
  if (!isActiveDatabaseHealthMonitor(run)) return;

  run.timeout = setTimeout(async () => {
    run.timeout = null;
    const cyclePromise = runDatabaseHealthCheckCycle(run);
    run.cyclePromise = cyclePromise;

    try {
      await cyclePromise;
    } finally {
      run.cyclePromise = null;
    }

    // Cycles are serialized: the next timer is armed only after this cycle settles.
    scheduleDatabaseHealthCheck(run);
  }, getNextDatabaseHealthCheckDelay(run));

  run.timeout.unref();
}

/**
 * Start database health check monitoring after any stopping run drains.
 * Concurrent starts create one run. Health failures use exponential backoff,
 * capped at five minutes, and a successful check resets the base interval.
 */
export async function startDatabaseHealthCheck(intervalMs: number = 30000): Promise<void> {
  const currentRun = databaseHealthMonitor;
  if (currentRun) {
    if (!currentRun.stopping) return;
    await currentRun.stopPromise;
    // Concurrent restart requests share the stop barrier; only the first creates a run.
    if (databaseHealthMonitor) return;
  }

  const run: DatabaseHealthMonitorRun = {
    intervalMs,
    abortController: new AbortController(),
    timeout: null,
    cyclePromise: null,
    stopPromise: null,
    stopping: false,
    consecutiveFailures: 0,
  };
  databaseHealthMonitor = run;
  scheduleDatabaseHealthCheck(run);
  log.debug('Database health check monitoring started');
}

/**
 * Stop database health check monitoring.
 *
 * Invalidates scheduled and reconnect work synchronously. The returned promise
 * resolves after the current cycle settles and must be awaited before the final
 * database disconnect. Repeated stops share the same drain promise.
 */
export function stopDatabaseHealthCheck(): Promise<void> {
  const run = databaseHealthMonitor;
  if (!run) return Promise.resolve();
  if (run.stopPromise) return run.stopPromise;

  run.stopping = true;
  run.abortController.abort();
  if (run.timeout) {
    clearTimeout(run.timeout);
    run.timeout = null;
  }

  run.stopPromise = (async () => {
    if (run.cyclePromise) {
      await run.cyclePromise;
    }
    databaseHealthMonitor = null;
    log.debug('Database health check monitoring stopped');
  })();

  return run.stopPromise;
}

// Handle cleanup on shutdown. beforeExit may fire again if cleanup schedules work.
let beforeExitCleanupStarted = false;
process.on('beforeExit', async () => {
  if (beforeExitCleanupStarted) return;
  beforeExitCleanupStarted = true;
  await stopDatabaseHealthCheck();
  await disconnect();
});

/**
 * Prisma interactive-transaction client type.
 * Use this for functions that receive the `tx` parameter inside `prisma.$transaction()`.
 */
export type PrismaTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Execute a callback inside a default-isolation Prisma transaction.
 * Use this for services that need atomic multi-model operations.
 */
export async function withTransaction<T>(
  fn: (tx: PrismaTxClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn);
}

export default prisma;
