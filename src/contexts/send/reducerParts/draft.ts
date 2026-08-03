import type { TransactionAction, TransactionState } from '../types';
import { deserializeState } from '../types';
import type { ReducerResult } from './types';

export function reduceDraft(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'LOAD_DRAFT') {
    const deserialized = deserializeState(action.draft);
    return {
      ...state,
      ...deserialized,
      isDraftMode: true,
    };
  }

  if (action.type === 'SET_DRAFT_ID') {
    return { ...state, draftId: action.id };
  }

  if (action.type === 'SET_DRAFT_MODE') {
    return { ...state, isDraftMode: action.isDraft };
  }

  return undefined;
}
