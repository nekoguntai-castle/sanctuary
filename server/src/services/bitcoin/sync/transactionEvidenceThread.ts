import {
  rawTransactionBytesFromHex,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import type { RawTransactionEvidenceReason } from '../rawTransactionEvidence';
import type { RawTransaction } from './types';
import type {
  CompactTransactionEvidenceEnvelope,
  ExactTransactionOutputEvidenceResult,
  ExactTransactionOutputsEvidenceResult,
  FullTransactionEvidenceResult,
  SealedTransactionEvidenceInput,
  TransactionEvidenceMetadata,
  TransactionEvidenceComplexity,
  TransactionEvidenceProjectionInput,
} from './transactionEvidenceProjection';
import {
  createPersistentProjectionWorker,
  createProjectionWorker,
} from './transactionEvidenceWorkerFactory';

export {
  resolveTransactionEvidenceWorkerEntrypoint,
  TRANSACTION_EVIDENCE_WORKER_MAX_OLD_GENERATION_MB,
} from './transactionEvidenceWorkerFactory';

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

interface CompactProjectionWorkerSuccess {
  operation: 'compact';
  ok: true;
  envelope: CompactTransactionEvidenceEnvelope;
}

interface FullProjectionWorkerSuccess {
  operation: 'full';
  ok: true;
  result: FullTransactionEvidenceResult;
}

interface OutputProjectionWorkerSuccess {
  operation: 'output';
  ok: true;
  result: ExactTransactionOutputEvidenceResult;
}

interface OutputsProjectionWorkerSuccess {
  operation: 'outputs';
  ok: true;
  result: ExactTransactionOutputsEvidenceResult;
}

interface ProtocolWorkerFailureBase extends ProjectionWorkerFailure {
  canonicalBytes?: Uint8Array;
  digest?: string;
}

type ProtocolWorkerFailure = ProtocolWorkerFailureBase & (
  { operation: 'compact' }
  | { operation: 'full' }
  | { operation: 'output' }
  | { operation: 'outputs' }
);

type EvidenceWorkerResponse = ProjectionWorkerResponse
  | CompactProjectionWorkerSuccess
  | FullProjectionWorkerSuccess
  | OutputProjectionWorkerSuccess
  | OutputsProjectionWorkerSuccess
  | ProtocolWorkerFailure;

interface ProjectionWorker {
  on(event: 'message', listener: (response: EvidenceWorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  once(event: 'message', listener: (response: EvidenceWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  off(event: 'message', listener: (response: ProjectionWorkerResponse) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
  postMessage?(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

type ProjectionWorkerFactory = (input: TransactionEvidenceProjectionInput) => ProjectionWorker;

const projectedComplexity = new WeakMap<RawTransaction, TransactionEvidenceComplexity>();

export const projectedTransactionEvidenceComplexity = (
  value: RawTransaction,
): TransactionEvidenceComplexity | undefined => projectedComplexity.get(value);

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
    const onMessage = (response: EvidenceWorkerResponse): void => {
      finish(() => {
        if ('operation' in response) {
          reject(new Error('Unexpected transaction evidence response'));
          return;
        }
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

export interface CompactTransactionEvidenceProjector extends TransactionEvidenceProjector {
  projectCompact(
    input: TransactionEvidenceProjectionInput,
    signal?: AbortSignal,
  ): Promise<CompactTransactionEvidenceEnvelope>;
  projectFull(
    envelope: CompactTransactionEvidenceEnvelope,
    signal?: AbortSignal,
  ): Promise<FullTransactionEvidenceResult>;
  extractOutput(
    envelope: CompactTransactionEvidenceEnvelope,
    vout: number,
    signal?: AbortSignal,
  ): Promise<ExactTransactionOutputEvidenceResult>;
  extractOutputs(
    envelope: CompactTransactionEvidenceEnvelope,
    vouts: readonly number[],
    signal?: AbortSignal,
  ): Promise<ExactTransactionOutputsEvidenceResult>;
}

export class DetachedTransactionEvidenceError extends Error {
  readonly noRemoteFallback = true;
  readonly cause: Error;

  constructor(cause: Error) {
    super('Transaction evidence worker failed while canonical-byte ownership was transferred');
    this.name = 'DetachedTransactionEvidenceError';
    this.cause = cause;
  }
}

interface ActiveProjection {
  handle: (response: EvidenceWorkerResponse) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort: () => void;
  envelope?: CompactTransactionEvidenceEnvelope;
}

const transactionMetadata = (details: RawTransaction): TransactionEvidenceMetadata => ({
  time: details.time,
  blocktime: details.blocktime,
  blockheight: details.blockheight,
  confirmations: details.confirmations,
  blockhash: details.blockhash,
});

const sealedInput = (
  envelope: CompactTransactionEvidenceEnvelope,
): SealedTransactionEvidenceInput => ({
  expectedTxid: envelope.txid,
  canonicalBytes: envelope.canonicalBytes,
  digest: envelope.digest,
  complexity: envelope.complexity,
  metadata: envelope.metadata,
});

const restoreEnvelope = (
  envelope: CompactTransactionEvidenceEnvelope,
  canonicalBytes: Uint8Array | undefined,
  digest: string | undefined,
): void => {
  if (!canonicalBytes || !digest) {
    throw new DetachedTransactionEvidenceError(new Error('Worker omitted transferred evidence'));
  }
  envelope.canonicalBytes = canonicalBytes;
  if (digest !== envelope.digest) {
    throw new RawTransactionEvidenceError('evidence_digest_mismatch');
  }
};

type EvidenceWorkerOperation = 'compact' | 'full' | 'output' | 'outputs';

const isProtocolResponse = <T extends EvidenceWorkerOperation>(
  response: EvidenceWorkerResponse,
  operation: T,
): response is Extract<EvidenceWorkerResponse, { operation: T }> => 'operation' in response
  && response.operation === operation;

function createPersistentProjector(
  worker: ProjectionWorker,
): CompactTransactionEvidenceProjector {

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
    const failure = active?.envelope?.canonicalBytes.byteLength === 0
      ? new DetachedTransactionEvidenceError(error)
      : error;
    terminalError ??= failure;
    settleActive(pending => pending.reject(failure));
    void beginTermination().catch(() => undefined);
  };

  const onMessage = (response: EvidenceWorkerResponse): void => {
    settleActive(pending => pending.handle(response));
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
    return submit<RawTransaction>({ input }, undefined, signal, response => {
      if ('operation' in response) throw new Error('Unexpected transaction evidence response');
      if (!response.ok) throw projectionFailure(response);
      if (response.complexity) projectedComplexity.set(response.value, response.complexity);
      return response.value;
    });
  };

  const submit = async <T>(
    message: unknown,
    transferList: readonly ArrayBuffer[] | undefined,
    signal: AbortSignal | undefined,
    decode: (response: EvidenceWorkerResponse) => T,
    envelope?: CompactTransactionEvidenceEnvelope,
  ): Promise<T> => {
    signal?.throwIfAborted();
    if (terminalError) throw terminalError;
    if (closed) throw new Error('Transaction evidence projector is closed');
    if (active) throw new Error('Transaction evidence projector queue is full');
    if (!worker.postMessage) throw new Error('Transaction evidence projector cannot accept work');
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        settleActive(pending => pending.reject(
          signal?.reason ?? new Error('Transaction evidence projection cancelled'),
        ));
        void beginTermination().catch(() => undefined);
      };
      const handle = (response: EvidenceWorkerResponse): void => {
        try {
          resolve(decode(response));
        } catch (error) {
          reject(error);
          if (error instanceof DetachedTransactionEvidenceError) {
            terminalError ??= error;
            void beginTermination().catch(() => undefined);
          }
          return;
        }
      };
      active = { handle, reject, signal, onAbort, envelope };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        worker.postMessage?.(message, transferList);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        stopAfterWorkerFailure(failure);
        return;
      }
    });
  };

  const projectCompact = async (
    input: TransactionEvidenceProjectionInput,
    signal?: AbortSignal,
  ): Promise<CompactTransactionEvidenceEnvelope> => {
    const canonicalBytes = rawTransactionBytesFromHex(input.details.hex ?? '');
    return submit(
      {
        operation: 'compact',
        input: {
          expectedTxid: input.expectedTxid,
          remoteTxid: input.details.txid,
          canonicalBytes,
          metadata: transactionMetadata(input.details),
          limits: input.limits,
        },
      },
      [canonicalBytes.buffer as ArrayBuffer],
      signal,
      response => {
        if (!isProtocolResponse(response, 'compact')) {
          throw new Error('Unexpected compact transaction evidence response');
        }
        if (!response.ok) throw projectionFailure(response);
        return response.envelope;
      },
    );
  };

  const projectFull = async (
    envelope: CompactTransactionEvidenceEnvelope,
    signal?: AbortSignal,
  ): Promise<FullTransactionEvidenceResult> => submit(
    { operation: 'full', input: sealedInput(envelope) },
    [envelope.canonicalBytes.buffer as ArrayBuffer],
    signal,
    response => {
      if (!isProtocolResponse(response, 'full')) {
        throw new DetachedTransactionEvidenceError(new Error('Unexpected full projection response'));
      }
      if (!response.ok) {
        restoreEnvelope(envelope, response.canonicalBytes, response.digest);
        throw projectionFailure(response);
      }
      const result = response.result as FullTransactionEvidenceResult;
      restoreEnvelope(envelope, result.canonicalBytes, result.digest);
      return result;
    },
    envelope,
  );

  const extractOutput = async (
    envelope: CompactTransactionEvidenceEnvelope,
    vout: number,
    signal?: AbortSignal,
  ): Promise<ExactTransactionOutputEvidenceResult> => submit(
    { operation: 'output', input: sealedInput(envelope), vout },
    [envelope.canonicalBytes.buffer as ArrayBuffer],
    signal,
    response => {
      if (!isProtocolResponse(response, 'output')) {
        throw new DetachedTransactionEvidenceError(new Error('Unexpected output projection response'));
      }
      if (!response.ok) {
        restoreEnvelope(envelope, response.canonicalBytes, response.digest);
        throw projectionFailure(response);
      }
      const result = response.result as ExactTransactionOutputEvidenceResult;
      restoreEnvelope(envelope, result.canonicalBytes, result.digest);
      return result;
    },
    envelope,
  );

  const extractOutputs = async (
    envelope: CompactTransactionEvidenceEnvelope,
    vouts: readonly number[],
    signal?: AbortSignal,
  ): Promise<ExactTransactionOutputsEvidenceResult> => submit(
    { operation: 'outputs', input: sealedInput(envelope), vouts: [...vouts] },
    [envelope.canonicalBytes.buffer as ArrayBuffer],
    signal,
    response => {
      if (!isProtocolResponse(response, 'outputs')) {
        throw new DetachedTransactionEvidenceError(new Error('Unexpected outputs projection response'));
      }
      if (!response.ok) {
        restoreEnvelope(envelope, response.canonicalBytes, response.digest);
        throw projectionFailure(response);
      }
      const result = response.result as ExactTransactionOutputsEvidenceResult;
      restoreEnvelope(envelope, result.canonicalBytes, result.digest);
      return result;
    },
    envelope,
  );

  return { project, projectCompact, projectFull, extractOutput, extractOutputs, close };
}

export function createTransactionEvidenceProjector(
  createWorker: () => ProjectionWorker = () => createPersistentProjectionWorker(),
): TransactionEvidenceProjector {
  return createPersistentProjector(createWorker());
}

export function createCompactTransactionEvidenceProjector(
  walletScripts: readonly string[],
  createWorker: () => ProjectionWorker = () => createPersistentProjectionWorker(
    walletScripts.map(script => script.toLowerCase()),
  ),
): CompactTransactionEvidenceProjector {
  return createPersistentProjector(createWorker());
}
