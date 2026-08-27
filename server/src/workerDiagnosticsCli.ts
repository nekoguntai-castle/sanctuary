import { runWorkerDiagnosticsCli } from './services/workerDiagnosticsCli';

export async function runWorkerDiagnosticsCliEntrypoint(
  isMain = require.main === module,
  run: typeof runWorkerDiagnosticsCli = runWorkerDiagnosticsCli,
  writeError: (message: string) => void = (message) => process.stderr.write(message),
): Promise<void> {
  if (!isMain) return;
  try {
    process.exitCode = await run();
  } catch {
    writeError('Worker diagnostics failed unexpectedly.\n');
    process.exitCode = 1;
  }
}

void runWorkerDiagnosticsCliEntrypoint();
