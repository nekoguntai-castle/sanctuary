/**
 * Concrete process entrypoints own these dependencies so service code does not
 * import database lifecycle or process I/O infrastructure directly.
 */
export interface AuditProcessDependencies {
  runCli: () => Promise<number>;
  disconnectDatabase: () => Promise<void>;
  stderr: (message: string) => void;
}

/**
 * Runs the audit CLI and closes its database pool, returning a process exit
 * code instead of exposing audit or cleanup errors to the caller.
 */
export async function runWalletSafetyAuditProcess(
  dependencies: AuditProcessDependencies,
): Promise<number> {
  let exitCode: number;
  try {
    exitCode = await dependencies.runCli();
  } catch {
    dependencies.stderr('Wallet safety audit failed before execution.');
    exitCode = 1;
  }

  try {
    await dependencies.disconnectDatabase();
  } catch {
    dependencies.stderr('Wallet safety audit database disconnect failed.');
    // Cleanup failure invalidates an otherwise clean run, while an existing
    // non-zero result retains its more specific findings/error meaning.
    return exitCode === 0 ? 1 : exitCode;
  }

  return exitCode;
}
