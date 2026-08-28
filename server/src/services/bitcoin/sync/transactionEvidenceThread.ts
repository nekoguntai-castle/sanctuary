import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import type { RawTransactionEvidenceReason } from '../rawTransactionEvidence';
import type { RawTransaction } from './types';
import type { TransactionEvidenceProjectionInput } from './transactionEvidenceProjection';

interface ProjectionWorkerSuccess {
  ok: true;
  value: RawTransaction;
}

interface ProjectionWorkerFailure {
  ok: false;
  reason?: RawTransactionEvidenceReason;
}

type ProjectionWorkerResponse = ProjectionWorkerSuccess | ProjectionWorkerFailure;

interface ProjectionWorker {
  once(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  off(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

type ProjectionWorkerFactory = (input: TransactionEvidenceProjectionInput) => ProjectionWorker;

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

const createProjectionWorker: ProjectionWorkerFactory = input => {
  const entrypoint = resolveTransactionEvidenceWorkerEntrypoint(__filename);
  return new Worker(entrypoint.filename, {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 128 },
    execArgv: entrypoint.execArgv,
  });
};

const projectionFailure = (response: ProjectionWorkerFailure): Error => (
  response.reason
    ? new RawTransactionEvidenceError(response.reason)
    : new Error('Transaction evidence worker rejected the transaction')
);

export async function projectTransactionEvidenceOffThread(
  input: TransactionEvidenceProjectionInput,
  signal?: AbortSignal,
  createWorker: ProjectionWorkerFactory = createProjectionWorker,
  shouldAbort: (reason: unknown) => boolean = () => true,
): Promise<RawTransaction> {
  if (signal?.aborted && shouldAbort(signal.reason)) signal.throwIfAborted();
  const worker = createWorker(input);
  return new Promise<RawTransaction>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      action();
    };
    const onMessage = (response: ProjectionWorkerResponse): void => {
      finish(() => response.ok ? resolve(response.value) : reject(projectionFailure(response)));
    };
    const onError = (error: Error): void => {
      finish(() => reject(error));
    };
    const onExit = (code: number): void => {
      finish(() => reject(new Error(`Transaction evidence worker exited before reply (${code})`)));
    };
    const onAbort = (): void => {
      if (!shouldAbort(signal?.reason)) return;
      finish(() => reject(signal?.reason ?? new Error('Transaction evidence projection cancelled')));
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
