/**
 * Create Transaction Module
 *
 * Handles single-recipient transaction creation with PSBT construction.
 * Supports:
 * - Normal transactions (amount + fee from UTXOs)
 * - Send-max (entire balance minus fee)
 * - Subtract-fees (fee deducted from amount)
 * - Decoy change outputs (privacy enhancement)
 * - RBF (Replace-By-Fee) signaling
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, estimateTransactionSize, calculateFee } from '../utils';
import { RBF_SEQUENCE } from '../advancedTx';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { selectUTXOs, UTXOSelectionStrategy } from '../utxoSelection';
import { getDustThreshold } from '../estimation';
import { generateDecoyAmounts } from '../psbtBuilder';
import { isLegacyScriptType } from './helpers';
import {
  resolveWalletSigningInfo,
  parseAccountNode,
  fetchRawTransactionsForLegacy,
  fetchAddressDerivationPaths,
  addInputsWithBip32,
} from './psbtConstruction';
import type { PendingOutput, CreateTransactionResult } from './types';

const log = createLogger('CREATE-TX');

/**
 * Create a transaction
 */
export async function createTransaction(
  walletId: string,
  recipient: string,
  amount: number,
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
    sendMax?: boolean; // Send entire balance (no change output)
    subtractFees?: boolean; // Subtract fees from amount instead of adding
    decoyOutputs?: {
      enabled: boolean;
      count: number; // 2-4 additional outputs
    };
  } = {}
): Promise<CreateTransactionResult> {
  const { selectedUtxoIds, enableRBF = true, sendMax = false, subtractFees = false, decoyOutputs } = options;

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

  log.debug('createTransaction', { walletId, scriptType: wallet.scriptType });

  // Validate recipient address
  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Resolve wallet signing info (fingerprints, xpubs, multisig keys)
  const signingInfo = resolveWalletSigningInfo(wallet, 'BIP32 derivation: ');

  try {
    bitcoin.address.toOutputScript(recipient, networkObj);
  } catch (error) {
    throw new Error('Invalid recipient address');
  }

  // Select UTXOs based on transaction mode
  const { effectiveAmount, selection } = await selectUtxosForMode(
    walletId, amount, feeRate, dustThreshold, sendMax, subtractFees, selectedUtxoIds
  );

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const sequence = enableRBF ? RBF_SEQUENCE : 0xffffffff;
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // Fetch address derivation paths for inputs
  const utxoAddresses = selection.utxos.map(u => u.address);
  const addressPathMap = await fetchAddressDerivationPaths(walletId, utxoAddresses);

  // Parse account xpub for key derivation
  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;

  // Fetch raw transactions for legacy wallets
  const rawTxCache = isLegacy
    ? await fetchRawTransactionsForLegacy(selection.utxos.map(u => u.txid))
    : new Map<string, Buffer>();

  // Add inputs with BIP32 derivation info
  const inputPaths = addInputsWithBip32(psbt, selection.utxos, {
    sequence,
    isLegacy,
    rawTxCache,
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
  });

  // Build outputs (recipient + change/decoys) and add to PSBT
  const {
    changeAddress,
    decoyOutputsResult,
    actualFee,
    actualChangeAmount,
  } = await buildAndAddOutputs(
    psbt, walletId, recipient, effectiveAmount,
    selection, dustThreshold, sendMax, feeRate, decoyOutputs
  );

  // When decoys are used, don't return changeAmount/changeAddress separately
  const hasDecoys = decoyOutputsResult && decoyOutputsResult.length > 0;

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: actualFee,
    totalInput: selection.totalAmount,
    totalOutput: effectiveAmount + (sendMax ? 0 : (actualChangeAmount >= dustThreshold ? actualChangeAmount : 0)),
    changeAmount: hasDecoys ? 0 : (sendMax ? 0 : actualChangeAmount),
    changeAddress: hasDecoys ? undefined : changeAddress,
    utxos: selection.utxos.map((u) => ({ txid: u.txid, vout: u.vout, address: u.address, amount: Number(u.amount) })),
    inputPaths,
    effectiveAmount,
    decoyOutputs: decoyOutputsResult,
  };
}

/**
 * Internal UTXO selection result shape.
 */
interface UtxoSelection {
  utxos: Array<{
    txid: string;
    vout: number;
    amount: number;
    address: string;
    scriptPubKey: string;
  }>;
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
}

/**
 * Select UTXOs based on transaction mode (normal, sendMax, or subtractFees).
 */
