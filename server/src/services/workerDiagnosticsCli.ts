import { requestWorkerDiagnostics } from './workerDiagnosticsClient';

export const WORKER_DIAGNOSTICS_CLI_EXIT = {
  observed: 0,
  error: 1,
  unsupported: 2,
  timeout: 3,
  unavailable: 4,
} as const;

interface WorkerDiagnosticsCliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

type DiagnosticsObservation = Awaited<ReturnType<typeof requestWorkerDiagnostics>>;

function executionSnapshot(
  observation: Extract<DiagnosticsObservation, { status: 'observed' }>,
): unknown {
  return observation.walletSyncExecution.status === 'observed'
    ? observation.walletSyncExecution.value
    : undefined;
}

/**
 * Print the authenticated wallet-sync aggregate without exposing transport,
 * configuration, or exception detail.
 */
export async function runWorkerDiagnosticsCli(
  arguments_: readonly string[] = process.argv.slice(2),
  io: WorkerDiagnosticsCliIo = {
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
  },
  request: typeof requestWorkerDiagnostics = requestWorkerDiagnostics,
): Promise<number> {
  if (arguments_.length !== 0) {
    io.stderr('Worker diagnostics failed: this command accepts no arguments.');
    return WORKER_DIAGNOSTICS_CLI_EXIT.error;
  }

  try {
    const observation = await request();
    if (observation.status !== 'observed') {
      io.stdout(JSON.stringify({ schemaVersion: 1, status: observation.status }));
      return WORKER_DIAGNOSTICS_CLI_EXIT[observation.status];
    }

    const snapshot = executionSnapshot(observation);
    if (snapshot === undefined) {
      io.stdout(JSON.stringify({ schemaVersion: 1, status: 'unsupported' }));
      return WORKER_DIAGNOSTICS_CLI_EXIT.unsupported;
    }

    io.stdout(JSON.stringify({
      schemaVersion: 1,
      status: 'observed',
      walletSyncExecution: snapshot,
    }));
    return WORKER_DIAGNOSTICS_CLI_EXIT.observed;
  } catch {
    io.stderr('Worker diagnostics failed unexpectedly.');
    return WORKER_DIAGNOSTICS_CLI_EXIT.error;
  }
}
