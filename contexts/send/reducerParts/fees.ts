import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reduceFees(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_FEE_RATE') {
    return { ...state, feeRate: action.rate };
  }

  if (action.type === 'TOGGLE_RBF') {
    return { ...state, rbfEnabled: !state.rbfEnabled };
  }

  if (action.type === 'SET_RBF_ENABLED') {
    return { ...state, rbfEnabled: action.enabled };
  }

  if (action.type === 'TOGGLE_SUBTRACT_FEES') {
    return { ...state, subtractFees: !state.subtractFees };
  }

  if (action.type === 'SET_SUBTRACT_FEES') {
    return { ...state, subtractFees: action.enabled };
  }

  return undefined;
}
