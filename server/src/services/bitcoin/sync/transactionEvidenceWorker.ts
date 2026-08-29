import { parentPort, workerData } from 'node:worker_threads';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import {
  extractExactAuthenticatedTransactionOutput,
  extractExactAuthenticatedTransactionOutputs,
  projectCompactAuthenticatedTransaction,
  projectAuthenticatedTransactionWithComplexity,
  reprojectFullAuthenticatedTransaction,
  transactionEvidenceDigest,
  type CompactTransactionEvidenceInput,
  type SealedTransactionEvidenceInput,
  type TransactionEvidenceProjectionInput,
} from './transactionEvidenceProjection';

const workerParentPort = parentPort;
if (workerParentPort === null) {
  throw new Error('Transaction evidence worker requires a parent port');
}

interface ProjectionRequest {
  input: TransactionEvidenceProjectionInput;
}

interface PersistentWorkerMarker {
  persistent: true;
  walletScripts?: string[];
}

interface CompactProjectionRequest {
  operation: 'compact';
  input: CompactTransactionEvidenceInput;
}

interface FullProjectionRequest {
  operation: 'full';
  input: SealedTransactionEvidenceInput;
}

interface ExactOutputProjectionRequest {
  operation: 'output';
  input: SealedTransactionEvidenceInput;
  vout: number;
}

interface ExactOutputsProjectionRequest {
  operation: 'outputs';
  input: SealedTransactionEvidenceInput;
  vouts: number[];
}

type PersistentProjectionRequest = ProjectionRequest
  | CompactProjectionRequest
  | FullProjectionRequest
  | ExactOutputProjectionRequest
  | ExactOutputsProjectionRequest;

const failureReason = (error: unknown) => error instanceof RawTransactionEvidenceError
  ? error.reason
  : undefined;

const project = (input: TransactionEvidenceProjectionInput): void => {
  try {
    const projected = projectAuthenticatedTransactionWithComplexity(input);
    const response = {
      ok: true,
      ...projected,
    };
    workerParentPort.postMessage(response);
  } catch (error) {
    workerParentPort.postMessage({
      ok: false,
      reason: failureReason(error),
    });
    return;
  }
};

const projectCompact = (
  input: CompactTransactionEvidenceInput,
  walletScripts: readonly string[],
): void => {
  try {
    const envelope = projectCompactAuthenticatedTransaction(input, walletScripts);
    workerParentPort.postMessage(
      { operation: 'compact', ok: true, envelope },
      [envelope.canonicalBytes.buffer as ArrayBuffer],
    );
  } catch (error) {
    workerParentPort.postMessage({
      operation: 'compact',
      ok: false,
      reason: failureReason(error),
    });
    return;
  }
};

const projectLocal = (
  request: FullProjectionRequest | ExactOutputProjectionRequest | ExactOutputsProjectionRequest,
): void => {
  const { canonicalBytes } = request.input;
  try {
    const result = request.operation === 'full'
      ? reprojectFullAuthenticatedTransaction(request.input)
      : request.operation === 'output'
        ? extractExactAuthenticatedTransactionOutput(request.input, request.vout)
        : extractExactAuthenticatedTransactionOutputs(request.input, request.vouts);
    workerParentPort.postMessage(
      { operation: request.operation, ok: true, result },
      [result.canonicalBytes.buffer as ArrayBuffer],
    );
  } catch (error) {
    workerParentPort.postMessage(
      {
        operation: request.operation,
        ok: false,
        reason: failureReason(error),
        canonicalBytes,
        digest: transactionEvidenceDigest(canonicalBytes),
      },
      [canonicalBytes.buffer as ArrayBuffer],
    );
    return;
  }
};

const handlePersistentRequest = (
  request: PersistentProjectionRequest,
  walletScripts: readonly string[],
): void => {
  if ('operation' in request) {
    if (request.operation === 'compact') projectCompact(request.input, walletScripts);
    else projectLocal(request);
    return;
  }
  project(request.input);
};

if ((workerData as PersistentWorkerMarker | undefined)?.persistent === true) {
  const scripts = Object.freeze(
    ((workerData as PersistentWorkerMarker).walletScripts ?? []).map(script => script.toLowerCase()),
  );
  workerParentPort.on('message', (request: PersistentProjectionRequest) => {
    handlePersistentRequest(request, scripts);
  });
} else {
  project(workerData as TransactionEvidenceProjectionInput);
}
