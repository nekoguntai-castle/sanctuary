import { parentPort, workerData } from 'node:worker_threads';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import {
  projectAuthenticatedTransaction,
  type TransactionEvidenceProjectionInput,
} from './transactionEvidenceProjection';

const workerParentPort = parentPort;
if (workerParentPort === null) {
  throw new Error('Transaction evidence worker requires a parent port');
}

const runProjection = (): void => {
  try {
    workerParentPort.postMessage({
      ok: true,
      value: projectAuthenticatedTransaction(workerData as TransactionEvidenceProjectionInput),
    });
  } catch (error) {
    workerParentPort.postMessage({
      ok: false,
      reason: error instanceof RawTransactionEvidenceError ? error.reason : undefined,
    });
    return;
  }
};

runProjection();
