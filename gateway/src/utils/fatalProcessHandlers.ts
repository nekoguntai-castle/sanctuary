type ExitCode = 0 | 1;

type FatalProcessEvent = 'uncaughtException' | 'unhandledRejection';

type ProcessLike = Pick<NodeJS.Process, 'on'>;

type FatalLogger = {
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

export type FatalProcessHandlerOptions = {
  log: FatalLogger;
  shutdown: (source: FatalProcessEvent, exitCode: ExitCode) => Promise<void> | void;
  exitNow: (code: ExitCode) => never;
  processLike?: ProcessLike;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fatalDetails(event: FatalProcessEvent, reason: unknown): Record<string, unknown> {
  return {
    event,
    reason: getErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  };
}

export function registerFatalProcessHandlers({
  log,
  shutdown,
  exitNow,
  processLike = process,
}: FatalProcessHandlerOptions): void {
  let fatalShutdownStarted = false;

  const handleFatalEvent = (event: FatalProcessEvent, reason: unknown): void => {
    const details = fatalDetails(event, reason);

    if (fatalShutdownStarted) {
      log.warn('Fatal process event ignored; shutdown already in progress', details);
      return;
    }

    fatalShutdownStarted = true;
    log.error('Fatal process event - shutting down', details);

    try {
      Promise.resolve(shutdown(event, 1)).catch(error => {
        log.error('Fatal shutdown failed', fatalDetails(event, error));
        exitNow(1);
      });
    } catch (error) {
      log.error('Fatal shutdown failed', fatalDetails(event, error));
      exitNow(1);
    }
  };

  processLike.on('uncaughtException', error => handleFatalEvent('uncaughtException', error));
  processLike.on('unhandledRejection', reason => handleFatalEvent('unhandledRejection', reason));
}
