/**
 * Worker Health Server
 *
 * Minimal HTTP server for health checks and metrics.
 * Provides endpoints for container orchestration and monitoring.
 *
 * Endpoints:
 * - GET /health - Full health check (JSON)
 * - GET /ready - Readiness probe (text)
 * - GET /live - Liveness probe (text)
 * - GET /metrics - Basic metrics (JSON)
 */

import http from 'http';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { registry } from '../observability/metrics/registry';

const log = createLogger('WORKER:HEALTH');

// =============================================================================
// Types
// =============================================================================

export interface HealthCheckProvider {
  getHealth(): Promise<{
    redis: boolean;
    electrum: boolean;
    jobQueue: boolean;
    database?: boolean;
  }>;
  getMetrics?(): Promise<{
    worker?: {
      hostname: string;
      pid: number;
      startedAt: string;
      concurrency: number;
      electrumSubscriptionOwner: boolean;
    };
    queues: Record<string, {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    }>;
    electrum: {
      isRunning?: boolean;
      ownershipRetryActive?: boolean;
      subscribedAddresses: number;
      networks: Record<string, { connected: boolean; lastBlockHeight: number }>;
    };
    jobCompletions?: Record<string, number>;
  }>;
}

export interface HealthServerOptions {
  /** Port to listen on */
  port: number;
  /** Health check provider */
  healthProvider: HealthCheckProvider;
}

export interface HealthServerHandle {
  /** Close the server */
  close: () => Promise<void>;
  /** Get the port the server is listening on */
  port: number;
}

// =============================================================================
// Health Server Implementation
// =============================================================================

/**
 * Start the health server
 */
export function startHealthServer(options: HealthServerOptions): HealthServerHandle {
  const { port, healthProvider } = options;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // Internal-only server, no CORS needed

    try {
      switch (url) {
        case '/':
        case '/health': {
          // Full health check
          const health = await healthProvider.getHealth();
          const isHealthy = health.redis && health.electrum && health.jobQueue;

          res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: isHealthy ? 'healthy' : 'degraded',
            components: health,
            timestamp: new Date().toISOString(),
          }));
          break;
        }

        case '/ready': {
          // Readiness probe - ready to receive traffic
          const health = await healthProvider.getHealth();
          const isReady = health.redis && health.jobQueue;

          if (isReady) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ready');
          } else {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('not ready');
          }
          break;
        }

        case '/live': {
          // Liveness probe - process is alive
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('alive');
          break;
        }

        case '/metrics': {
          // Metrics endpoint (JSON format for backward compat)
          if (healthProvider.getMetrics) {
            const metrics = await healthProvider.getMetrics();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ...metrics,
              timestamp: new Date().toISOString(),
            }));
          } else {
            const health = await healthProvider.getHealth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              health,
              timestamp: new Date().toISOString(),
            }));
          }
          break;
        }

        case '/metrics/prometheus': {
          // Prometheus text format for scraping
          const metricsText = await registry.metrics();
          res.writeHead(200, { 'Content-Type': registry.contentType });
          res.end(metricsText);
          break;
        }

        default: {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      }
    } catch (error) {
      log.error('Health check error', { error: getErrorMessage(error) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        error: getErrorMessage(error, 'Unknown error'),
      }));
    }
  });

  // Handle server errors
  server.on('error', (error) => {
    log.error('Health server error', { error: error.message });
  });

  // Start listening
  server.listen(port, () => {
    log.info(`Health server listening on port ${port}`);
  });

  return {
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          log.error('Health server close error', { error: err.message });
          reject(err);
        } else {
          log.info('Health server closed');
          resolve();
        }
      });
    }),
    port,
  };
}
