import { createServer, type Server } from 'node:http';
import config from './config';
import { initializeRedis, shutdownDistributedLock, shutdownRedis } from './infrastructure';
import {
  connectWithRetry,
  disconnect,
  startDatabaseHealthCheck,
  stopDatabaseHealthCheck,
} from './models/prisma';
import { metricsService } from './observability';
import { rateLimitService } from './services/rateLimiting';
import { createLogger } from './utils/logger';
import { getErrorMessage } from './utils/errors';
import { exitNow } from './utils/processExit';
import { createMcpHttpApp } from './mcp/transport';

const log = createLogger('MCP:ENTRY');
const SHUTDOWN_TIMEOUT_MS = 15_000;

let httpServer: Server | null = null;
let shuttingDown = false;

async function startMcpServer(): Promise<void> {
  if (!config.mcp.enabled) {
    log.warn('MCP server is disabled. Set MCP_ENABLED=true to start this entrypoint.');
    exitNow(0);
  }

  await connectWithRetry();
  startDatabaseHealthCheck();
  await initializeRedis();
  rateLimitService.initialize();
  metricsService.initialize();

  const app = createMcpHttpApp();
  httpServer = createServer(app);

  httpServer.listen(config.mcp.port, config.mcp.host, () => {
    log.info('Sanctuary MCP server running', {
      host: config.mcp.host,
      port: config.mcp.port,
      endpoint: `http://${config.mcp.host}:${config.mcp.port}/mcp`,
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log.info(`${signal} received, shutting down MCP server`);

  const forceExit = setTimeout(() => {
    log.error('MCP shutdown timed out, forcing exit');
    exitNow(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => resolve());
  });

  stopDatabaseHealthCheck();
  rateLimitService.shutdown();
  shutdownDistributedLock();
  await shutdownRedis();
  await disconnect();

  clearTimeout(forceExit);
  log.info('MCP server stopped');
  exitNow(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(error => {
    log.error('MCP shutdown failed', { error: getErrorMessage(error) });
    exitNow(1);
  });
});

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(error => {
    log.error('MCP shutdown failed', { error: getErrorMessage(error) });
    exitNow(1);
  });
});

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught MCP exception', { error: error.message, stack: error.stack });
  exitNow(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  log.error('Unhandled MCP rejection', { error: getErrorMessage(reason) });
});

startMcpServer().catch(error => {
  log.error('Failed to start MCP server', { error: getErrorMessage(error) });
  exitNow(1);
});
