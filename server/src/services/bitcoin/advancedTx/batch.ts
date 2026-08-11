/**
 * Batch Transaction Support
 *
 * Implements batch transaction creation for sending to multiple
 * recipients in a single transaction, saving on fees compared
 * to individual transactions.
 */

import * as bitcoin from "bitcoinjs-lib";
import { getNetwork, estimateTransactionSize, calculateFee } from "../utils";
import { getNodeClient } from "../nodeClient";
import type { BitcoinNetwork } from "../networks";
import { normalizeLegacyBitcoinNetwork } from "../networks";
import { utxoRepository, addressRepository, walletRepository } from "../../../repositories";
import { RBF_SEQUENCE, getDustThreshold } from "./shared";
import {
  parseWalletScriptType,
  WalletScriptType,
} from "@sanctuary/shared/constants/walletIdentity";
import { assertCanonicalAddressesForWallet } from "../../wallet/canonicalAddressValidation";
import type { PsbtSigningContext } from "@sanctuary/shared/schemas/psbtSigningContext";
import { bindPsbtAccount } from "../psbtAccountBinding";

/**
 * Create a batch transaction sending to multiple recipients
 */
export async function createBatchTransaction(
  recipients: Array<{ address: string; amount: number; label?: string }>,
  feeRate: number,
  walletId: string,
  selectedUtxoIds?: string[],
  network: BitcoinNetwork = "mainnet",
): Promise<{
  psbt: bitcoin.Psbt;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  savedFees: number; // Savings compared to individual transactions
  signingContext: PsbtSigningContext;
}> {
  if (recipients.length === 0) {
    throw new Error("At least one recipient is required");
  }

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get available UTXOs
  let utxos = await utxoRepository.findUnspent(walletId);

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`),
    );
  }

  if (utxos.length === 0) {
    throw new Error("No spendable UTXOs available");
  }
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  const walletScriptType = wallet && parseWalletScriptType(wallet.scriptType);
  if (!wallet || !walletScriptType) throw new Error("Wallet script identity is unavailable");

  // Calculate total output amount
  const totalOutputAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

  // Select UTXOs to cover the amount
  const selectedUtxos: typeof utxos = [];
  let totalInput = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += Number(utxo.amount);

    // Estimate fee with current inputs
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      recipients.length + 1, // +1 for change output
      walletScriptType,
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalInput >= totalOutputAmount + estimatedFee) {
      break;
    }
  }

  // Final fee calculation
  const txSize = estimateTransactionSize(
    selectedUtxos.length,
    recipients.length + 1,
    walletScriptType,
  );
  const fee = calculateFee(txSize, feeRate);

  if (totalInput < totalOutputAmount + fee) {
    throw new Error(
      `Insufficient funds. Need ${totalOutputAmount + fee} sats, have ${totalInput} sats`,
    );
  }

  const changeAmount = totalInput - totalOutputAmount - fee;

  // Calculate savings vs individual transactions
  const individualTxFee = calculateFee(
    estimateTransactionSize(1, 2, walletScriptType), // 1 in, 2 out (recipient + change)
    feeRate,
  );
  const totalIndividualFees = individualTxFee * recipients.length;
  const savedFees = totalIndividualFees - fee;

  // Create PSBT
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const rawTransactions = new Map<string, Buffer>();
  if (walletScriptType === WalletScriptType.LEGACY) {
    const client = await getNodeClient(network);
    const rows = await Promise.all(selectedUtxos.map(async utxo => {
      const transaction = await client.getTransaction(utxo.txid);
      return [utxo.txid, Buffer.from(transaction.hex, "hex")] as const;
    }));
    for (const [txid, transaction] of rows) rawTransactions.set(txid, transaction);
  }

  // Add inputs with RBF enabled
  for (const utxo of selectedUtxos) {
    const rawTransaction = rawTransactions.get(utxo.txid);
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: RBF_SEQUENCE,
      ...(walletScriptType === WalletScriptType.LEGACY ? {
        nonWitnessUtxo: rawTransaction!,
      } : { witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, "hex"),
        value: BigInt(utxo.amount),
      } }),
    });
  }

  // Add recipient outputs
  for (const recipient of recipients) {
    psbt.addOutput({
      address: recipient.address,
      value: BigInt(recipient.amount),
    });
  }

  // Add change output
  if (changeAmount >= dustThreshold) {
    const changeAddress = await addressRepository.findNextUnusedChange(walletId);

    if (!changeAddress) {
      throw new Error("No change address available");
    }
    await assertCanonicalAddressesForWallet(walletId, [changeAddress], 1);

    psbt.addOutput({
      address: changeAddress.address,
      value: BigInt(changeAmount),
    });
  }

  const signingContext = await bindPsbtAccount(walletId, psbt);
  if (signingContext.network !== normalizeLegacyBitcoinNetwork(network, "mainnet")) {
    throw new Error("PSBT account binding failed: batch network does not match wallet");
  }
  return {
    psbt,
    fee,
    totalInput,
    totalOutput: totalOutputAmount,
    changeAmount,
    savedFees,
    signingContext,
  };
}
