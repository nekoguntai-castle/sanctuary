import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reduceDecoys(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'TOGGLE_DECOYS') {
    return { ...state, useDecoys: !state.useDecoys };
  }

  if (action.type === 'SET_USE_DECOYS') {
    return { ...state, useDecoys: action.enabled };
  }

  if (action.type === 'SET_DECOY_COUNT') {
    return { ...state, decoyCount: action.count };
  }

  return undefined;
}
