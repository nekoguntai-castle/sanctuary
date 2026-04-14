import type { TransactionAction, TransactionState } from '../types';

export type ReducerResult = TransactionState | undefined;
export type ActionReducer = (state: TransactionState, action: TransactionAction) => ReducerResult;
