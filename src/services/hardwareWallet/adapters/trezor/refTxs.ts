/**
 * Reference Transactions
 *
 * Fetches raw transactions from the server for Trezor signing verification.
 */

import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../../../../api/client';
import { createLogger } from '../../../../utils/logger';
import { toHex } from '../../../../utils/bufferUtils';

const log = createLogger('TrezorAdapter');
const REFERENCE_TRANSACTION_TIMEOUT_MS = 10_000;
const REFERENCE_TRANSACTION_AGGREGATE_TIMEOUT_MS = 12_000;
const MAX_CONCURRENT_REFERENCE_FETCHES = 4;

const toTrezorReferenceTransaction = (rawTx: bitcoin.Transaction) => ({
  hash: rawTx.getId(),
  version: rawTx.version,
  lock_time: rawTx.locktime,
  inputs: rawTx.ins.map((txIn) => ({
    prev_hash: toHex(Buffer.from(txIn.hash).reverse()),
    prev_index: txIn.index,
    script_sig: toHex(txIn.script),
    sequence: txIn.sequence,
  })),
  bin_outputs: rawTx.outs.map((output) => ({
    amount: output.value.toString(),
    script_pubkey: toHex(output.script),
  })),
});

const matchingInputIndexes = (psbt: bitcoin.Psbt, txid: string): number[] =>
  psbt.txInputs.flatMap((input, index) =>
    Buffer.from(input.hash).reverse().toString('hex') === txid ? [index] : []
  );

const assertReferenceMatchesInputs = (
  psbt: bitcoin.Psbt,
  txid: string,
  transaction: bitcoin.Transaction,
  source: 'fetched' | 'PSBT'
): void => {
  for (const inputIndex of matchingInputIndexes(psbt, txid)) {
    const selectedOutput = transaction.outs[psbt.txInputs[inputIndex].index];
    if (!selectedOutput) {
      throw new Error(
        `Input ${inputIndex} ${source} reference transaction does not contain selected output`
      );
    }
    const witness = psbt.data.inputs[inputIndex].witnessUtxo;
    if (
      witness &&
      (witness.value !== selectedOutput.value ||
        !Buffer.from(witness.script).equals(Buffer.from(selectedOutput.script)))
    ) {
      throw new Error(`Input ${inputIndex} ${source} previous output differs from witnessUtxo`);
    }
  }
};

const authenticatedPsbtReference = (
  psbt: bitcoin.Psbt,
  txid: string
): bitcoin.Transaction | undefined => {
  let reference: bitcoin.Transaction | undefined;
  for (const inputIndex of matchingInputIndexes(psbt, txid)) {
    const bytes = psbt.data.inputs[inputIndex]?.nonWitnessUtxo;
    if (!bytes) continue;
    const transaction = bitcoin.Transaction.fromBuffer(Uint8Array.from(bytes));
    if (transaction.getId() !== txid) {
      throw new Error(
        `Input ${inputIndex} nonWitnessUtxo transaction id differs from its outpoint`
      );
    }
    if (
      reference &&
      !Buffer.from(reference.toBuffer()).equals(Buffer.from(transaction.toBuffer()))
    ) {
      throw new Error(
        `Input ${inputIndex} nonWitnessUtxo differs from the shared reference transaction`
      );
    }
    reference = transaction;
  }
  if (reference) assertReferenceMatchesInputs(psbt, txid, reference, 'PSBT');
  return reference;
};

const fetchRemoteReference = async (
  walletId: string,
  txid: string
): Promise<{ hex: string }> => {
  try {
    return await apiClient.get<{ hex: string }>(
      `/wallets/${encodeURIComponent(walletId)}/transactions/${txid}/raw`,
      undefined,
      { enabled: false },
      { timeoutMs: REFERENCE_TRANSACTION_TIMEOUT_MS }
    );
  } catch (error) {
    log.warn('Failed to fetch reference transaction', { txid, error });
    throw new Error(`Required reference transaction ${txid} could not be fetched`);
  }
};

interface ReferenceRequest {
  txid: string;
  inputIndex: number;
  localReference?: bitcoin.Transaction;
}

const collectReferenceRequests = (psbt: bitcoin.Psbt): ReferenceRequest[] => {
  const seenTxids = new Set<string>();
  const requests: ReferenceRequest[] = [];
  for (let inputIndex = 0; inputIndex < psbt.data.inputs.length; inputIndex += 1) {
    const txid = Buffer.from(psbt.txInputs[inputIndex].hash).reverse().toString('hex');
    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);
    requests.push({
      txid,
      inputIndex,
      localReference: authenticatedPsbtReference(psbt, txid),
    });
  }
  return requests;
};

const mapWithConcurrency = async <T, Result>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<Result>
): Promise<Result[]> => {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      try {
        results[index] = await operation(values[index]);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};

const withAggregateTimeout = async <T>(operation: Promise<T>, txids: string[]): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out fetching required reference transactions: ${txids.join(', ')}`
        )
      );
    }, REFERENCE_TRANSACTION_AGGREGATE_TIMEOUT_MS);
    void operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });

const fetchAndAuthenticateReference = async (
  psbt: bitcoin.Psbt,
  walletId: string,
  request: ReferenceRequest
): Promise<bitcoin.Transaction> => {
  const response = await fetchRemoteReference(walletId, request.txid);
  const transaction = bitcoin.Transaction.fromHex(response.hex);
  if (transaction.getId() !== request.txid) {
    throw new Error(
      `Input ${request.inputIndex} fetched transaction id differs from its outpoint`
    );
  }
  assertReferenceMatchesInputs(psbt, request.txid, transaction, 'fetched');
  return transaction;
};

/**
 * Fetch reference transactions needed for Trezor signing
 */
export async function fetchRefTxs(psbt: bitcoin.Psbt, walletId: string): Promise<any[]> {
  const requests = collectReferenceRequests(psbt);
  const remoteRequests = requests.filter((request) => !request.localReference);
  const references = await withAggregateTimeout(
    mapWithConcurrency(requests, MAX_CONCURRENT_REFERENCE_FETCHES, async (request) =>
      request.localReference ?? fetchAndAuthenticateReference(psbt, walletId, request)
    ),
    remoteRequests.map(({ txid }) => txid)
  );
  return references.map(toTrezorReferenceTransaction);
}
