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
import { getNetwork, estimateTransactionSize, calculateFee } from '../utils';
import { RBF_SEQUENCE } from '../advancedTx';
import { db as prisma } from '../../../repositories/db';
import { DEFAULT_CONFIRMATION_THRESHOLD } from '../../../constants';
import { createLogger } from '../../../utils/logger';
import { safeJsonParse, SystemSettingSchemas } from '../../../utils/safeJson';
import { getDustThreshold } from '../estimation';
import { isLegacyScriptType } from './helpers';
import {
  resolveWalletSigningInfo,
  parseAccountNode,
  fetchRawTransactionsForLegacy,
  fetchAddressDerivationPaths,
  addInputsWithBip32,
} from './psbtConstruction';
import type { TransactionOutput, CreateBatchTransactionResult } from './types';

const log = createLogger('BATCH-TX');

/**
 * Create a batch transaction with multiple outputs
 */
export async function createBatchTransaction(
  walletId: string,
  outputs: TransactionOutput[],
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
  } = {}
): Promise<CreateBatchTransactionResult> {
  const { selectedUtxoIds, enableRBF = true } = options;

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet info including devices (for fingerprint)
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  if (outputs.length === 0) {
    throw new Error('At least one output is required');
  }

  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Resolve wallet signing info (fingerprints, xpubs, multisig keys)
  const signingInfo = resolveWalletSigningInfo(wallet, '[BATCH] ');

  // Validate all output addresses
  for (const output of outputs) {
    try {
      bitcoin.address.toOutputScript(output.address, networkObj);
    } catch (error) {
      throw new Error(`Invalid address: ${output.address}`);
    }
  }

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

  // Validate all UTXOs have required scriptPubKey
  const invalidUtxos = utxos.filter(u => !u.scriptPubKey || u.scriptPubKey.length === 0);
  if (invalidUtxos.length > 0) {
    log.error('[BATCH] UTXOs missing scriptPubKey', {
      invalidCount: invalidUtxos.length,
      invalidUtxos: invalidUtxos.map(u => ({ txid: u.txid, vout: u.vout, address: u.address })),
    });
    throw new Error(`${invalidUtxos.length} UTXO(s) are missing scriptPubKey data and cannot be spent. Please sync your wallet.`);
  }

  // Calculate amounts and select UTXOs
  const { finalOutputs, changeAmount, selectedUtxos, estimatedFee } = calculateBatchAmounts(
    utxos, outputs, sendMaxOutputIndex, hasSendMax, feeRate
  );
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
    ? await fetchRawTransactionsForLegacy(utxos.map(u => u.txid))
    : new Map<string, Buffer>();

  // Add inputs with BIP32 derivation info
  const inputPaths = addInputsWithBip32(
    psbt,
    utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      amount: Number(u.amount),
      address: u.address,
      scriptPubKey: u.scriptPubKey,
    })),
    {
      sequence,
      isLegacy,
      rawTxCache,
      addressPathMap,
      signingInfo,
      accountNode,
      networkObj,
      logPrefix: '[BATCH] ',
    }
  );

  // Add recipient outputs
  for (const output of finalOutputs) {
    psbt.addOutput({
      address: output.address,
      value: output.amount,
    });
  }

  // Add change output if needed
  let changeAddress: string | undefined;

  if (!hasSendMax && changeAmount >= dustThreshold) {
    changeAddress = await findBatchChangeAddress(walletId);

    psbt.addOutput({
      address: changeAddress,
      value: changeAmount,
    });
  }

  const totalInput = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  const totalOutput = finalOutputs.reduce((sum, o) => sum + o.amount, 0) + (changeAmount >= dustThreshold ? changeAmount : 0);

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
  };
}

/**
 * UTXO record shape from Prisma query
 */
type UtxoRecord = Awaited<ReturnType<typeof prisma.uTXO.findMany>>[number];

/**
 * Get available UTXOs for batch transaction, respecting confirmation threshold and draft locks.
 */
