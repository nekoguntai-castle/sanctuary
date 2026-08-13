/**
 * UTXO Selection Module
 *
 * Strategies and algorithms for selecting UTXOs for transactions.
 */

import type { UtxoSelectionStrategy as PublicUtxoSelectionStrategy } from '@sanctuary/shared/constants/transactions';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { utxoRepository, systemSettingRepository } from '../../repositories';
import { estimateTransactionSize, calculateFee } from './utils';
import { DEFAULT_CONFIRMATION_THRESHOLD } from '../../constants';
import { SystemSettingSchemas } from '../../utils/safeJson';
import {
  estimateTransactionWeight,
  feeForRate,
  type TransactionWeightInput,
} from './transactionWeight';

export type SpendEvidence = Omit<TransactionWeightInput, 'prevoutScript' | 'count'>;

/**
 * UTXO selection modes supported by the legacy transaction builder.
 * The public select/compare API exposes the larger shared strategy set.
 */
export type TransactionBuilderUtxoSelectionStrategy = Extract<
  PublicUtxoSelectionStrategy,
  'largest_first' | 'smallest_first'
>;

export const UTXOSelectionStrategy = {
  LARGEST_FIRST: 'largest_first',
  SMALLEST_FIRST: 'smallest_first',
} as const satisfies Record<string, TransactionBuilderUtxoSelectionStrategy>;

export type UTXOSelectionStrategy = TransactionBuilderUtxoSelectionStrategy;

/**
 * Selected UTXO with required fields for transaction building
 */
export interface SelectedUTXO {
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: string;
  address: string;
}

/**
 * Result of UTXO selection
 */
export interface UTXOSelectionResult {
  utxos: SelectedUTXO[];
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
  changeOutputCount?: number;
  feeSurplusSats?: number;
}

export const assertExactUtxoSelection = <T extends { txid: string; vout: number }>(
  available: readonly T[],
  selectedUtxoIds?: readonly string[],
): void => {
  if (!selectedUtxoIds?.length) return;
  const requested = new Set(selectedUtxoIds);
  if (requested.size !== selectedUtxoIds.length) {
    throw new Error('Selected UTXO outpoints must be unique');
  }
  const availableOutpoints = new Set(available.map(utxo => `${utxo.txid}:${utxo.vout}`));
  const missing = selectedUtxoIds.filter(outpoint => !availableOutpoints.has(outpoint));
  if (missing.length > 0) {
    throw new Error(`Selected UTXOs are unavailable: ${missing.join(', ')}`);
  }
};

export interface ExactSelectionFeeContext {
  resolveSpendPolicies: (
    utxos: readonly { address: string }[],
  ) => Promise<ReadonlyMap<string, SpendEvidence>>;
  recipientScript: Uint8Array;
  changeScripts: readonly Uint8Array[];
  dustThreshold: number;
}

const exactFee = (
  utxos: Array<{ scriptPubKey: string; address: string }>,
  outputScripts: readonly Uint8Array[],
  context: ExactSelectionFeeContext,
  spendPolicies: ReadonlyMap<string, SpendEvidence>,
  feeRate: number,
): number => feeForRate(estimateTransactionWeight({
  inputs: utxos.map(utxo => ({
    ...(spendPolicies.get(utxo.address) ?? (() => { throw new Error('UTXO spend policy evidence is missing'); })()),
    prevoutScript: Buffer.from(utxo.scriptPubKey, 'hex'),
  })),
  outputs: outputScripts.map(scriptPubKey => ({ scriptPubKey })),
}).vsize, feeRate);

const mapSelectedUtxos = <T extends {
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: string | null;
  address: string;
}>(utxos: T[]): SelectedUTXO[] => utxos.map(utxo => ({
  id: utxo.id,
  txid: utxo.txid,
  vout: utxo.vout,
  amount: utxo.amount,
  // selectUTXOsExact rejects missing script evidence before mapping.
  scriptPubKey: utxo.scriptPubKey!,
  address: utxo.address,
}));

