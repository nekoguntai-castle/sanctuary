/**
 * Create Batch Transaction Module
 *
 * Handles multi-output (batch) transaction creation with PSBT construction.
 * Supports:
 * - Multiple recipient outputs
 * - Send-max on one output (allocate remaining balance)
 * - Confirmation threshold enforcement
 * - Draft UTXO lock awareness
 */

import * as bitcoin from 'bitcoinjs-lib';
import { addressToOutputScript, getNetwork } from '../utils';
import type { LegacyNetworkType } from '@sanctuary/shared/constants/bitcoin';
import { normalizeLegacyBitcoinNetwork } from '../networks';
import { RBF_SEQUENCE } from '../advancedTx';
import { walletRepository, utxoRepository, systemSettingRepository } from '../../../repositories';
import { DEFAULT_CONFIRMATION_THRESHOLD } from '../../../constants';
import { createLogger } from '../../../utils/logger';
import { SystemSettingSchemas } from '../../../utils/safeJson';
import { getDustThreshold } from '../estimation';
import { isLegacyScriptType } from './helpers';
import {
  resolveWalletSigningInfo,
  parseAccountNode,
  fetchRawTransactionsForLegacy,
  fetchAddressDerivationPaths,
  addInputsWithBip32,
  type AddInputsWithBip32Options,
} from './psbtConstruction';
import { prepareChangeOutputs } from './outputBuilder';
import type { TransactionOutput, CreateBatchTransactionResult } from './types';
import { bindPsbtAccount } from '../psbtAccountBinding';
import { estimateTransactionWeight, feeForRate } from '../transactionWeight';
import { assertExactUtxoSelection, type SpendEvidence } from '../utxoSelection';
import { createTransactionSpendPolicyResolver, transactionChangeScriptTemplate } from './feePolicy';
import { buildSigningIntentFeePolicy } from '../signingIntent/feePolicy';

const log = createLogger('BITCOIN:SVC_TX_BATCH');

interface BatchTransactionOptions {
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  label?: string;
  memo?: string;
}

/**
 * Create a batch transaction with multiple outputs
 */
export async function createBatchTransaction(
  walletId: string,
  outputs: TransactionOutput[],
  feeRate: number,
  options: BatchTransactionOptions = {}
): Promise<CreateBatchTransactionResult> {
  const { selectedUtxoIds, enableRBF = true } = options;

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet info including devices (for fingerprint)
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet');
  const networkObj = getNetwork(network);
  const recipientScripts = parseBatchOutputScripts(outputs, network);
  const signingInfo = resolveWalletSigningInfo(wallet, '[BATCH] ');
  const resolveSpendPolicies = createTransactionSpendPolicyResolver(walletId, signingInfo, networkObj);

  // Check if any output has sendMax
  const sendMaxOutputIndex = outputs.findIndex(o => o.sendMax);
  const hasSendMax = sendMaxOutputIndex !== -1;

  // Get available UTXOs
  let utxos = await getAvailableUtxos(walletId, selectedUtxoIds);

  log.info(`[BATCH] Creating batch transaction with ${utxos.length} UTXOs`, {
    walletId,
    utxoCount: utxos.length,
    hasSelectedUtxos: !!selectedUtxoIds && selectedUtxoIds.length > 0,
    hasSendMax,
    outputs: outputs.map(o => ({ address: o.address.slice(0, 10) + '...', amount: o.amount, sendMax: o.sendMax })),
  });

  assertUtxosHaveScriptPubKeys(utxos);
  const spendPolicies = await resolveSpendPolicies(utxos);
  const changeScript = hasSendMax ? undefined : transactionChangeScriptTemplate(signingInfo);
  // Calculate amounts and select UTXOs
  let calculation = calculateBatchAmounts(
    utxos,
    outputs,
    recipientScripts,
    changeScript,
    sendMaxOutputIndex,
    hasSendMax,
    feeRate,
    dustThreshold,
    spendPolicies,
  );
  let preparedChangeAddress: string | undefined;
  if (!hasSendMax && calculation.changeAmount >= dustThreshold) {
    const [preparedChange] = await prepareChangeOutputs(walletId, 1);
    preparedChangeAddress = preparedChange.address;
    calculation = calculateBatchAmounts(
      utxos,
      outputs,
      recipientScripts,
      preparedChange.scriptPubKey,
      sendMaxOutputIndex,
      false,
      feeRate,
      dustThreshold,
      spendPolicies,
    );
  }
  const { finalOutputs, changeAmount, selectedUtxos, estimatedFee, feeSurplusSats } = calculation;
  utxos = selectedUtxos;

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const sequence = enableRBF ? RBF_SEQUENCE : 0xffffffff;
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // Fetch address derivation paths for inputs
  const utxoAddresses = utxos.map(u => u.address);
  const addressPathMap = await fetchAddressDerivationPaths(walletId, utxoAddresses);

  // Parse account xpub for key derivation
  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;

  // Fetch raw transactions for legacy wallets
  const rawTxCache = isLegacy
    ? await fetchRawTransactionsForLegacy(utxos.map(u => u.txid), network)
    : new Map<string, Buffer>();

  const inputPaths = addBatchInputs(psbt, utxos, {
    sequence,
    isLegacy,
    rawTxCache,
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
  });
  addBatchOutputs(psbt, finalOutputs, network);

  // Add change output if needed
  let changeAddress: string | undefined;

  if (!hasSendMax && changeAmount >= dustThreshold) {
    changeAddress = preparedChangeAddress;
    if (!changeAddress) throw new Error('No prepared change address available');

    psbt.addOutput({
      address: changeAddress,
      value: BigInt(changeAmount),
    });
  }

  const totalInput = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  const totalOutput = finalOutputs.reduce((sum, o) => sum + o.amount, 0) + (changeAmount >= dustThreshold ? changeAmount : 0);
  const signingContext = await bindPsbtAccount(walletId, psbt);

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: estimatedFee,
    totalInput,
    totalOutput,
    changeAmount: hasSendMax ? 0 : changeAmount,
    changeAddress,
    utxos: utxos.map(u => ({ txid: u.txid, vout: u.vout, address: u.address, amount: Number(u.amount) })),
    inputPaths,
    outputs: finalOutputs,
    signingContext,
    feePolicy: buildSigningIntentFeePolicy(
      psbt.toBase64(),
      feeRate,
      estimatedFee,
      feeSurplusSats,
    ),
  };
}

