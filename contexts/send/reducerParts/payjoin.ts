import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reducePayjoin(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_PAYJOIN_URL') {
    return { ...state, payjoinUrl: action.url };
  }

  if (action.type === 'SET_PAYJOIN_STATUS') {
    return { ...state, payjoinStatus: action.status };
  }

  return undefined;
}
