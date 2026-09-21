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
import expressRateLimit from 'express-rate-limit';
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
import { createLogger } from './utils/logger';
import { getErrorMessage } from './utils/errors';
import { exitNow } from './utils/processExit';
import { registerFatalProcessHandlers } from './utils/fatalProcessHandlers';
import { validateEncryptionKey } from './utils/encryption';
import { requestLogger } from './middleware/requestLogger';
import { requestTimeout } from './middleware/requestTimeout';
import { defaultJsonParser, defaultUrlencodedParser } from './middleware/bodyParsing';
import { csrfRecoveryErrorHandler, doubleCsrfProtection } from './middleware/csrf';
import { createServerCorsOptionsDelegate } from './middleware/corsOrigin';
import { apiVersionMiddleware } from './middleware/apiVersion';
import { getStartupStatus, isSystemDegraded } from './services/startupManager';
import { startRegisteredServices, stopRegisteredServices } from './services/serviceRegistry';
import { registerServerBackgroundServices } from './services/serverBackgroundServices';
import { featureFlagService } from './services/featureFlagService';
import { rateLimitService } from './services/rateLimiting';
import { jobQueue } from './jobs';
import { metricsService } from './observability';
import { metricsMiddleware } from './middleware/metrics';
import { i18nMiddleware } from './middleware/i18n';
import { i18nService } from './i18n/i18nService';
import { connectWithRetry, disconnect, startDatabaseHealthCheck, stopDatabaseHealthCheck } from './models/prisma';
import {
  initializeDistributedLock,
  initializeRedis,
  shutdownDistributedLock,
  shutdownRedis,
  isRedisConnected,
} from './infrastructure';
import { shutdownElectrumPool } from './services/bitcoin/electrumPool';
import { cache } from './services/cache/cacheService';
import { warmCaches } from './services/cache/cacheWarmer';
import { walletLogBuffer } from './services/walletLogBuffer';
import { deadLetterQueue } from './services/deadLetterQueue';
import { initializeCacheInvalidation, shutdownCacheInvalidation } from './services/cacheInvalidation';
import { updateActiveStatsMetrics } from './observability/metrics/helpers';
import { getActiveStats } from './repositories/maintenanceRepository';
import {
  initializeNotificationTelemetry,
  shutdownNotificationTelemetry,
} from './services/notifications/telemetry';
import { shutdownNotificationDeadLetterAggregateWriter } from './services/notifications/deadLetterAggregates';
import { createHttpServerDrain } from './utils/httpServerDrain';
import {
  createGracefulShutdownHandler,
  registerGracefulShutdownHandlers,
} from './utils/gracefulShutdown';

const log = createLogger('SERVER');
const COARSE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

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
app.use(cors(createServerCorsOptionsDelegate({
  allowedOrigins: config.corsAllowedOrigins,
  clientUrl: config.clientUrl,
  nodeEnv: config.nodeEnv,
})));

// Coarse per-IP safety valve for private/self-hosted deployments. The
// Redis-backed route policies remain the canonical fine-grained controls.
app.use('/api', expressRateLimit({
  windowMs: COARSE_RATE_LIMIT_WINDOW_MS,
  max: config.rateLimit.apiDefaultLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    error: 'Too Many Requests',
    message: 'API request rate limit exceeded. Please slow down.',
  },
}));

app.use('/internal', expressRateLimit({
  windowMs: COARSE_RATE_LIMIT_WINDOW_MS,
  max: config.rateLimit.apiDefaultLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    error: 'Too Many Requests',
    message: 'Internal API request rate limit exceeded. Please slow down.',
  },
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
app.use(csrfRecoveryErrorHandler);

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
const httpServerDrain = createHttpServerDrain(httpServer, [wsServer, gatewayWsServer]);

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

// Define background services with startup manager.
registerServerBackgroundServices();
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
      exitNow(1);
    }

    // Wait for OpenTelemetry initialization (if enabled)
    await otelPromise;

    // Connect to database with retry logic (required first)
    await connectWithRetry();

    // Phase 1: Initialize services that only need database (parallel)
    log.info('Initializing core services...');
    await Promise.all([
      // These run in parallel - no interdependencies
      startDatabaseHealthCheck(),
      (async () => { metricsService.initialize(); })(),
      initializeRedis(), // Redis init
    ]);
    initializeDistributedLock('redis-required');
    initializeNotificationTelemetry('api');

    // Phase 2: Initialize services that need Redis (parallel)
    log.info('Initializing Redis-dependent services...');
    const redisDependentTasks: Promise<unknown>[] = [
      initializeRedisBridge(),
      (async () => { initializeCacheInvalidation(); })(),
      (async () => { rateLimitService.initialize(); })(),
      deadLetterQueue.start(),
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

    // Warm caches after all services are initialized (reduces cold-start latency)
    // This runs before server starts accepting requests
    await warmCaches();

    // Start background services before accepting requests so health reflects
    // the real startup state and critical dependencies fail before bind.
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

      // Periodically update active user/wallet gauges for Prometheus (every 60s)
      activeStatsTimer = setInterval(async () => {
        try {
          const stats = await getActiveStats();
          updateActiveStatsMetrics(stats.activeUserCount, stats.activeWalletCount);
        } catch (error) {
          log.debug('Active stats metrics update failed', { error: getErrorMessage(error) });
        }
      }, 60_000);

    });
  } catch (error) {
    log.error('Failed to start server', {
      error: getErrorMessage(error),
    });
    exitNow(1);
  }
})();

// Graceful shutdown configuration
let activeStatsTimer: NodeJS.Timeout | null = null;

const handleShutdown = createGracefulShutdownHandler({
  log,
  httpServerDrain,
  stopActiveStatsTimer: () => {
    if (activeStatsTimer) clearInterval(activeStatsTimer);
    activeStatsTimer = null;
  },
  stopDatabaseHealthCheck,
  stopRegisteredServices,
  stopSynchronousServices: () => {
    rateLimitService.shutdown();
    cache.stop();
    walletLogBuffer.stop();
    deadLetterQueue.stop();
  },
  shutdownElectrumPool,
  shutdownJobQueue: () => jobQueue.shutdown(),
  shutdownRedisDependencies: async () => {
    shutdownDistributedLock();
    shutdownCacheInvalidation();
    await shutdownRedisBridge();
    await shutdownNotificationTelemetry();
    shutdownNotificationDeadLetterAggregateWriter();
    featureFlagService.shutdownRuntime();
  },
  shutdownRedis,
  disconnect,
  exitNow,
});

registerGracefulShutdownHandlers(
  handleShutdown,
  shutdown => registerFatalProcessHandlers({ log, shutdown, exitNow }),
);

export default app;
