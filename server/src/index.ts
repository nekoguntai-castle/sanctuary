/**
 * Sanctuary Wallet API Server
 *
 * Main entry point for the backend API server.
 * Handles Bitcoin wallet management, transactions, and user authentication.
 */

// Initialize OpenTelemetry tracing FIRST (before other imports)
// This must be at the very top to ensure auto-instrumentation works
import { initializeOpenTelemetry } from './utils/tracing/otel';

// Initialize OTEL synchronously at module load if enabled
// (actual async initialization happens in startServer)
const otelPromise = initializeOpenTelemetry();

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import config from './config';
import { registerRoutes } from './routes';
import { errorHandler, notFoundHandler } from './errors/errorHandler';
import { initializeWebSocketServer, initializeGatewayWebSocketServer } from './websocket/server';
import { initializeRedisBridge, shutdownRedisBridge } from './websocket/redisBridge';
import { notificationService } from './websocket/notifications';
import { getSyncService } from './services/syncService';
import { createLogger } from './utils/logger';
import { getErrorMessage } from './utils/errors';
import { validateEncryptionKey } from './utils/encryption';
import { requestLogger } from './middleware/requestLogger';
import { requestTimeout } from './middleware/requestTimeout';
import { defaultJsonParser, defaultUrlencodedParser } from './middleware/bodyParsing';
import { doubleCsrfProtection } from './middleware/csrf';
import { apiVersionMiddleware } from './middleware/apiVersion';
import { migrationService } from './services/migrationService';
import { getStartupStatus, isSystemDegraded } from './services/startupManager';
import { registerService, startRegisteredServices, stopRegisteredServices } from './services/serviceRegistry';
import { initializeRevocationService, shutdownRevocationService } from './services/tokenRevocation';
import { featureFlagService } from './services/featureFlagService';
import { rateLimitService } from './services/rateLimiting';
import { jobQueue } from './jobs';
import { metricsService } from './observability';
import { metricsMiddleware } from './middleware/metrics';
import { i18nMiddleware } from './middleware/i18n';
import { i18nService } from './i18n/i18nService';
import { connectWithRetry, disconnect, startDatabaseHealthCheck, stopDatabaseHealthCheck } from './models/prisma';
import { initializeRedis, shutdownRedis, isRedisConnected, shutdownDistributedLock } from './infrastructure';
import { shutdownElectrumPool } from './services/bitcoin/electrumPool';
import { cache, warmCaches } from './services/cache/cacheService';
import { walletLogBuffer } from './services/walletLogBuffer';
import { deadLetterQueue } from './services/deadLetterQueue';
import { initializeCacheInvalidation, shutdownCacheInvalidation } from './services/cacheInvalidation';
import { startWorkerHealthMonitor, stopWorkerHealthMonitor } from './services/workerHealth';
import { updateActiveStatsMetrics } from './observability/metrics/helpers';
import { getActiveStats } from './repositories/maintenanceRepository';

const log = createLogger('SERVER');

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception - process will exit', {
    error: error.message,
    stack: error.stack,
  });
  // Give time for logs to flush
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  log.error('Unhandled promise rejection', {
    reason: getErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit for unhandled rejections, but log them
  // In production, you might want to exit here too
});

// Encryption key is validated asynchronously during startup (see async IIFE below)
// to avoid blocking the event loop with scrypt key derivation.

// Initialize Express app
const app: Express = express();

// Trust first proxy (nginx) for accurate client IP in rate limiting
app.set('trust proxy', 1);

// ========================================
// MIDDLEWARE
// ========================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Required for some WebUSB hardware wallet integrations
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// CORS configuration
app.use(cors({
  origin: config.nodeEnv === 'development' ? true : config.clientUrl,
  credentials: true,
}));