/**
 * UTXO record shape from repository query
 */
interface UtxoRecord {
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  scriptPubKey: string;
}

function parseBatchOutputScripts(
  outputs: TransactionOutput[],
  network: LegacyNetworkType,
): Uint8Array[] {
  if (outputs.length === 0) {
    throw new Error('At least one output is required');
  }

  return outputs.map((output) => {
    try {
      return addressToOutputScript(output.address, network);
    } catch {
      throw new Error(`Invalid address: ${output.address}`);
    }
  });
}

function assertUtxosHaveScriptPubKeys(utxos: UtxoRecord[]): void {
  const invalidUtxos = utxos.filter(u => !u.scriptPubKey || u.scriptPubKey.length === 0);
  if (invalidUtxos.length === 0) {
    return;
  }

  log.error('[BATCH] UTXOs missing scriptPubKey', {
    invalidCount: invalidUtxos.length,
    invalidUtxos: invalidUtxos.map(u => ({ txid: u.txid, vout: u.vout, address: u.address })),
  });
  throw new Error(`${invalidUtxos.length} UTXO(s) are missing scriptPubKey data and cannot be spent. Please sync your wallet.`);
}

function addBatchInputs(
  psbt: bitcoin.Psbt,
  utxos: UtxoRecord[],
  options: AddInputsWithBip32Options
): string[] {
  return addInputsWithBip32(
    psbt,
    utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      amount: Number(u.amount),
      address: u.address,
      scriptPubKey: u.scriptPubKey,
    })),
    { ...options, logPrefix: '[BATCH] ' }
  );
}

function addBatchOutputs(
  psbt: bitcoin.Psbt,
  outputs: Array<{ address: string; amount: number }>,
  network: LegacyNetworkType,
): void {
  for (const output of outputs) {
    psbt.addOutput({
      script: addressToOutputScript(output.address, network),
      value: BigInt(output.amount),
    });
  }
}

/**
 * Get available UTXOs for batch transaction, respecting confirmation threshold and draft locks.
 */
