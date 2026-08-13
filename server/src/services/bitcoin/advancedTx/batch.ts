/**
 * Batch Transaction Support
 *
 * Implements batch transaction creation for sending to multiple
 * recipients in a single transaction, saving on fees compared
 * to individual transactions.
 */

import * as bitcoin from "bitcoinjs-lib";
import { addressToOutputScript, getNetwork } from "../utils";
import { getNodeClient } from "../nodeClient";
import type { BitcoinNetwork } from "../networks";
import { normalizeLegacyBitcoinNetwork } from "../networks";
import { utxoRepository, walletRepository } from "../../../repositories";
import { RBF_SEQUENCE, getDustThreshold } from "./shared";
import { WalletScriptType } from "@sanctuary/shared/constants/walletIdentity";
import type { PsbtSigningContext } from "@sanctuary/shared/schemas/psbtSigningContext";
import { bindPsbtAccount } from "../psbtAccountBinding";
import {
  addInputsWithBip32,
  fetchAddressDerivationPaths,
  parseAccountNode,
  resolveWalletSigningInfo,
} from "../transactions/psbtConstruction";
import { resolveTransactionSpendPolicy, transactionChangeScriptTemplate } from "../transactions/feePolicy";
import { prepareChangeOutputs } from "../transactions/outputBuilder";
import { estimateTransactionWeight, feeForRate } from "../transactionWeight";
import { buildSigningIntentFeePolicy } from "../signingIntent/feePolicy";
import type { SigningIntentFeePolicyV1 } from "../signingIntent/types";
import { assertExactUtxoSelection } from "../utxoSelection";

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
  feePolicy: SigningIntentFeePolicyV1;
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
    assertExactUtxoSelection(utxos, selectedUtxoIds);
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`),
    );
  }

  if (utxos.length === 0) {
    throw new Error("No spendable UTXOs available");
  }
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) throw new Error("Wallet script identity is unavailable");
  if (utxos.some(utxo => !utxo.scriptPubKey)) throw new Error("UTXO is missing scriptPubKey evidence");
  const networkObj = getNetwork(network);
  const signingInfo = resolveWalletSigningInfo(wallet, "[ADVANCED_BATCH] ");
  const recipientScripts = recipients.map(recipient =>
    addressToOutputScript(recipient.address, network));
  const changeScript = transactionChangeScriptTemplate(signingInfo);
  const addressPathMap = await fetchAddressDerivationPaths(walletId, utxos.map(utxo => utxo.address));
  const spendEvidence = new Map(utxos.map(utxo => [
    utxo.address,
    resolveTransactionSpendPolicy(
      signingInfo,
      addressPathMap.get(utxo.address) ?? (() => { throw new Error("Batch input spend evidence is missing"); })(),
      networkObj,
    ),
  ]));

  // Calculate total output amount
  const totalOutputAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

  // Select UTXOs to cover the amount
  const selectedUtxos: typeof utxos = [];
  let totalInput = 0;
  let fee = 0;
  let changeAmount = 0;
  let feeSurplusSats = 0;

  const estimateFee = (selected: typeof utxos, scripts: readonly Uint8Array[]) => feeForRate(
    estimateTransactionWeight({
      inputs: selected.map(utxo => ({
        ...(spendEvidence.get(utxo.address) ?? (() => { throw new Error("Batch input spend evidence is missing"); })()),
        prevoutScript: Buffer.from(utxo.scriptPubKey!, "hex"),
      })),
      outputs: scripts.map(scriptPubKey => ({ scriptPubKey })),
    }).vsize,
    feeRate,
  );

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += Number(utxo.amount);

    const feeWithChange = estimateFee(selectedUtxos, [...recipientScripts, changeScript]);
    const candidateChange = totalInput - totalOutputAmount - feeWithChange;
    if (candidateChange >= dustThreshold) {
      fee = feeWithChange;
      changeAmount = candidateChange;
      feeSurplusSats = 0;
      break;
    }
    const feeWithoutChange = estimateFee(selectedUtxos, recipientScripts);
    if (totalInput >= totalOutputAmount + feeWithoutChange) {
      fee = totalInput - totalOutputAmount;
      changeAmount = 0;
      feeSurplusSats = fee - feeWithoutChange;
      break;
    }
  }
  if (fee === 0) {
    const requiredFee = estimateFee(selectedUtxos, [...recipientScripts, changeScript]);
    throw new Error(
      `Insufficient funds. Need ${totalOutputAmount + requiredFee} sats, have ${totalInput} sats`,
    );
  }

  // Calculate savings vs individual transactions
  const totalIndividualFees = recipientScripts.reduce((sum, recipientScript) =>
    sum + estimateFee([selectedUtxos[0]], [recipientScript, changeScript]), 0);
  const savedFees = totalIndividualFees - fee;

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const rawTransactions = new Map<string, Buffer>();
  const isLegacy = wallet.scriptType === WalletScriptType.LEGACY;
  if (isLegacy) {
    const client = await getNodeClient(network);
    const rows = await Promise.all(selectedUtxos.map(async utxo => {
      const transaction = await client.getTransaction(utxo.txid);
      return [utxo.txid, Buffer.from(transaction.hex, "hex")] as const;
    }));
    for (const [txid, transaction] of rows) rawTransactions.set(txid, transaction);
  }

  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;
  addInputsWithBip32(psbt, selectedUtxos.map(utxo => ({
    ...utxo,
    scriptPubKey: utxo.scriptPubKey!,
  })), {
    sequence: RBF_SEQUENCE,
    isLegacy,
    rawTxCache: rawTransactions,
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
    logPrefix: "[ADVANCED_BATCH] ",
  });

  // Add recipient outputs
  for (const [index, recipient] of recipients.entries()) {
    psbt.addOutput({
      script: recipientScripts[index],
      value: BigInt(recipient.amount),
    });
  }

  // Add change output
  if (changeAmount >= dustThreshold) {
    const [preparedChange] = await prepareChangeOutputs(walletId, 1);
    psbt.addOutput({
      address: preparedChange.address,
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
    feePolicy: buildSigningIntentFeePolicy(
      psbt.toBase64(),
      feeRate,
      fee,
      feeSurplusSats,
    ),
  };
}
