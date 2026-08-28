import { parentPort, workerData } from 'node:worker_threads';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import {
  projectAuthenticatedTransactionWithComplexity,
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
}

const project = (input: TransactionEvidenceProjectionInput): void => {
  try {
    const projected = projectAuthenticatedTransactionWithComplexity(input);
    const response = {
      ok: true,
      ...projected,
    };
    const raw = projected.value.raw;
    const transfer = raw?.buffer instanceof ArrayBuffer ? [raw.buffer] : [];
    workerParentPort.postMessage(response, transfer);
  } catch (error) {
    workerParentPort.postMessage({
      ok: false,
      reason: error instanceof RawTransactionEvidenceError ? error.reason : undefined,
    });
    return;
  }
};

if ((workerData as PersistentWorkerMarker | undefined)?.persistent === true) {
  workerParentPort.on('message', (request: ProjectionRequest) => project(request.input));
} else {
  project(workerData as TransactionEvidenceProjectionInput);
}