// Response compression (gzip/deflate) - reduces API response sizes by 60-80%
app.use(compression({
  // Only compress responses > 1KB
  threshold: 1024,
  // Skip compression if client doesn't support it
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

// Cookie parsing — required for the browser auth cookie path (ADR 0001 / 0002).
// Mounted before body parsing and request logging so all downstream middleware
// can read req.cookies. Mobile/gateway callers do not set cookies, so this is
// a no-op on their request path.
app.use(cookieParser());

// Body parsing (10MB default; backup/restore routes use route-specific 200MB parser)
app.use(defaultJsonParser());
app.use(defaultUrlencodedParser());

// Request logging and correlation IDs
app.use(requestLogger);

// Request timeout protection (prevents hanging requests)
app.use(requestTimeout);

// Prometheus metrics collection
app.use(metricsMiddleware());

// Internationalization (locale detection from Accept-Language header)
app.use(i18nMiddleware());

// API versioning (supports Accept header, X-API-Version header, query param)
app.use('/api', apiVersionMiddleware({
  defaultVersion: 1,
  currentVersion: 1,
  minVersion: 1,
  deprecatedVersions: [],
  sunsetVersions: [],
}));

// CSRF protection for browser cookie-authenticated requests (ADR 0001 / 0002).
// Enforced only when the sanctuary_access cookie is present on a state-changing
// request; mobile/gateway Authorization-header callers bypass via the
// skipCsrfProtection check inside middleware/csrf.ts. In Phase 1 this is wired
// but no route currently issues the cookie, so it is a no-op on real traffic.
app.use(doubleCsrfProtection);

// ========================================
// ROUTES
// ========================================

registerRoutes(app);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized error handler — converts all errors to standardized ApiErrorResponse format
app.use(errorHandler);

// ========================================
// SERVER START
// ========================================

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket servers
const wsServer = initializeWebSocketServer();
const gatewayWsServer = initializeGatewayWebSocketServer();

// Handle WebSocket upgrades - route to correct server based on path
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = request.url || '';

  if (pathname === '/ws' || pathname.startsWith('/ws?')) {
    wsServer.handleUpgrade(request, socket, head);
  } else if (pathname === '/gateway' || pathname.startsWith('/gateway?')) {
    gatewayWsServer.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// Define background services with startup manager
const syncService = getSyncService();

registerService({
  name: 'notifications',
  start: () => notificationService.start(),
  stop: () => notificationService.stop(),
  critical: false,
  maxRetries: 2,
  backoffMs: [1000, 3000],
});

registerService({
  name: 'worker-heartbeat',
  start: () => startWorkerHealthMonitor(),
  stop: () => stopWorkerHealthMonitor(),
  critical: true,
  maxRetries: 10,
  backoffMs: [1000, 2000, 5000, 10000],
});

registerService({
  name: 'sync',
  start: () => syncService.start(),
  stop: () => syncService.stop(),
  critical: false,
  maxRetries: 3,
  backoffMs: [2000, 5000, 10000],
});
log.info('Worker-owned architecture: in-process maintenance fallback disabled');

// Run database connection and migrations before starting server
(async () => {
  try {
    const startupTimer = Date.now();

    // Derive encryption key using async scrypt (avoids blocking event loop)
    try {
      await validateEncryptionKey();
    } catch (error) {
      log.error('FATAL: Missing required environment variable', {
        error: getErrorMessage(error),
        hint: 'Please set ENCRYPTION_KEY in your .env file (at least 32 characters)',
      });
      process.exit(1);
    }

    // Wait for OpenTelemetry initialization (if enabled)
    await otelPromise;

    // Connect to database with retry logic (required first)
    await connectWithRetry();

    // Phase 1: Initialize services that only need database (parallel)
    log.info('Initializing core services...');
    await Promise.all([
      // These run in parallel - no interdependencies
      (async () => { startDatabaseHealthCheck(); })(),
      (async () => { initializeRevocationService(); })(),
      (async () => { metricsService.initialize(); })(),
      initializeRedis(), // Redis init
    ]);

    // Phase 2: Initialize services that need Redis (parallel)
    log.info('Initializing Redis-dependent services...');
    const redisDependentTasks: Promise<unknown>[] = [
      initializeRedisBridge(),
      (async () => { initializeCacheInvalidation(); })(),
      (async () => { rateLimitService.initialize(); })(),
      (async () => { deadLetterQueue.start(); })(),
    ];

    log.info('Worker-owned architecture: skipping local job queue initialization');

    await Promise.all(redisDependentTasks);

    // Phase 3: Schedule jobs + initialize remaining services (parallel)
    log.info('Scheduling jobs and finalizing services...');
    await Promise.all([
      i18nService.initialize(),
      featureFlagService.initialize(),
    ]);

    log.info(`Service initialization completed in ${Date.now() - startupTimer}ms`);

    log.info('Checking database migrations...');
    const migrationResult = await migrationService.runMigrations();

    // Warm caches after all services are initialized (reduces cold-start latency)
    // This runs before server starts accepting requests
    await warmCaches();

    if (!migrationResult.success) {
      log.error('Database migration failed - server may not function correctly', {
        error: migrationResult.error,
      });
      // Continue anyway - some functionality may still work
    }

    // Start listening
    httpServer.listen(config.port, async () => {
      log.info('Sanctuary Wallet API Server starting');
      log.info(`Environment: ${config.nodeEnv}`);
      log.info(`Server: ${config.apiUrl}`);
      log.info(`Client: ${config.clientUrl}`);
      log.info(`Network: ${config.bitcoin.network}`);
      log.info(`Redis: ${isRedisConnected() ? 'connected' : 'in-memory fallback'}`);
      log.info(`HTTP Server running on port ${config.port}`);
      log.info(`WebSocket Server running on ws://localhost:${config.port}/ws`);

      // Start background services with resilient startup manager
      try {
        const startupResults = await startRegisteredServices();
        const startupStatus = getStartupStatus();

        for (const result of startupResults) {
          if (result.started) {
            log.info(`Service ${result.name} running`);
          } else if (result.degraded) {
            log.warn(`Service ${result.name} failed (degraded mode)`, { error: result.error });
          }
        }

        if (isSystemDegraded()) {
          log.warn('System running in degraded mode - some services failed to start');
        }

        log.info('All background services initialization complete', {
          duration: startupStatus.duration,
          started: startupResults.filter(r => r.started).length,
          degraded: startupResults.filter(r => r.degraded).length,
        });
      } catch (err) {
        log.error('Critical service startup failure', { error: getErrorMessage(err) });
        process.exit(1);
      }

      // Periodically update active user/wallet gauges for Prometheus (every 60s)
      activeStatsTimer = setInterval(async () => {
        try {
          const stats = await getActiveStats();
          updateActiveStatsMetrics(stats.activeUserCount, stats.activeWalletCount);
        } catch (error) {
          log.debug('Active stats metrics update failed', { error: getErrorMessage(error) });
        }
      }, 60_000);

      // Log final migration status
      await migrationService.logMigrationStatus();
    });
  } catch (error) {
    log.error('Failed to start server', {
      error: getErrorMessage(error),
    });
    process.exit(1);
  }
})();

// Graceful shutdown configuration
const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds to drain connections
let isShuttingDown = false;
let activeStatsTimer: NodeJS.Timeout | null = null;

// Graceful shutdown handler with connection draining
const handleShutdown = async (signal: string) => {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    log.warn(`${signal} received again, already shutting down...`);
    return;
  }
  isShuttingDown = true;

  log.info(`${signal} received, starting graceful shutdown (${SHUTDOWN_TIMEOUT_MS / 1000}s timeout)...`);

  // Set a hard timeout - force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Don't let this timeout keep the process alive if everything else closes
  forceExitTimeout.unref();

  // Stop metrics timer
  if (activeStatsTimer) {
    clearInterval(activeStatsTimer);
    activeStatsTimer = null;
  }

  // Close WebSocket servers first (stop accepting new connections)
  wsServer.close();
  gatewayWsServer.close();

  // Stop background services
  await stopRegisteredServices();
  stopDatabaseHealthCheck();
  shutdownRevocationService();
  rateLimitService.shutdown();

  // Stop memory caches and buffers
  cache.stop();
  walletLogBuffer.stop();
  deadLetterQueue.stop();

  // Close Electrum connection pool
  try {
    await shutdownElectrumPool();
    log.info('Electrum pool closed');
  } catch (error) {
    log.error('Error closing Electrum pool', {
      error: getErrorMessage(error),
    });
  }

  // Shutdown job queue
  await jobQueue.shutdown();

  // Shutdown distributed lock infrastructure
  shutdownDistributedLock();

  // Shutdown cache invalidation (before Redis shutdown)
  shutdownCacheInvalidation();

  // Shutdown Redis WebSocket bridge
  await shutdownRedisBridge();

  // Shutdown Redis infrastructure
  await shutdownRedis();

  // Close database connection
  try {
    await disconnect();
  } catch (error) {
    log.error('Error disconnecting from database', {
      error: getErrorMessage(error),
    });
  }

  // Close HTTP server and wait for active connections to drain
  httpServer.close(() => {
    clearTimeout(forceExitTimeout);
    log.info('Server closed gracefully');
    process.exit(0);
  });
};

// Graceful shutdown on SIGTERM and SIGINT
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default app;
