import { getSpendCost, isDustUtxo } from '../dustUtils';
import type { CreateUtxoRowModelArgs, UtxoRowModel, UtxoRowVisualState } from './types';

const ROW_STATE_CLASSES: Record<UtxoRowVisualState, string> = {
  frozen: 'bg-zen-vermilion/5 border-zen-vermilion/20 dark:bg-zen-vermilion/10',
  locked: 'bg-cyan-50 border-cyan-200 dark:bg-cyan-900/10 dark:border-cyan-800/50',
  dust: 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/50',
  selected: 'bg-zen-gold/10 border-zen-gold/50 shadow-sm',
  default:
    'bg-white border-sanctuary-200 dark:bg-sanctuary-900 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-700 shadow-sm',
};

const AMOUNT_STATE_CLASSES: Record<UtxoRowVisualState, string> = {
  frozen: 'text-zen-vermilion',
  locked: 'text-cyan-600 dark:text-cyan-400',
  dust: 'text-amber-600 dark:text-amber-400',
  selected: 'text-sanctuary-900 dark:text-sanctuary-100',
  default: 'text-sanctuary-900 dark:text-sanctuary-100',
};

const SELECTION_STATE_CLASSES: Record<'selected' | 'default', string> = {
  selected: 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900',
  default: 'border-sanctuary-300 dark:border-sanctuary-600 hover:border-sanctuary-400',
};

export function createUtxoRowModel({
  utxo,
  isSelected,
  currentFeeRate,
}: CreateUtxoRowModelArgs): UtxoRowModel {
  const id = `${utxo.txid}:${utxo.vout}`;
  const isFrozen = Boolean(utxo.frozen);
  const isLocked = Boolean(utxo.lockedByDraftId);
  const isDisabled = isFrozen || isLocked;
  const isDust = !isFrozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
  const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;
  const visualState = getVisualState({ isFrozen, isLocked, isDust, isSelected });

  return {
    id,
    utxo,
    isFrozen,
    isLocked,
    isDisabled,
    isDust,
    isSelected,
    spendCost,
    visualState,
    rowClassName: getRowClassName(visualState),
    amountClassName: getAmountClassName(visualState),
    selectionClassName: getSelectionClassName(isSelected),
    lockedDraftLabel: utxo.lockedByDraftLabel || 'Pending Draft',
  };
}

function getVisualState({
  isFrozen,
  isLocked,
  isDust,
  isSelected,
}: {
  isFrozen: boolean;
  isLocked: boolean;
  isDust: boolean;
  isSelected: boolean;
}): UtxoRowVisualState {
  if (isFrozen) {
    return 'frozen';
  }

  if (isLocked) {
    return 'locked';
  }

  if (isDust) {
    return 'dust';
  }

  if (isSelected) {
    return 'selected';
  }

  return 'default';
}

function getRowClassName(visualState: UtxoRowVisualState): string {
  return `group relative p-4 rounded-lg border transition-all duration-200 ${ROW_STATE_CLASSES[visualState]}`;
}

function getAmountClassName(visualState: UtxoRowVisualState): string {
  return `font-mono font-medium flex items-center gap-2 ${AMOUNT_STATE_CLASSES[visualState]}`;
}

function getSelectionClassName(isSelected: boolean): string {
  const selectionState = isSelected ? 'selected' : 'default';
  return `mt-1 flex-shrink-0 w-5 h-5 rounded border cursor-pointer flex items-center justify-center transition-colors ${SELECTION_STATE_CLASSES[selectionState]}`;
}
