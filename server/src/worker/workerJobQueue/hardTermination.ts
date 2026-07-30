export type HardTerminate = (exitCode: number) => never;

/**
 * Lost distributed-lock ownership is process-fatal: JavaScript cancellation
 * cannot stop a handler that is already executing a mutating await.
 */
export const hardTerminateProcess: HardTerminate = (exitCode) => {
  process.exit(exitCode);
};
