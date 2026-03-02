/**
 * Sync Address
 *
 * Fetches transactions and UTXOs for a single address from the blockchain
 * and updates the database. Used during wallet sync.
 */

import { getNodeClient } from '../nodeClient';
import type { TransactionOutput, TransactionInput } from '../electrum';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { getBlockHeight, getBlockTimestamp } from '../utils/blockHeight';
import type { SyncAddressResult } from './types';

const log = createLogger('BLOCKCHAIN');

/**
 * Calculate confirmations for a transaction (internal helper)
 * @param blockHeight - Block height of the transaction
 * @param network - Bitcoin network (defaults to mainnet for backwards compatibility)
 */
export async function getConfirmations(blockHeight: number, network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): Promise<number> {
  try {
    const currentHeight = await getBlockHeight(network);
    return Math.max(0, currentHeight - blockHeight + 1);
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get confirmations', { error: String(error), network });
    return 0;
  }
}

/**
 * Sync address with blockchain
 * Fetches transactions and UTXOs for an address and updates database
 */
export async function syncAddress(addressId: string): Promise<SyncAddressResult> {
  const addressRecord = await prisma.address.findUnique({
    where: { id: addressId },
    include: { wallet: true },
  });

  if (!addressRecord) {
    throw new Error('Address not found');
  }

  // Get network from wallet for correct block height lookups
  const network = (addressRecord.wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
  const client = await getNodeClient(network);

  try {
    // Get transaction history
    const history = await client.getAddressHistory(addressRecord.address);

    let transactionCount = 0;
    let utxoCount = 0;

    // Helper to check if output matches our address
    // Handles both legacy format (addresses array) and segwit format (address singular)
    const outputMatchesAddress = (out: TransactionOutput, address: string): boolean => {
      if (out.scriptPubKey?.address === address) return true;
      if (out.scriptPubKey?.addresses?.includes(address)) return true;
      return false;
    };

    // Get all wallet addresses for checking inputs (to detect sends)
    const walletAddresses = await prisma.address.findMany({
      where: { walletId: addressRecord.walletId },
      select: { address: true },
    });
    const walletAddressSet = new Set(walletAddresses.map(a => a.address));

    // BATCH OPTIMIZATION: Pre-fetch all transaction details and previous transactions
    // Phase 1: Batch fetch all history transaction details
    const historyTxIds = history.map(h => h.tx_hash);
    const txDetailsMap = await client.getTransactionsBatch(historyTxIds, true);

    // Phase 2: Identify all previous transaction IDs needed for inputs without prevout info
    const prevTxIdsNeeded = new Set<string>();
    for (const item of history) {
      const txDetails = txDetailsMap.get(item.tx_hash);
      if (!txDetails) continue;

      for (const input of txDetails.vin || []) {
        if (input.coinbase) continue;
        // If no prevout info available, we need to fetch the previous transaction
        if (!input.prevout && input.txid && !txDetailsMap.has(input.txid)) {
          prevTxIdsNeeded.add(input.txid);
        }
      }
    }

    // Phase 3: Batch fetch all needed previous transactions
    if (prevTxIdsNeeded.size > 0) {
      const prevTxDetails = await client.getTransactionsBatch([...prevTxIdsNeeded], true);
      // Merge into main map for unified lookups
      for (const [txid, details] of prevTxDetails) {
        txDetailsMap.set(txid, details);
      }
      log.debug(`[BLOCKCHAIN] Batch fetched ${prevTxIdsNeeded.size} previous transactions for input lookups`);
    }

    // BATCH OPTIMIZATION: Pre-fetch all existing transactions for this wallet to avoid N+1 queries
    const existingWalletTxs = await prisma.transaction.findMany({
      where: {
        walletId: addressRecord.walletId,
        txid: { in: historyTxIds },
      },
      select: { txid: true, type: true },
    });
    // Create lookup map: "txid:type" -> true for O(1) existence checks
    const existingTxLookup = new Set(
      existingWalletTxs.map(tx => `${tx.txid}:${tx.type}`)
    );

    // Process each transaction using cached data
    for (const item of history) {
      // Use cached transaction details
      const txDetails = txDetailsMap.get(item.tx_hash);
      if (!txDetails) {
        log.warn(`[BLOCKCHAIN] Transaction ${item.tx_hash} not found in batch fetch`);
        continue;
      }

      const outputs: TransactionOutput[] = txDetails.vout || [];
      const inputs: TransactionInput[] = txDetails.vin || [];

      // Check if this address received funds (is in outputs)
      const isReceived = outputs.some((out) =>
        outputMatchesAddress(out, addressRecord.address)
      );

      // Check if this address sent funds (is in inputs)
      let isSent = false;
      let totalSentFromWallet = 0;
      let hasCompleteInputData = true;

      for (const input of inputs) {
        if (input.coinbase) continue;

        let inputAddr: string | undefined;
        let inputValue: number | undefined;

        if (input.prevout && input.prevout.scriptPubKey) {
          inputAddr = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          inputValue = input.prevout.value;
        } else if (input.txid && input.vout !== undefined) {
          const prevTx = txDetailsMap.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            inputAddr = prevOutput.scriptPubKey?.address ||
              (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            inputValue = prevOutput.value;
          }
        }

        if (inputAddr && walletAddressSet.has(inputAddr)) {
          isSent = true;
          if (inputValue !== undefined && inputValue > 0) {
            totalSentFromWallet += Math.round(inputValue * 100000000);
          } else {
            hasCompleteInputData = false;
          }
        }
      }

      // Get block timestamp - prefer txDetails.time, fall back to block header
      let blockTime: Date | null = null;
      if (txDetails.time) {
        blockTime = new Date(txDetails.time * 1000);
      } else if (item.height > 0) {
        blockTime = await getBlockTimestamp(item.height);
      }

      if (isReceived) {
        const existingReceivedTx = existingTxLookup.has(`${item.tx_hash}:received`);

        if (!existingReceivedTx) {
          const amount = outputs
            .filter((out) => outputMatchesAddress(out, addressRecord.address))
            .reduce((sum, out) => sum + Math.round(out.value * 100000000), 0);

          await prisma.transaction.create({
            data: {
              txid: item.tx_hash,
              walletId: addressRecord.walletId,
              addressId: addressRecord.id,
              type: 'received',
              amount: BigInt(amount),
              confirmations: item.height > 0 ? await getConfirmations(item.height, network) : 0,
              blockHeight: item.height > 0 ? item.height : null,
              blockTime,
            },
          });

          transactionCount++;
        }
      }

      if (isSent) {
        let totalToExternal = 0;
        let totalToWallet = 0;
        for (const out of outputs) {
          const outAddr = out.scriptPubKey?.address ||
            (out.scriptPubKey?.addresses && out.scriptPubKey.addresses[0]);
          const outValue = Math.round(out.value * 100000000);
          if (outAddr && !walletAddressSet.has(outAddr)) {
            totalToExternal += outValue;
          } else if (outAddr) {
            totalToWallet += outValue;
          }
        }

        const fee = hasCompleteInputData ? totalSentFromWallet - totalToExternal - totalToWallet : null;
        const validFee = fee !== null && fee >= 0 ? fee : null;

        if (totalToExternal > 0) {
          const existingSentTx = existingTxLookup.has(`${item.tx_hash}:sent`);

          if (!existingSentTx) {
            const sentAmount = -(totalToExternal + (validFee ?? 0));
            await prisma.transaction.create({
              data: {
                txid: item.tx_hash,
                walletId: addressRecord.walletId,
                addressId: addressRecord.id,
                type: 'sent',
                amount: BigInt(sentAmount),
                fee: validFee !== null ? BigInt(validFee) : null,
                confirmations: item.height > 0 ? await getConfirmations(item.height, network) : 0,
                blockHeight: item.height > 0 ? item.height : null,
                blockTime,
              },
            });

            transactionCount++;
          }
        } else if (totalToWallet > 0) {
          const existingConsolidationTx = existingTxLookup.has(`${item.tx_hash}:consolidation`);

          if (!existingConsolidationTx) {
            await prisma.transaction.create({
              data: {
                txid: item.tx_hash,
                walletId: addressRecord.walletId,
                addressId: addressRecord.id,
                type: 'consolidation',
                amount: validFee !== null ? BigInt(-validFee) : BigInt(0),
                fee: validFee !== null ? BigInt(validFee) : null,
                confirmations: item.height > 0 ? await getConfirmations(item.height, network) : 0,
                blockHeight: item.height > 0 ? item.height : null,
                blockTime,
              },
            });

            transactionCount++;
          }
        }
      }
    }

    // Get and process UTXOs (batch optimized)
    const utxos = await client.getAddressUTXOs(addressRecord.address);

    // Batch fetch any UTXO transactions not already in cache
    const utxoTxIdsNeeded = utxos
      .filter(utxo => !txDetailsMap.has(utxo.tx_hash))
      .map(utxo => utxo.tx_hash);

    if (utxoTxIdsNeeded.length > 0) {
      const utxoTxDetails = await client.getTransactionsBatch([...new Set(utxoTxIdsNeeded)], true);
      for (const [txid, details] of utxoTxDetails) {
        txDetailsMap.set(txid, details);
      }
    }

    // Collect UTXOs for batch creation
    const utxosToCreate: Array<{
      walletId: string;
      txid: string;
      vout: number;
      address: string;
      amount: bigint;
      scriptPubKey: string;
      confirmations: number;
      blockHeight: number | null;
      spent: boolean;
    }> = [];

    // Get existing UTXOs in batch
    const existingUtxos = await prisma.uTXO.findMany({
      where: {
        OR: utxos.map(utxo => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
        })),
      },
      select: { txid: true, vout: true },
    });
    const existingUtxoSet = new Set(existingUtxos.map(u => `${u.txid}:${u.vout}`));

    for (const utxo of utxos) {
      const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
      if (existingUtxoSet.has(key)) continue;

      const txDetails = txDetailsMap.get(utxo.tx_hash);
      if (!txDetails || !txDetails.vout || !txDetails.vout[utxo.tx_pos]) continue;

      const output = txDetails.vout[utxo.tx_pos];
      const confirmations = utxo.height > 0 ? await getConfirmations(utxo.height, network) : 0;

      utxosToCreate.push({
        walletId: addressRecord.walletId,
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        address: addressRecord.address,
        amount: BigInt(utxo.value),
        scriptPubKey: output.scriptPubKey.hex,
        confirmations,
        blockHeight: utxo.height > 0 ? utxo.height : null,
        spent: false,
      });
    }

    // Batch insert new UTXOs
    if (utxosToCreate.length > 0) {
      await prisma.uTXO.createMany({
        data: utxosToCreate,
        skipDuplicates: true,
      });
      utxoCount = utxosToCreate.length;
    }

    // Mark address as used if it has transactions
    if (history.length > 0 && !addressRecord.used) {
      await prisma.address.update({
        where: { id: addressId },
        data: { used: true },
      });
    }

    // Store transaction inputs/outputs for newly created transactions (batch optimized)
    if (transactionCount > 0) {
      try {
        const txsWithoutIO = await prisma.transaction.findMany({
          where: {
            walletId: addressRecord.walletId,
            txid: { in: history.map(h => h.tx_hash) },
            inputs: { none: {} },
            outputs: { none: {} },
          },
          select: { id: true, txid: true, type: true },
        });

        if (txsWithoutIO.length > 0) {
          const txidsToFetch = txsWithoutIO.map(tx => tx.txid);
          const txDetailsMap = await client.getTransactionsBatch(txidsToFetch, true);

          const txInputsToCreate: Array<{
            transactionId: string;
            inputIndex: number;
            txid: string;
            vout: number;
            address: string;
            amount: bigint;
          }> = [];

          const txOutputsToCreate: Array<{
            transactionId: string;
            outputIndex: number;
            address: string;
            amount: bigint;
            scriptPubKey?: string;
            outputType: string;
            isOurs: boolean;
          }> = [];

          for (const txRecord of txsWithoutIO) {
            const txDetails = txDetailsMap.get(txRecord.txid);
            if (!txDetails) continue;

            const inputs = txDetails.vin || [];
            const outputs = txDetails.vout || [];

            for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
              const input = inputs[inputIdx];
              if (input.coinbase) continue;

              let inputAddress: string | undefined;
              let inputAmount = 0;

              if (input.prevout && input.prevout.scriptPubKey) {
                inputAddress = input.prevout.scriptPubKey.address ||
                  (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
                if (input.prevout.value !== undefined) {
                  inputAmount = input.prevout.value >= 1000000
                    ? input.prevout.value
                    : Math.round(input.prevout.value * 100000000);
                }
              }

              if (inputAddress && input.txid !== undefined && input.vout !== undefined) {
                txInputsToCreate.push({
                  transactionId: txRecord.id,
                  inputIndex: inputIdx,
                  txid: input.txid,
                  vout: input.vout,
                  address: inputAddress,
                  amount: BigInt(inputAmount),
                });
              }
            }

            for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
              const output = outputs[outputIdx];
              const outputAddress = output.scriptPubKey?.address ||
                (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);

              if (!outputAddress) continue;

              const outputAmount = Math.round((output.value || 0) * 100000000);
              const isOurs = walletAddressSet.has(outputAddress);

              let outputType = 'unknown';
              if (txRecord.type === 'sent') {
                outputType = isOurs ? 'change' : 'recipient';
              } else if (txRecord.type === 'received') {
                outputType = isOurs ? 'recipient' : 'unknown';
              } else if (txRecord.type === 'consolidation') {
                outputType = 'consolidation';
              }

              txOutputsToCreate.push({
                transactionId: txRecord.id,
                outputIndex: outputIdx,
                address: outputAddress,
                amount: BigInt(outputAmount),
                scriptPubKey: output.scriptPubKey?.hex,
                outputType,
                isOurs,
              });
            }
          }

          if (txInputsToCreate.length > 0) {
            await prisma.transactionInput.createMany({
              data: txInputsToCreate,
              skipDuplicates: true,
            });
          }

          if (txOutputsToCreate.length > 0) {
            await prisma.transactionOutput.createMany({
              data: txOutputsToCreate,
              skipDuplicates: true,
            });
          }

          log.debug(`[BLOCKCHAIN] Stored I/O for ${txsWithoutIO.length} transactions (${txInputsToCreate.length} inputs, ${txOutputsToCreate.length} outputs)`);
        }
      } catch (ioError) {
        log.warn(`[BLOCKCHAIN] Failed to store transaction I/O in address sync: ${ioError}`);
      }
    }

    return {
      transactions: transactionCount,
      utxos: utxoCount,
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Sync address error', { error: String(error) });
    throw error;
  }
}
