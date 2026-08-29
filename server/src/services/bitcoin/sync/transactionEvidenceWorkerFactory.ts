import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { TransactionEvidenceProjectionInput } from './transactionEvidenceProjection';

export const TRANSACTION_EVIDENCE_WORKER_MAX_OLD_GENERATION_MB = 32;

export function resolveTransactionEvidenceWorkerEntrypoint(runtimeFilename: string): {
  filename: string;
  execArgv?: string[];
} {
  const sourceRuntime = path.extname(runtimeFilename) === '.ts';
  return {
    filename: path.join(
      path.dirname(runtimeFilename),
      sourceRuntime ? 'transactionEvidenceWorker.ts' : 'transactionEvidenceWorker.js',
    ),
    ...(sourceRuntime ? { execArgv: process.execArgv } : {}),
  };
}

export const createProjectionWorker = (input: TransactionEvidenceProjectionInput): Worker => {
  const entrypoint = resolveTransactionEvidenceWorkerEntrypoint(__filename);
  return new Worker(entrypoint.filename, {
    workerData: input,
    resourceLimits: {
      maxOldGenerationSizeMb: TRANSACTION_EVIDENCE_WORKER_MAX_OLD_GENERATION_MB,
    },
    execArgv: entrypoint.execArgv,
  });
};

export const createPersistentProjectionWorker = (
  walletScripts: readonly string[] = [],
): Worker => {
  const entrypoint = resolveTransactionEvidenceWorkerEntrypoint(__filename);
  return new Worker(entrypoint.filename, {
    workerData: { persistent: true, walletScripts: [...walletScripts] },
    resourceLimits: {
      maxOldGenerationSizeMb: TRANSACTION_EVIDENCE_WORKER_MAX_OLD_GENERATION_MB,
    },
    execArgv: entrypoint.execArgv,
  });
};