async function getAvailableUtxos(
  walletId: string,
  selectedUtxoIds?: string[]
): Promise<UtxoRecord[]> {
  // Get confirmation threshold setting
  const thresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: 'confirmationThreshold' },
  });
  const confirmationThreshold = safeJsonParse(
    thresholdSetting?.value,
    SystemSettingSchemas.number,
    DEFAULT_CONFIRMATION_THRESHOLD,
    'confirmationThreshold'
  );

  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
      confirmations: { gte: confirmationThreshold },
      // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
      ...(selectedUtxoIds && selectedUtxoIds.length > 0
        ? {} // Don't filter locks if user selected specific UTXOs
        : { draftLock: null }), // Auto-selection: exclude locked UTXOs
    },
    orderBy: { amount: 'desc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
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
  sendMaxOutputIndex: number,
  hasSendMax: boolean,
  feeRate: number
): {
  finalOutputs: Array<{ address: string; amount: number }>;
  changeAmount: number;
  selectedUtxos: UtxoRecord[];
  estimatedFee: number;
} {
  const totalAvailable = utxos.reduce((sum, u) => sum + Number(u.amount), 0);

  // Calculate fixed output amounts (non-sendMax outputs)
  const fixedOutputTotal = outputs
    .filter((_, i) => i !== sendMaxOutputIndex)
    .reduce((sum, o) => sum + o.amount, 0);

  // Determine number of outputs: specified outputs + possible change
  const numOutputs = hasSendMax ? outputs.length : outputs.length + 1;

  // Estimate fee
  const estimatedSize = estimateTransactionSize(utxos.length, numOutputs, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  if (hasSendMax) {
    // Calculate remaining balance for sendMax output
    const sendMaxAmount = totalAvailable - fixedOutputTotal - estimatedFee;
    if (sendMaxAmount <= 0) {
      throw new Error(
        `Insufficient funds. Need ${fixedOutputTotal + estimatedFee} sats for outputs and fee, have ${totalAvailable} sats`
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
    };
  }

  // Normal batch: select UTXOs to cover all outputs + fee
  const targetAmount = fixedOutputTotal;
  const selectedUtxos: UtxoRecord[] = [];
  let selectedTotal = 0;
  let changeAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    selectedTotal += Number(utxo.amount);

    // Re-estimate fee with current selection
    const currentSize = estimateTransactionSize(selectedUtxos.length, outputs.length + 1, 'native_segwit');
    const currentFee = calculateFee(currentSize, feeRate);

    if (selectedTotal >= targetAmount + currentFee) {
      changeAmount = selectedTotal - targetAmount - currentFee;
      break;
    }
  }

  // Check if we have enough
  const finalSize = estimateTransactionSize(selectedUtxos.length, outputs.length + 1, 'native_segwit');
  const finalFee = calculateFee(finalSize, feeRate);
  if (selectedTotal < targetAmount + finalFee) {
    throw new Error(
      `Insufficient funds. Need ${targetAmount + finalFee} sats, have ${selectedTotal} sats`
    );
  }

  return {
    finalOutputs: outputs.map(o => ({
      address: o.address,
      amount: o.amount,
    })),
    changeAmount,
    selectedUtxos,
    estimatedFee,
  };
}

/**
 * Find a change address for a batch transaction.
 */
async function findBatchChangeAddress(walletId: string): Promise<string> {
  const existingChangeAddress = await prisma.address.findFirst({
    where: {
      walletId,
      used: false,
      derivationPath: { contains: '/1/' },
    },
    orderBy: { index: 'asc' },
  });

  if (existingChangeAddress) {
    return existingChangeAddress.address;
  }

  const receivingAddress = await prisma.address.findFirst({
    where: { walletId, used: false },
    orderBy: { index: 'asc' },
  });

  if (!receivingAddress) {
    throw new Error('No change address available');
  }

  return receivingAddress.address;
}
