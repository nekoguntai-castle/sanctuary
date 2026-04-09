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

const log = createLogger('INFRA:DB');

// Slow query threshold in milliseconds
const SLOW_QUERY_THRESHOLD_MS = 100;

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

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
const prisma = new PrismaClient({ adapter }).$extends({
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
 * Connect to database with retry logic
 * Implements exponential backoff for resilience during startup
 */
export async function connectWithRetry(): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.info(`Connecting to database (attempt ${attempt}/${MAX_RETRIES})...`);
      await prisma.$connect();
      log.info('Database connection established');
      return;
    } catch (error) {
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
        await new Promise((resolve) => setTimeout(resolve, delay));
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
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Database health check failed', {
      error: getErrorMessage(error),
    });
    return false;
  }
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
  log.info('Database disconnected');
}

// Database health check and reconnection
let healthCheckTimeout: NodeJS.Timeout | null = null;
// Promise-based guard: prevents concurrent reconnection attempts.
// Concurrent callers see a non-null promise and skip, avoiding duplicate reconnects.
let reconnectingPromise: Promise<void> | null = null;
let consecutiveHealthFailures = 0;
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

/**
 * Start database health check monitoring
 * Periodically checks connection and reconnects if needed.
 * Uses exponential backoff on consecutive failures: base → 2x → 4x → ... → 300s max.
 * Resets to base interval on successful health check.
 */
export function startDatabaseHealthCheck(intervalMs: number = 30000): void {
  if (healthCheckTimeout) {
    return; // Already running
  }

  function getNextDelay(): number {
    if (consecutiveHealthFailures === 0) return intervalMs;
    return Math.min(
      intervalMs * Math.pow(2, consecutiveHealthFailures),
      MAX_HEALTH_CHECK_INTERVAL_MS,
    );
  }

  function scheduleNext(): void {
    const delay = getNextDelay();
    healthCheckTimeout = setTimeout(async () => {
      const isHealthy = await checkDatabaseHealth();

      if (isHealthy) {
        if (consecutiveHealthFailures > 0) {
          log.info(`Database health restored after ${consecutiveHealthFailures} consecutive failures`);
        }
        consecutiveHealthFailures = 0;
      } else if (!reconnectingPromise) {
        consecutiveHealthFailures++;
        const nextDelay = getNextDelay();
        log.warn(`Database connection lost, attempting reconnect`, {
          consecutiveFailures: consecutiveHealthFailures,
          nextCheckIn: `${Math.round(nextDelay / 1000)}s`,
        });

        reconnectingPromise = (async () => {
          try {
            await prisma.$disconnect();
            await connectWithRetry();
            log.info('Database reconnection successful');
            consecutiveHealthFailures = 0;
          } catch (error) {
            log.error('Database reconnection failed', {
              error: getErrorMessage(error),
            });
          } finally {
            reconnectingPromise = null;
          }
        })();

        await reconnectingPromise;
      }

      scheduleNext();
    }, delay);

    healthCheckTimeout.unref();
  }

  scheduleNext();
  log.debug('Database health check monitoring started');
}

/**
 * Stop database health check monitoring
 */
export function stopDatabaseHealthCheck(): void {
  if (healthCheckTimeout) {
    clearTimeout(healthCheckTimeout);
    healthCheckTimeout = null;
    consecutiveHealthFailures = 0;
    log.debug('Database health check monitoring stopped');
  }
}

// Handle cleanup on shutdown
process.on('beforeExit', async () => {
  stopDatabaseHealthCheck();
  await prisma.$disconnect();
});

/**
 * Prisma interactive-transaction client type.
 * Use this for functions that receive the `tx` parameter inside `prisma.$transaction()`.
 */
export type PrismaTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export default prisma;
