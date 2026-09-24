type ExitCode = 0 | 1;

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, context?: { error: string }): void;
};

export interface GatewayShutdownDependencies {
  log: Logger;
  closeHttpServer: () => Promise<void>;
  stopBackendEvents: () => Promise<void>;
  shutdownPushServices: () => void;
  clearBackoffCleanup: () => void;
  exitNow: (code: ExitCode) => void;
  timeoutMs?: number;
}

export type GatewayShutdownHandler = (
  signal: string,
  exitCode?: ExitCode,
) => Promise<void>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function beginAsync(operation: () => Promise<void>): Promise<void> {
  // Preserve all-settled cleanup when a dependency throws before returning.
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Build the gateway shutdown owner. Event and HTTP admission close together;
 * push and timer cleanup run after both drains. `timeoutMs` bounds the entire
 * sequence and defaults to ten seconds.
 */
export function createGatewayShutdownHandler(
  dependencies: GatewayShutdownDependencies,
): GatewayShutdownHandler {
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  let started = false;
  let finalExitCode: ExitCode = 0;

  return async (signal, exitCode = 0) => {
    // A later fatal signal upgrades the active shutdown before re-entry returns.
    if (exitCode === 1) {
      finalExitCode = 1;
    }
    if (started) {
      dependencies.log.warn(`Received ${signal} while shutdown is already in progress`);
      return;
    }
    started = true;

    dependencies.log.info(`Received ${signal}, shutting down...`);
    const forceExit = setTimeout(() => {
      dependencies.log.error('Forced shutdown after timeout');
      dependencies.exitNow(1);
    }, timeoutMs);
    forceExit.unref();

    const eventDrain = beginAsync(dependencies.stopBackendEvents);
    const httpDrain = beginAsync(dependencies.closeHttpServer);
    const [eventResult, httpResult] = await Promise.allSettled([eventDrain, httpDrain]);
    if (eventResult.status === 'rejected') {
      finalExitCode = 1;
      dependencies.log.error('Error draining backend events', {
        error: errorMessage(eventResult.reason),
      });
    }
    if (httpResult.status === 'rejected') {
      finalExitCode = 1;
      dependencies.log.error('Error closing HTTP server', {
        error: errorMessage(httpResult.reason),
      });
    } else {
      dependencies.log.info('HTTP server closed');
    }

    try {
      dependencies.shutdownPushServices();
    } catch (error) {
      finalExitCode = 1;
      dependencies.log.error('Error cleaning up gateway services', {
        error: errorMessage(error),
      });
    }
    try {
      dependencies.clearBackoffCleanup();
    } catch (error) {
      finalExitCode = 1;
      dependencies.log.error('Error cleaning up gateway services', {
        error: errorMessage(error),
      });
    }

    clearTimeout(forceExit);
    dependencies.log.info('Gateway shutdown complete');
    dependencies.exitNow(finalExitCode);
  };
}
