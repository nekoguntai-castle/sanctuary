interface HttpServerCloseTarget {
  close(callback: (error?: Error) => void): unknown;
}

interface SynchronousCloseTarget {
  close(): unknown;
}

export interface HttpServerDrain {
  begin(): Promise<readonly Error[]>;
}

export interface ShutdownState {
  begin(exitCode: 0 | 1): boolean;
  fail(): void;
  getExitCode(): 0 | 1;
}

/** Track one shutdown owner while allowing later signals to promote failure. */
export function createShutdownState(): ShutdownState {
  let started = false;
  let exitCode: 0 | 1 = 0;

  return {
    begin(requestedExitCode) {
      if (requestedExitCode === 1) {
        exitCode = 1;
      }
      if (started) {
        return false;
      }
      started = true;
      return true;
    },
    fail() {
      exitCode = 1;
    },
    getExitCode() {
      return exitCode;
    },
  };
}

function isServerNotRunningError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING';
}

/**
 * Stop HTTP and WebSocket admission once, then settle after admitted HTTP work
 * has drained. Close errors are returned to the caller so teardown can proceed.
 */
export function createHttpServerDrain(
  httpServer: HttpServerCloseTarget,
  websocketServers: readonly SynchronousCloseTarget[] = [],
): HttpServerDrain {
  let drainPromise: Promise<readonly Error[]> | undefined;

  return {
    begin() {
      if (drainPromise) {
        return drainPromise;
      }

      const errors: Error[] = [];
      drainPromise = new Promise(resolve => {
        try {
          httpServer.close(error => {
            if (error && !isServerNotRunningError(error)) {
              errors.push(error);
            }
            resolve(errors);
          });
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
          resolve(errors);
        }

        for (const websocketServer of websocketServers) {
          try {
            websocketServer.close();
          } catch (error) {
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });

      return drainPromise;
    },
  };
}
