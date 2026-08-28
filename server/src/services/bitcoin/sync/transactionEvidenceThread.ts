import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import type { RawTransactionEvidenceReason } from '../rawTransactionEvidence';
import type { RawTransaction } from './types';
import type {
  TransactionEvidenceComplexity,
  TransactionEvidenceProjectionInput,
} from './transactionEvidenceProjection';

interface ProjectionWorkerSuccess {
  ok: true;
  value: RawTransaction;
  complexity?: TransactionEvidenceComplexity;
}

interface ProjectionWorkerFailure {
  ok: false;
  reason?: RawTransactionEvidenceReason;
}

type ProjectionWorkerResponse = ProjectionWorkerSuccess | ProjectionWorkerFailure;

interface ProjectionWorker {
  on(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  once(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  off(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
  postMessage?(value: unknown): void;
  terminate(): Promise<number>;
}

type ProjectionWorkerFactory = (input: TransactionEvidenceProjectionInput) => ProjectionWorker;

const projectedComplexity = new WeakMap<RawTransaction, TransactionEvidenceComplexity>();

export const projectedTransactionEvidenceComplexity = (
  value: RawTransaction,
): TransactionEvidenceComplexity | undefined => projectedComplexity.get(value);

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

const createPersistentProjectionWorker = (): ProjectionWorker => {
  const entrypoint = resolveTransactionEvidenceWorkerEntrypoint(__filename);
  return new Worker(entrypoint.filename, {
    workerData: { persistent: true },
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
      finish(() => {
        if (!response.ok) {
          reject(projectionFailure(response));
          return;
        }
        if (response.complexity) projectedComplexity.set(response.value, response.complexity);
        resolve(response.value);
      });
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

export interface TransactionEvidenceProjector {
  project(
    input: TransactionEvidenceProjectionInput,
    signal?: AbortSignal,
  ): Promise<RawTransaction>;
  close(): Promise<void>;
}

export function createTransactionEvidenceProjector(
  createWorker: () => ProjectionWorker = createPersistentProjectionWorker,
): TransactionEvidenceProjector {
  const worker = createWorker();
  interface ActiveProjection {
    resolve: (value: RawTransaction) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort: () => void;
  }

  let active: ActiveProjection | undefined;
  let closed = false;
  let terminalError: Error | undefined;
  let closePromise: Promise<void> | undefined;

  const settleActive = (action: (pending: ActiveProjection) => void): void => {
    const pending = active;
    if (!pending) return;
    active = undefined;
    pending.signal?.removeEventListener('abort', pending.onAbort);
    action(pending);
  };

  const detachLifecycleListeners = (): void => {
    worker.off('message', onMessage);
    worker.off('error', onError);
    worker.off('exit', onExit);
  };

  const beginTermination = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = worker.terminate().then(
      () => undefined,
      error => {
        throw error;
      },
    ).finally(detachLifecycleListeners);
    return closePromise;
  };

  const stopAfterWorkerFailure = (error: Error): void => {
    terminalError ??= error;
    settleActive(pending => pending.reject(error));
    void beginTermination().catch(() => undefined);
  };

  const onMessage = (response: ProjectionWorkerResponse): void => {
    settleActive(pending => {
      if (!response.ok) {
        pending.reject(projectionFailure(response));
        return;
      }
      if (response.complexity) projectedComplexity.set(response.value, response.complexity);
      pending.resolve(response.value);
    });
  };

  const onError = (error: Error): void => {
    stopAfterWorkerFailure(error);
  };

  const onExit = (code: number): void => {
    if (closed) return;
    stopAfterWorkerFailure(
      new Error(`Transaction evidence worker exited before reply (${code})`),
    );
  };

  worker.on('message', onMessage);
  worker.on('error', onError);
  worker.on('exit', onExit);

  const close = async (): Promise<void> => {
    if (!closed) {
      settleActive(pending => pending.reject(new Error('Transaction evidence projector closed')));
    }
    await beginTermination();
  };

  const project = async (
    input: TransactionEvidenceProjectionInput,
    signal?: AbortSignal,
  ): Promise<RawTransaction> => {
    signal?.throwIfAborted();
    if (terminalError) throw terminalError;
    if (closed) throw new Error('Transaction evidence projector is closed');
    if (active) throw new Error('Transaction evidence projector queue is full');
    if (!worker.postMessage) throw new Error('Transaction evidence projector cannot accept work');
    return new Promise<RawTransaction>((resolve, reject) => {
      const onAbort = (): void => {
        settleActive(pending => pending.reject(
          signal?.reason ?? new Error('Transaction evidence projection cancelled'),
        ));
        void beginTermination().catch(() => undefined);
      };
      active = { resolve, reject, signal, onAbort };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        worker.postMessage?.({ input });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        stopAfterWorkerFailure(failure);
        return;
      }
    });
  };

  return { project, close };
}
