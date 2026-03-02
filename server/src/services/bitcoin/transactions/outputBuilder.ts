/**
 * Output Builder
 *
 * Builds transaction outputs (recipient, change, decoy) for PSBT construction.
 * Handles output shuffling for privacy enhancement.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { generateDecoyAmounts } from '../psbtBuilder';
import type { PendingOutput, UtxoSelection } from './types';

const log = createLogger('CREATE-TX');

/**
 * Build all outputs (recipient, change, decoys) and add them to the PSBT in shuffled order.
 */
export async function buildAndAddOutputs(
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
export async function findChangeAddress(walletId: string): Promise<string> {
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
