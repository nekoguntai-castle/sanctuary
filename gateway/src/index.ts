/**
 * Sanctuary API Gateway
 *
 * Public-facing gateway for mobile app access.
 * Handles authentication, rate limiting, and proxying to the backend.
 *
 * ## TLS Support
 *
 * The gateway supports HTTPS directly for secure mobile connections.
 * Enable with TLS_ENABLED=true and provide certificate paths.
 * This eliminates the need for a reverse proxy in front of the gateway.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import https from 'https';
import http from 'http';
import fs from 'fs';
import { config, validateConfig } from './config';
import { createLogger } from './utils/logger';
import { exitAfterDelay, exitNow } from './utils/processExit';
import { requestLogger } from './middleware/requestLogger';
import { authRateLimiter, cleanupBackoffTracker } from './middleware/rateLimit';
import proxyRoutes from './routes/proxy';
import { initializePushServices, shutdownPushServices } from './services/push';
import { startBackendEvents, stopBackendEvents } from './services/backendEvents';

const log = createLogger('GATEWAY');

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception - process will exit', {
    error: error.message,
    stack: error.stack,
  });
  exitAfterDelay(1, 1000);
});

process.on('unhandledRejection', (reason: unknown) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Validate configuration
validateConfig();

const app = express();

// Security middleware
app.use(helmet());

// SEC-004: CORS configuration with configurable allowlist
const corsOptions: cors.CorsOptions = {
  origin: config.corsAllowedOrigins.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
          callback(null, true);
          return;
        }
        // Check if origin is in allowlist
        if (config.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true, // Allow all origins if no allowlist configured (for mobile apps)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
};

// Warn if CORS is wide open
if (config.corsAllowedOrigins.length === 0) {
  log.warn('CORS is configured to allow all origins. Set CORS_ALLOWED_ORIGINS to restrict access.');
}

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging - captures all requests for auditing
app.use(requestLogger);

// Strip trailing slashes for consistent routing
// Mobile clients may add trailing slashes which won't match our route patterns
app.use((req, _res, next) => {
  if (req.path !== '/' && req.path.endsWith('/')) {
    // Remove trailing slashes before query string (?), hash (#), or end of URL
    req.url = req.url.replace(/\/+(?=\?|#|$)/, '') || '/';
  }
  next();
});

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Gateway info
app.get('/info', (_req, res) => {
  res.json({
    name: 'Sanctuary Gateway',
    version: '0.1.0',
    environment: config.nodeEnv,
  });
});

// SEC-007: Auth routes with stricter rate limiting for ALL auth endpoints
// Apply rate limiter to the entire /api/v1/auth path, not just login POST
app.use('/api/v1/auth', authRateLimiter);

// Proxy routes to backend (includes push notification endpoints)
app.use('/', proxyRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Endpoint not available via mobile API',
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// =============================================================================
// Create Server (HTTP or HTTPS based on configuration)
// =============================================================================

/**
 * Load TLS certificates from disk
 * Returns null if TLS is disabled or certificates are not available
 */
function loadTlsCertificates(): https.ServerOptions | null {
  if (!config.tls.enabled) {
    return null;
  }

  try {
    // Check if certificate files exist
    if (!fs.existsSync(config.tls.certPath)) {
      log.error('TLS certificate file not found', { path: config.tls.certPath });
      exitNow(1);
    }
    if (!fs.existsSync(config.tls.keyPath)) {
      log.error('TLS private key file not found', { path: config.tls.keyPath });
      exitNow(1);
    }

    const cert = fs.readFileSync(config.tls.certPath, 'utf8');
    const key = fs.readFileSync(config.tls.keyPath, 'utf8');

    // Load optional CA certificate chain (for intermediate certificates)
    let ca: string | undefined;
    if (config.tls.caPath && fs.existsSync(config.tls.caPath)) {
      ca = fs.readFileSync(config.tls.caPath, 'utf8');
      log.info('TLS CA certificate chain loaded');
    }

    log.info('TLS certificates loaded successfully');

    return {
      cert,
      key,
      ca,
      minVersion: config.tls.minVersion,
      // Modern TLS settings
      ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
      ].join(':'),
      honorCipherOrder: true,
    };
  } catch (error) {
    log.error('Failed to load TLS certificates', {
      error: error instanceof Error ? error.message : String(error),
    });
    exitNow(1);
  }
}

// Create server based on TLS configuration
let server: http.Server | https.Server;
const tlsOptions = loadTlsCertificates();

// Periodic cleanup interval for rate limit backoff tracker
let backoffCleanupInterval: NodeJS.Timeout | null = null;

if (tlsOptions) {
  // HTTPS server
  server = https.createServer(tlsOptions, app);
  server.listen(config.port, () => {
    log.info(`Gateway started with HTTPS on port ${config.port}`);
    log.info(`TLS version: ${config.tls.minVersion}+`);
    log.info(`Environment: ${config.nodeEnv}`);
    log.info(`Backend URL: ${config.backendUrl}`);

    // Initialize push notification services
    initializePushServices();

    // Connect to backend for events
    startBackendEvents();

    // Start periodic cleanup of rate limit backoff tracker (every 5 minutes)
    backoffCleanupInterval = setInterval(cleanupBackoffTracker, 5 * 60 * 1000);
  });
} else {
  // HTTP server (development or TLS disabled)
  server = app.listen(config.port, () => {
    log.info(`Gateway started with HTTP on port ${config.port}`);
    if (config.nodeEnv === 'production') {
      log.warn('WARNING: Running without TLS in production is insecure!');
    }
    log.info(`Environment: ${config.nodeEnv}`);
    log.info(`Backend URL: ${config.backendUrl}`);

    // Initialize push notification services
    initializePushServices();

    // Connect to backend for events
    startBackendEvents();

    // Start periodic cleanup of rate limit backoff tracker (every 5 minutes)
    backoffCleanupInterval = setInterval(cleanupBackoffTracker, 5 * 60 * 1000);
  });
}

// Graceful shutdown
function shutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down...`);

  server.close(() => {
    log.info('HTTP server closed');

    // Cleanup services
    stopBackendEvents();
    shutdownPushServices();

    // Clear backoff cleanup interval
    if (backoffCleanupInterval) {
      clearInterval(backoffCleanupInterval);
    }

    log.info('Gateway shutdown complete');
    exitNow(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    exitNow(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
