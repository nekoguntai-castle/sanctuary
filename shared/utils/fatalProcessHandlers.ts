/**
 * Shared fatal process handler installer used by server and gateway.
 *
 * ai-proxy intentionally does NOT consume this module — it is a network-isolated
 * service that does not import from `shared/`. Maintain its own copy at
 * `ai-proxy/src/fatalProcessHandlers.ts` if behavior needs to change there.
 */

import type { Logger } from '../types/logger';
import { getErrorMessage } from './errors';

type ExitCode = 0 | 1;

export type FatalProcessEvent = 'uncaughtException' | 'unhandledRejection';

type ProcessLike = Pick<NodeJS.Process, 'on'>;

export type FatalProcessHandlerOptions = {
  log: Pick<Logger, 'error' | 'warn'>;
  shutdown: (source: FatalProcessEvent, exitCode: ExitCode) => Promise<void> | void;
  exitNow: (code: ExitCode) => never;
  processLike?: ProcessLike;
};

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