async function getAvailableUtxos(
  walletId: string,
  selectedUtxoIds?: string[]
): Promise<UtxoRecord[]> {
  // Get confirmation threshold setting
  const confirmationThreshold = await systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD);

  const hasUserSelection = selectedUtxoIds && selectedUtxoIds.length > 0;

  let utxos = await utxoRepository.findAvailableForSpending(walletId, {
    minConfirmations: confirmationThreshold,
    // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
    excludeDraftLocked: !hasUserSelection,
  });

  // Filter by selected UTXOs if provided
  if (hasUserSelection) {
    assertExactUtxoSelection(utxos, selectedUtxoIds);
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  return utxos;
}

/**
 * Calculate final output amounts for batch transaction, handling sendMax and UTXO selection.
 */
function calculateBatchAmounts(
  utxos: UtxoRecord[],
  outputs: TransactionOutput[],
  recipientScripts: Uint8Array[],
  changeScript: Uint8Array | undefined,
  sendMaxOutputIndex: number,
  hasSendMax: boolean,
  feeRate: number,
  dustThreshold: number,
  spendPolicies: ReadonlyMap<string, SpendEvidence>,
): {
  finalOutputs: Array<{ address: string; amount: number }>;
  changeAmount: number;
  selectedUtxos: UtxoRecord[];
  estimatedFee: number;
  feeSurplusSats: number;
} {
  const totalAvailable = utxos.reduce((sum, u) => sum + Number(u.amount), 0);

  // Calculate fixed output amounts (non-sendMax outputs)
  const fixedOutputTotal = outputs
    .filter((_, i) => i !== sendMaxOutputIndex)
    .reduce((sum, o) => sum + o.amount, 0);

  const estimateFee = (selected: UtxoRecord[], scripts: Uint8Array[]): number => feeForRate(
    estimateTransactionWeight({
      inputs: selected.map(utxo => ({
        ...(spendPolicies.get(utxo.address) ?? (() => { throw new Error('UTXO spend policy evidence is missing'); })()),
        prevoutScript: Buffer.from(utxo.scriptPubKey, 'hex'),
      })),
      outputs: scripts.map(scriptPubKey => ({ scriptPubKey })),
    }).vsize,
    feeRate,
  );

  if (hasSendMax) {
    const estimatedFee = estimateFee(utxos, recipientScripts);
    // Calculate remaining balance for sendMax output
    const sendMaxAmount = totalAvailable - fixedOutputTotal - estimatedFee;
    if (sendMaxAmount < dustThreshold) {
      throw new Error(
        `Insufficient funds. Send-max output ${sendMaxAmount} sats is below dust threshold ${dustThreshold} sats`
      );
    }

    return {
      finalOutputs: outputs.map((o, i) => ({
        address: o.address,
        amount: i === sendMaxOutputIndex ? sendMaxAmount : o.amount,
      })),
      changeAmount: 0,
      selectedUtxos: utxos,
      estimatedFee,
      feeSurplusSats: 0,
    };
  }

  // Normal batch: select UTXOs to cover all outputs + fee
  const targetAmount = fixedOutputTotal;
  const selectedUtxos: UtxoRecord[] = [];
  let selectedTotal = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    selectedTotal += Number(utxo.amount);

    if (changeScript) {
      const feeWithChange = estimateFee(selectedUtxos, [...recipientScripts, changeScript]);
      const changeAmount = selectedTotal - targetAmount - feeWithChange;
      if (changeAmount >= dustThreshold) {
        return {
          finalOutputs: outputs.map(output => ({ address: output.address, amount: output.amount })),
          changeAmount,
          selectedUtxos,
          estimatedFee: feeWithChange,
          feeSurplusSats: 0,
        };
      }
    }
    const feeWithoutChange = estimateFee(selectedUtxos, recipientScripts);
    if (selectedTotal >= targetAmount + feeWithoutChange) {
      return {
        finalOutputs: outputs.map(output => ({ address: output.address, amount: output.amount })),
        changeAmount: 0,
        selectedUtxos,
        estimatedFee: selectedTotal - targetAmount,
        feeSurplusSats: selectedTotal - targetAmount - feeWithoutChange,
      };
    }
  }

  const finalScripts = changeScript ? [...recipientScripts, changeScript] : recipientScripts;
  const finalFee = estimateFee(selectedUtxos, finalScripts);
  throw new Error(`Insufficient funds. Need ${targetAmount + finalFee} sats, have ${selectedTotal} sats`);
}
