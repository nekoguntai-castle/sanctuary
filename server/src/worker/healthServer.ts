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

import http from "http";
import { createLogger } from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { registry } from "../observability/metrics/registry";

const log = createLogger("WORKER:HEALTH");

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
    queues: Record<
      string,
      {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
      }
    >;
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

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function writeText(
  res: http.ServerResponse,
  statusCode: number,
  body: string,
): void {
  res.writeHead(statusCode, { "Content-Type": "text/plain" });
  res.end(body);
}

async function writeHealthResponse(
  res: http.ServerResponse,
  healthProvider: HealthCheckProvider,
): Promise<void> {
  const health = await healthProvider.getHealth();
  const isHealthy = health.redis && health.electrum && health.jobQueue;

  writeJson(res, isHealthy ? 200 : 503, {
    status: isHealthy ? "healthy" : "degraded",
    components: health,
    timestamp: new Date().toISOString(),
  });
}

async function writeReadyResponse(
  res: http.ServerResponse,
  healthProvider: HealthCheckProvider,
): Promise<void> {
  const health = await healthProvider.getHealth();
  const isReady = health.redis && health.jobQueue;
  writeText(res, isReady ? 200 : 503, isReady ? "ready" : "not ready");
}

async function writeMetricsResponse(
  res: http.ServerResponse,
  healthProvider: HealthCheckProvider,
): Promise<void> {
  if (healthProvider.getMetrics) {
    const metrics = await healthProvider.getMetrics();
    writeJson(res, 200, {
      ...metrics,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const health = await healthProvider.getHealth();
  writeJson(res, 200, {
    health,
    timestamp: new Date().toISOString(),
  });
}

async function routeHealthRequest(
  url: string,
  res: http.ServerResponse,
  healthProvider: HealthCheckProvider,
): Promise<void> {
  switch (url) {
    case "/":
    case "/health":
      await writeHealthResponse(res, healthProvider);
      return;
    case "/ready":
      await writeReadyResponse(res, healthProvider);
      return;
    case "/live":
      writeText(res, 200, "alive");
      return;
    case "/metrics":
      await writeMetricsResponse(res, healthProvider);
      return;
    case "/metrics/prometheus":
      res.writeHead(200, { "Content-Type": registry.contentType });
      res.end(await registry.metrics());
      return;
    default:
      writeText(res, 404, "Not Found");
  }
}

async function handleHealthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  healthProvider: HealthCheckProvider,
): Promise<void> {
  try {
    // Internal-only server, no CORS needed.
    await routeHealthRequest(req.url || "/", res, healthProvider);
  } catch (error) {
    log.error("Health check error", { error: getErrorMessage(error) });
    // Keep detailed failure information in logs; health responses are probe-visible.
    writeJson(res, 500, {
      status: "error",
      error: "Health check failed",
    });
  }
}

/**
 * Start the health server
 */
export function startHealthServer(
  options: HealthServerOptions,
): HealthServerHandle {
  const { port, healthProvider } = options;

  const server = http.createServer(async (req, res) => {
    await handleHealthRequest(req, res, healthProvider);
  });

  // Handle server errors
  server.on("error", (error) => {
    log.error("Health server error", { error: error.message });
  });

  // Start listening
  server.listen(port, () => {
    log.info(`Health server listening on port ${port}`);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            log.error("Health server close error", { error: err.message });
            reject(err);
          } else {
            log.info("Health server closed");
            resolve();
          }
        });
      }),
    port,
  };
}
