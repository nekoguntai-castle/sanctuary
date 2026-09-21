import { getErrorMessage } from './errors';
import { createShutdownState, type HttpServerDrain } from './httpServerDrain';

type ExitCode = 0 | 1;
type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, context?: { error: string }) => void;
};

export type ShutdownHandler = (signal: string, exitCode?: ExitCode) => Promise<void>;

export interface GracefulShutdownDependencies {
  log: Logger;
  httpServerDrain: HttpServerDrain;
  stopActiveStatsTimer: () => void;
  stopDatabaseHealthCheck: () => Promise<unknown>;
  stopRegisteredServices: () => Promise<void>;
  stopSynchronousServices: () => void;
  shutdownElectrumPool: () => Promise<void>;
  shutdownJobQueue: () => Promise<void>;
  shutdownRedisDependencies: () => Promise<void>;
  shutdownRedis: () => Promise<void>;
  disconnect: () => Promise<void>;
  exitNow: (code: ExitCode) => void;
  timeoutMs?: number;
}

async function closeElectrum(
  shutdownElectrumPool: () => Promise<void>,
  log: Logger,
): Promise<void> {
  try {
    await shutdownElectrumPool();
    log.info('Electrum pool closed');
  } catch (error) {
    log.error('Error closing Electrum pool', { error: getErrorMessage(error) });
  }
}

async function disconnectDatabase(
  databaseHealthStop: Promise<unknown>,
  disconnect: () => Promise<void>,
  log: Logger,
): Promise<void> {
  try {
    await databaseHealthStop;
    await disconnect();
  } catch (error) {
    log.error('Error disconnecting from database', { error: getErrorMessage(error) });
  }
}

export function createGracefulShutdownHandler(
  dependencies: GracefulShutdownDependencies,
): ShutdownHandler {
  const timeoutMs = dependencies.timeoutMs ?? 30_000;
  const shutdownState = createShutdownState();

  return async (signal, exitCode = 0) => {
    if (!shutdownState.begin(exitCode)) {
      dependencies.log.warn(`${signal} received again, already shutting down...`);
      return;
    }

    dependencies.log.info(
      `${signal} received, starting graceful shutdown (${timeoutMs / 1000}s timeout)...`,
    );
    const forceExitTimeout = setTimeout(() => {
      dependencies.log.error('Graceful shutdown timed out, forcing exit');
      dependencies.exitNow(1);
    }, timeoutMs);
    forceExitTimeout.unref();
    dependencies.stopActiveStatsTimer();

    const httpCloseErrors = await dependencies.httpServerDrain.begin();
    for (const error of httpCloseErrors) {
      shutdownState.fail();
      dependencies.log.error('Error closing API listener', { error: getErrorMessage(error) });
    }

    const databaseHealthStop = dependencies.stopDatabaseHealthCheck();
    await dependencies.stopRegisteredServices();
    dependencies.stopSynchronousServices();
    await closeElectrum(dependencies.shutdownElectrumPool, dependencies.log);
    await dependencies.shutdownJobQueue();
    await dependencies.shutdownRedisDependencies();
    await dependencies.shutdownRedis();
    await disconnectDatabase(databaseHealthStop, dependencies.disconnect, dependencies.log);

    clearTimeout(forceExitTimeout);
    dependencies.log.info('Server shutdown complete');
    dependencies.exitNow(shutdownState.getExitCode());
  };
}

export function registerGracefulShutdownHandlers(
  handleShutdown: ShutdownHandler,
  registerFatalHandlers: (shutdown: ShutdownHandler) => void,
  processLike: Pick<NodeJS.Process, 'on'> = process,
): void {
  processLike.on('SIGTERM', () => void handleShutdown('SIGTERM'));
  processLike.on('SIGINT', () => void handleShutdown('SIGINT'));
  registerFatalHandlers(handleShutdown);
}