/** Select UTXOs using authenticated input policy and exact output scripts. */
export async function selectUTXOsExact(
  walletId: string,
  targetAmount: number,
  feeRate: number,
  context: ExactSelectionFeeContext,
  selectedUtxoIds?: string[],
): Promise<UTXOSelectionResult> {
  const confirmationThreshold = await systemSettingRepository.getParsed(
    'confirmationThreshold',
    SystemSettingSchemas.number,
    DEFAULT_CONFIRMATION_THRESHOLD,
  );
  let available = await utxoRepository.findAvailableForSpending(walletId, {
    minConfirmations: confirmationThreshold,
    excludeDraftLocked: !(selectedUtxoIds && selectedUtxoIds.length > 0),
  });
  if (selectedUtxoIds?.length) {
    assertExactUtxoSelection(available, selectedUtxoIds);
    available = available.filter(utxo => selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`));
  }
  if (available.length === 0) throw new Error('No spendable UTXOs available');
  if (available.some(utxo => !utxo.scriptPubKey)) {
    throw new Error('UTXO is missing scriptPubKey evidence');
  }
  const spendPolicies = await context.resolveSpendPolicies(available);

  const candidates = selectedUtxoIds?.length ? [available] : available.map((_, index) => available.slice(0, index + 1));
  let finalNeed = targetAmount;
  let finalTotal = 0;
  for (const selected of candidates) {
    const totalAmount = selected.reduce((sum, utxo) => sum + Number(utxo.amount), 0);
    const feeWithoutChange = exactFee(selected as Array<{ scriptPubKey: string; address: string }>, [context.recipientScript], context, spendPolicies, feeRate);
    const feeWithChange = context.changeScripts.length > 0
      ? exactFee(
        selected as Array<{ scriptPubKey: string; address: string }>,
        [context.recipientScript, ...context.changeScripts],
        context,
        spendPolicies,
        feeRate,
      )
      : feeWithoutChange;
    const changeAmount = totalAmount - targetAmount - feeWithChange;
    if (context.changeScripts.length > 0
      && changeAmount >= context.dustThreshold * context.changeScripts.length) {
      return {
        utxos: mapSelectedUtxos(selected),
        totalAmount,
        estimatedFee: feeWithChange,
        changeAmount,
        changeOutputCount: context.changeScripts.length,
        feeSurplusSats: 0,
      };
    }
    if (context.changeScripts.length > 1) {
      const singleChangeFee = exactFee(
        selected as Array<{ scriptPubKey: string; address: string }>,
        [context.recipientScript, context.changeScripts[0]],
        context,
        spendPolicies,
        feeRate,
      );
      const singleChangeAmount = totalAmount - targetAmount - singleChangeFee;
      if (singleChangeAmount >= context.dustThreshold) {
        return {
          utxos: mapSelectedUtxos(selected),
          totalAmount,
          estimatedFee: singleChangeFee,
          changeAmount: singleChangeAmount,
          changeOutputCount: 1,
          feeSurplusSats: 0,
        };
      }
    }
    if (totalAmount >= targetAmount + feeWithoutChange) {
      return {
        utxos: mapSelectedUtxos(selected),
        totalAmount,
        estimatedFee: totalAmount - targetAmount,
        changeAmount: 0,
        changeOutputCount: 0,
        feeSurplusSats: totalAmount - targetAmount - feeWithoutChange,
      };
    }
    finalNeed = targetAmount + feeWithChange;
    finalTotal = totalAmount;
  }
  throw new Error(`Insufficient funds. Need ${finalNeed} sats, have ${finalTotal} sats`);
}

/**
 * Select UTXOs for a transaction
 *
 * @param walletId - The wallet to select UTXOs from
 * @param targetAmount - The amount to send (in satoshis)
 * @param feeRate - Fee rate in sat/vB
 * @param strategy - UTXO selection strategy to use
 * @param selectedUtxoIds - Optional specific UTXOs to use (format: "txid:vout")
 * @returns Selected UTXOs with amounts and fee estimates
 */
export async function selectUTXOs(
  walletId: string,
  targetAmount: number,
  feeRate: number,
  strategy: UTXOSelectionStrategy = UTXOSelectionStrategy.LARGEST_FIRST,
  selectedUtxoIds?: string[]
): Promise<UTXOSelectionResult> {
  // Get confirmation threshold setting
  const confirmationThreshold = await systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD);

  // Get available UTXOs (exclude frozen, unconfirmed, and locked-by-draft UTXOs)
  let utxos = await utxoRepository.findAvailableForSpending(walletId, {
    minConfirmations: confirmationThreshold,
    // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
    excludeDraftLocked: !(selectedUtxoIds && selectedUtxoIds.length > 0),
  });

  // Sort by strategy (findAvailableForSpending returns desc by default)
  if (strategy === UTXOSelectionStrategy.SMALLEST_FIRST) {
    utxos.sort((a, b) => Number(a.amount - b.amount));
  }

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    assertExactUtxoSelection(utxos, selectedUtxoIds);
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // If user explicitly selected UTXOs, use ALL of them (no optimization)
  // This allows users to consolidate UTXOs or control exactly which are spent
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
    const estimatedSize = estimateTransactionSize(utxos.length, 2, WalletScriptType.NATIVE_SEGWIT);
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalAmount < targetAmount + estimatedFee) {
      throw new Error(
        `Insufficient funds. Need ${targetAmount + estimatedFee} sats, have ${totalAmount} sats`
      );
    }

    const changeAmount = totalAmount - targetAmount - estimatedFee;
    return {
      utxos: utxos.map(u => ({
        id: u.id,
        txid: u.txid,
        vout: u.vout,
        amount: u.amount,
        scriptPubKey: u.scriptPubKey || '',
        address: u.address,
      })),
      totalAmount,
      estimatedFee,
      changeAmount,
      changeOutputCount: changeAmount > 0 ? 1 : 0,
    };
  }

  // Auto-selection: optimize to minimize inputs while covering the amount
  const selectedUtxos: typeof utxos = [];
  let totalAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalAmount += Number(utxo.amount);

    // Estimate fee with current selection
    // 2 outputs: recipient + change
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      2,
      WalletScriptType.NATIVE_SEGWIT
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    // Check if we have enough
    if (totalAmount >= targetAmount + estimatedFee) {
      const changeAmount = totalAmount - targetAmount - estimatedFee;

      return {
        utxos: selectedUtxos.map(u => ({
          id: u.id,
          txid: u.txid,
          vout: u.vout,
          amount: u.amount,
          scriptPubKey: u.scriptPubKey || '',
          address: u.address,
        })),
        totalAmount,
        estimatedFee,
        changeAmount,
        changeOutputCount: changeAmount > 0 ? 1 : 0,
      };
    }
  }

  // Not enough funds
  const finalSize = estimateTransactionSize(selectedUtxos.length, 2, WalletScriptType.NATIVE_SEGWIT);
  const finalFee = calculateFee(finalSize, feeRate);

  throw new Error(
    `Insufficient funds. Need ${targetAmount + finalFee} sats, have ${totalAmount} sats`
  );
}

/**
 * Get all spendable UTXOs for a wallet (for sendMax calculations)
 *
 * @param walletId - The wallet to get UTXOs from
 * @param selectedUtxoIds - Optional specific UTXOs to use (format: "txid:vout")
 * @returns All spendable UTXOs
 */
export async function getSpendableUTXOs(
  walletId: string,
  selectedUtxoIds?: string[]
): Promise<SelectedUTXO[]> {
  let utxos = await utxoRepository.findUnspent(walletId, { excludeFrozen: true });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  return utxos.map(u => ({
    id: u.id,
    txid: u.txid,
    vout: u.vout,
    amount: u.amount,
    scriptPubKey: u.scriptPubKey || '',
    address: u.address,
  }));
}