async function selectUtxosForMode(
  walletId: string,
  amount: number,
  feeRate: number,
  dustThreshold: number,
  sendMax: boolean,
  subtractFees: boolean,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let effectiveAmount = amount;

  if (sendMax) {
    return selectUtxosForSendMax(walletId, feeRate, selectedUtxoIds);
  }

  if (subtractFees) {
    return selectUtxosForSubtractFees(walletId, amount, feeRate, dustThreshold, selectedUtxoIds);
  }

  // Normal selection: amount + fee must be covered
  const selection = await selectUTXOs(
    walletId,
    amount,
    feeRate,
    UTXOSelectionStrategy.LARGEST_FIRST,
    selectedUtxoIds
  );

  return {
    effectiveAmount,
    selection: {
      utxos: selection.utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount: selection.totalAmount,
      estimatedFee: selection.estimatedFee,
      changeAmount: selection.changeAmount,
    },
  };
}

/**
 * Select all UTXOs for send-max mode (entire balance minus fee).
 */
async function selectUtxosForSendMax(
  walletId: string,
  feeRate: number,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
  });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs found');
  }

  const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  const estimatedSize = estimateTransactionSize(utxos.length, 1, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  if (totalAmount <= estimatedFee) {
    throw new Error(`Insufficient funds. Total ${totalAmount} sats is not enough to cover fee ${estimatedFee} sats`);
  }

  const effectiveAmount = totalAmount - estimatedFee;

  return {
    effectiveAmount,
    selection: {
      utxos: utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount: 0,
    },
  };
}

/**
 * Select UTXOs for subtract-fees mode (fee deducted from amount).
 */
async function selectUtxosForSubtractFees(
  walletId: string,
  amount: number,
  feeRate: number,
  dustThreshold: number,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
    orderBy: { amount: 'desc' },
  });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Select UTXOs to cover just the amount
  const selectedUtxos: typeof utxos = [];
  let totalAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalAmount += Number(utxo.amount);

    if (totalAmount >= amount) {
      break;
    }
  }

  if (totalAmount < amount) {
    throw new Error(`Insufficient funds. Have ${totalAmount} sats, need ${amount} sats`);
  }

  // Calculate fee based on actual selection
  const estimatedSize = estimateTransactionSize(selectedUtxos.length, 2, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  // Fee is subtracted from the amount being sent
  const effectiveAmount = amount - estimatedFee;
  if (effectiveAmount <= dustThreshold) {
    throw new Error(`Amount ${amount} sats is not enough to cover fee ${estimatedFee} sats (would leave ${effectiveAmount} sats)`);
  }

  // Calculate change
  const changeAmount = totalAmount - amount;

  return {
    effectiveAmount,
    selection: {
      utxos: selectedUtxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount,
    },
  };
}

/**
 * Build all outputs (recipient, change, decoys) and add them to the PSBT in shuffled order.
 */
async function buildAndAddOutputs(
  psbt: bitcoin.Psbt,
  walletId: string,
  recipient: string,
  effectiveAmount: number,
  selection: UtxoSelection,
  dustThreshold: number,
  sendMax: boolean,
  feeRate: number,
  decoyOutputs?: { enabled: boolean; count: number }
): Promise<{
  changeAddress?: string;
  decoyOutputsResult?: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
}> {
  const pendingOutputs: PendingOutput[] = [];

  // Add recipient output
  pendingOutputs.push({
    address: recipient,
    value: effectiveAmount,
    type: 'recipient',
  });

  let changeAddress: string | undefined;
  let decoyOutputsResult: Array<{ address: string; amount: number }> | undefined;
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  if (!sendMax && selection.changeAmount >= dustThreshold) {
    const changeResult = await buildChangeOutputs(
      walletId, selection, dustThreshold, feeRate, effectiveAmount, decoyOutputs
    );

    changeAddress = changeResult.changeAddress;
    decoyOutputsResult = changeResult.decoyOutputsResult;
    actualFee = changeResult.actualFee;
    actualChangeAmount = changeResult.actualChangeAmount;

    for (const output of changeResult.pendingOutputs) {
      pendingOutputs.push(output);
    }
  }

  // Shuffle outputs for privacy (Fisher-Yates algorithm)
  for (let i = pendingOutputs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pendingOutputs[i], pendingOutputs[j]] = [pendingOutputs[j], pendingOutputs[i]];
  }

  // Add all outputs to PSBT in randomized order
  for (const output of pendingOutputs) {
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
  }

  return { changeAddress, decoyOutputsResult, actualFee, actualChangeAmount };
}

/**
 * Build change outputs (single or decoy) for a transaction.
 */
