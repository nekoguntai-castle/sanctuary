/**
 * Transaction Classification
 *
 * Classifies transactions as received, sent, or consolidation based on
 * input/output analysis. Handles fetching of previous transaction outputs
 * for input resolution.
 */

import { createLogger } from '../../../../../utils/logger';
import { getBlockTimestamp } from '../../../utils/blockHeight';
import type { SyncContext, TransactionCreateData, TransactionOutput } from '../../types';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/**
 * Helper to check if output matches an address
 */
export function outputMatchesAddress(out: TransactionOutput, address: string): boolean {
  if (out.scriptPubKey?.address === address) return true;
  if (out.scriptPubKey?.addresses?.includes(address)) return true;
  return false;
}

/**
 * Classify and create transaction records from a batch of fetched transactions.
 *
 * For each address history entry, determines if the transaction is a receive,
 * send, or consolidation, calculates the amount, and creates a TransactionCreateData record.
 */
export async function classifyTransactions(
  ctx: SyncContext,
  batchTxidSet: Set<string>
): Promise<TransactionCreateData[]> {
  const {
    walletId,
    client,
    historyResults,
    addressMap,
    walletAddressSet,
    currentBlockHeight,
    existingTxMap,
    txDetailsCache,
  } = ctx;

  const transactionsToCreate: TransactionCreateData[] = [];

  for (const [addressStr, history] of historyResults) {
    const addressRecord = addressMap.get(addressStr)!;

    for (const item of history) {
      if (!batchTxidSet.has(item.tx_hash)) continue;

      const txDetails = txDetailsCache.get(item.tx_hash);
      if (!txDetails) continue;

      const outputs = txDetails.vout || [];
      const inputs = txDetails.vin || [];

      const isReceived = outputs.some((out: TransactionOutput) => outputMatchesAddress(out, addressStr));

      // Get block timestamp
      let blockTime: Date | null = null;
      if (txDetails.time) {
        blockTime = new Date(txDetails.time * 1000);
      } else if (item.height > 0) {
        blockTime = await getBlockTimestamp(item.height);
      }

      const confirmations = item.height > 0 ? Math.max(0, currentBlockHeight - item.height + 1) : 0;

      // Check if wallet sent funds (any wallet address in inputs)
      let isSent = false;
      let hasVerboseInputs = false;

      for (const input of inputs) {
        if (input.coinbase) continue;

        let inputAddr: string | undefined;
        if (input.prevout && input.prevout.scriptPubKey) {
          hasVerboseInputs = true;
          inputAddr = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
        } else if (input.txid && input.vout !== undefined) {
          // Use prefetched prev tx from cache (Step 1b)
          const prevTx = txDetailsCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            inputAddr = prevOutput.scriptPubKey?.address ||
              (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
          } else if (!prevTx) {
            // Cache miss - fallback to individual fetch (should be rare after batch prefetch)
            log.debug(`[SYNC] Cache miss for prev tx ${input.txid.slice(0, 8)}..., fetching individually`);
            try {
              const fetchedPrevTx = await client.getTransaction(input.txid);
              if (fetchedPrevTx && fetchedPrevTx.vout && fetchedPrevTx.vout[input.vout]) {
                const prevOutput = fetchedPrevTx.vout[input.vout];
                inputAddr = prevOutput.scriptPubKey?.address ||
                  (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                txDetailsCache.set(input.txid, fetchedPrevTx);
              }
            } catch (e) {
              log.debug(`Failed to fetch prev tx ${input.txid.slice(0, 8)}...`, { error: String(e) });
            }
          }
        }

        if (inputAddr && walletAddressSet.has(inputAddr)) {
          isSent = true;
          if (hasVerboseInputs) break;
        }
      }

      // Calculate output destinations
      let totalToExternal = 0;
      let totalToWallet = 0;
      let totalOutputs = 0;

      for (const out of outputs) {
        const outValue = Math.round(out.value * 100000000);
        totalOutputs += outValue;
        const outAddr = out.scriptPubKey?.address ||
          (out.scriptPubKey?.addresses && out.scriptPubKey.addresses[0]);
        if (outAddr && !walletAddressSet.has(outAddr)) {
          totalToExternal += outValue;
        } else if (outAddr) {
          totalToWallet += outValue;
        }
      }

      // Calculate total inputs for fee
      let totalInputs = 0;
      if (isSent) {
        for (const input of inputs) {
          if (input.coinbase) continue;
          let inputValue = 0;
          if (input.prevout && input.prevout.value !== undefined) {
            inputValue = input.prevout.value >= 1000000
              ? input.prevout.value
              : Math.round(input.prevout.value * 100000000);
          } else if (input.txid && input.vout !== undefined) {
            const prevTx = txDetailsCache.get(input.txid);
            if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
              inputValue = Math.round(prevTx.vout[input.vout].value * 100000000);
            }
          }
          totalInputs += inputValue;
        }
      }

      const calculatedFee = isSent && totalInputs > 0 ? totalInputs - totalOutputs : null;
      const fee = calculatedFee !== null && calculatedFee >= 0 ? calculatedFee : null;

      // Determine transaction type
      // Consolidation: wallet spends UTXOs but all outputs go back to wallet addresses.
      const isConsolidation = isSent && totalToExternal === 0 && totalToWallet > 0;

      if (isConsolidation && !existingTxMap.has(`${item.tx_hash}:consolidation`)) {
        const consolidationAmount = fee !== null ? -fee : 0;
        transactionsToCreate.push({
          txid: item.tx_hash,
          walletId,
          addressId: addressRecord.id,
          type: 'consolidation',
          amount: BigInt(consolidationAmount),
          fee: fee !== null ? BigInt(fee) : null,
          confirmations,
          blockHeight: item.height > 0 ? item.height : null,
          blockTime,
          rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
        });
        existingTxMap.set(`${item.tx_hash}:consolidation`, true);
      } else if (isSent && totalToExternal > 0 && !existingTxMap.has(`${item.tx_hash}:sent`)) {
        const sentAmount = -(totalToExternal + (fee ?? 0));
        transactionsToCreate.push({
          txid: item.tx_hash,
          walletId,
          addressId: addressRecord.id,
          type: 'sent',
          amount: BigInt(sentAmount),
          fee: fee !== null ? BigInt(fee) : null,
          confirmations,
          blockHeight: item.height > 0 ? item.height : null,
          blockTime,
          rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
        });
        existingTxMap.set(`${item.tx_hash}:sent`, true);
      } else if (!isSent && isReceived && !existingTxMap.has(`${item.tx_hash}:received`)) {
        const amount = outputs
          .filter((out: TransactionOutput) => {
            const outAddr = out.scriptPubKey?.address || out.scriptPubKey?.addresses?.[0];
            return outAddr && walletAddressSet.has(outAddr);
          })
          .reduce((sum: number, out: TransactionOutput) => sum + Math.round(out.value * 100000000), 0);

        transactionsToCreate.push({
          txid: item.tx_hash,
          walletId,
          addressId: addressRecord.id,
          type: 'received',
          amount: BigInt(amount),
          confirmations,
          blockHeight: item.height > 0 ? item.height : null,
          blockTime,
          rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
        });
        existingTxMap.set(`${item.tx_hash}:received`, true);
      }
    }
  }

  return transactionsToCreate;
}
