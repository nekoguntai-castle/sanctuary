import type { OutputEntry, TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reduceTransactionType(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type !== 'SET_TRANSACTION_TYPE') {
    return undefined;
  }

  // Set up outputs based on type
  let outputs: OutputEntry[] = state.outputs;
  let outputsValid = state.outputsValid;

  if (action.txType === 'consolidation' || action.txType === 'sweep') {
    // Consolidation/sweep: single output with sendMax
    outputs = [{ address: '', amount: '', sendMax: true }];
    outputsValid = [null];
  } else if (action.txType === 'standard' && state.transactionType !== 'standard') {
    // Reset to standard output
    outputs = [{ address: '', amount: '', sendMax: false }];
    outputsValid = [null];
  }

  return {
    ...state,
    transactionType: action.txType,
    outputs,
    outputsValid,
  };
}