async function buildChangeOutputs(
  walletId: string,
  selection: UtxoSelection,
  dustThreshold: number,
  feeRate: number,
  effectiveAmount: number,
  decoyOutputs?: { enabled: boolean; count: number }
): Promise<{
  changeAddress?: string;
  decoyOutputsResult?: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
  pendingOutputs: PendingOutput[];
}> {
  const pendingOutputs: PendingOutput[] = [];
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  const useDecoys = decoyOutputs?.enabled && decoyOutputs.count >= 2;
  const numChangeOutputs = useDecoys ? Math.min(Math.max(decoyOutputs.count, 2), 4) : 1;

  log.debug('Decoy calculation', {
    decoyOutputsParam: decoyOutputs,
    useDecoys,
    numChangeOutputs,
    changeAmount: selection.changeAmount,
    dustThreshold,
  });

  // If using decoys, recalculate fee for extra outputs
  if (useDecoys && numChangeOutputs > 1) {
    const extraOutputs = numChangeOutputs - 1;
    const extraVbytes = extraOutputs * 34;
    const extraFee = Math.ceil(extraVbytes * feeRate);

    actualFee = selection.estimatedFee + extraFee;
    actualChangeAmount = selection.totalAmount - effectiveAmount - actualFee;

    if (actualChangeAmount < dustThreshold * numChangeOutputs) {
      actualFee = selection.estimatedFee;
      actualChangeAmount = selection.changeAmount;
    }
  }

  const canUseDecoys = useDecoys && actualChangeAmount >= dustThreshold * numChangeOutputs;

  if (canUseDecoys) {
    return buildDecoyChangeOutputs(walletId, numChangeOutputs, actualChangeAmount, dustThreshold, actualFee);
  }

  // Single change output
  const changeAddress = await findChangeAddress(walletId);

  pendingOutputs.push({
    address: changeAddress,
    value: actualChangeAmount,
    type: 'change',
  });

  return {
    changeAddress,
    actualFee,
    actualChangeAmount,
    pendingOutputs,
  };
}

/**
 * Build multiple decoy change outputs for privacy enhancement.
 */
async function buildDecoyChangeOutputs(
  walletId: string,
  numChangeOutputs: number,
  actualChangeAmount: number,
  dustThreshold: number,
  actualFee: number
): Promise<{
  changeAddress?: string;
  decoyOutputsResult: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
  pendingOutputs: PendingOutput[];
}> {
  const pendingOutputs: PendingOutput[] = [];

  // Get multiple unused change addresses
  const changeAddresses = await prisma.address.findMany({
    where: {
      walletId,
      used: false,
      derivationPath: {
        contains: '/1/',
      },
    },
    orderBy: { index: 'asc' },
    take: numChangeOutputs,
  });

  // Fallback to receiving addresses if not enough change addresses
  if (changeAddresses.length < numChangeOutputs) {
    const additionalNeeded = numChangeOutputs - changeAddresses.length;
    const receivingAddresses = await prisma.address.findMany({
      where: {
        walletId,
        used: false,
        address: { notIn: changeAddresses.map(a => a.address) },
      },
      orderBy: { index: 'asc' },
      take: additionalNeeded,
    });
    changeAddresses.push(...receivingAddresses);
  }

  if (changeAddresses.length < numChangeOutputs) {
    throw new Error(`Not enough change addresses for ${numChangeOutputs} decoy outputs`);
  }

  // Generate decoy amounts
  const amounts = generateDecoyAmounts(actualChangeAmount, numChangeOutputs, dustThreshold);

  // Shuffle addresses for additional obfuscation
  const shuffledAddresses = [...changeAddresses];
  for (let i = shuffledAddresses.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAddresses[i], shuffledAddresses[j]] = [shuffledAddresses[j], shuffledAddresses[i]];
  }

  let changeAddress: string | undefined;
  const decoyOutputsResult: Array<{ address: string; amount: number }> = [];

  for (let i = 0; i < numChangeOutputs; i++) {
    const addr = shuffledAddresses[i].address;
    const amt = amounts[i];

    pendingOutputs.push({
      address: addr,
      value: amt,
      type: i === 0 ? 'change' : 'decoy',
    });

    decoyOutputsResult.push({ address: addr, amount: amt });

    if (i === 0) {
      changeAddress = addr;
    }
  }

  log.info(`Created ${numChangeOutputs} decoy change outputs for wallet`);

  return {
    changeAddress,
    decoyOutputsResult,
    actualFee,
    actualChangeAmount,
    pendingOutputs,
  };
}

/**
 * Find an available change address for a wallet.
 * Prefers BIP44 change addresses (derivation path containing /1/),
 * falls back to any unused receiving address.
 */
async function findChangeAddress(walletId: string): Promise<string> {
  const existingChangeAddress = await prisma.address.findFirst({
    where: {
      walletId,
      used: false,
      derivationPath: {
        contains: '/1/',
      },
    },
    orderBy: { index: 'asc' },
  });

  if (existingChangeAddress) {
    return existingChangeAddress.address;
  }

  const receivingAddress = await prisma.address.findFirst({
    where: {
      walletId,
      used: false,
    },
    orderBy: { index: 'asc' },
  });

  if (!receivingAddress) {
    throw new Error('No change address available');
  }

  return receivingAddress.address;
}
