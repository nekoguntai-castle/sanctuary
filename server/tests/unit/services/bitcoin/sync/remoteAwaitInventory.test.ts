import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string): string => readFileSync(
  new URL(`../../../../../src/services/bitcoin/${relativePath}`, import.meta.url),
  'utf8',
);

const remoteAwaitInventory = [
  ['sync/pipeline.ts', ['getNodeClient(network, requestOptions)', 'getBlockHeight(network, requestOptions)']],
  ['blockchain/syncWallet.ts', ['getNodeClient(network, options)', 'getAddressHistoryBatch(addressStrings, options)']],
  ['sync/phases/fetchHistories.ts', ['getAddressHistoryBatch(batchAddresses, requestOptions)', 'getAddressHistory(address, requestOptions)']],
  ['sync/phases/fetchUtxos.ts', ['getAddressUTXOsBatch(batchAddresses, requestOptions)', 'getAddressUTXOs(address, requestOptions)']],
  ['sync/evidenceAuthentication.ts', ['getTransactionsBatch(batchTxids, false, options)', 'getTransaction(txid, false, options)']],
  ['sync/phases/gapLimit.ts', ['getAddressHistoryBatch(newAddressStrings, requestOptions)']],
  ['sync/phases/insertUtxos.ts', ['getTransaction(utxo.tx_hash, false, requestOptions)']],
  ['sync/phases/processTransactions/processTransactionsPhase.ts', ['fetchAuthenticatedTransactions(ctx, batchTxids, options)', 'prefetchPreviousTransactions(ctx, batchTxidSet, options)']],
  ['sync/phases/processTransactions/classification.ts', ['fetchAuthenticatedTransactions(ctx, [txid], options)', 'getBlockTimestamp(height, network, options)']],
  ['sync/confirmations/fetchHelpers.ts', ['getAddressHistory(address, options)', 'getTransaction(txid, true, options)']],
  ['sync/confirmations/populateFields.ts', ['getNodeClient(castNetwork, initialOptions)', 'getBlockHeight(castNetwork, initialOptions)']],
  ['sync/confirmations/processUpdates.ts', ['getBlockTimestamp(height, network, options)']],
  ['utils/blockHeight.ts', ['getNodeClient(network, options)', 'getBlockHeader(height, options)']],
] as const;

describe('wallet sync remote-await architecture', () => {
  it.each(remoteAwaitInventory)('%s keeps its remote waits cancellation-aware', (file, fragments) => {
    const contents = source(file);
    for (const fragment of fragments) expect(contents).toContain(fragment);
  });
});
