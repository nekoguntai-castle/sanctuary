import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reduceCoinControl(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'TOGGLE_COIN_CONTROL') {
    return { ...state, showCoinControl: !state.showCoinControl };
  }

  if (action.type === 'SET_SHOW_COIN_CONTROL') {
    return { ...state, showCoinControl: action.show };
  }

  if (action.type === 'SELECT_UTXO') {
    const newSelected = new Set(state.selectedUTXOs);
    newSelected.add(action.utxoId);
    // Auto-enable coin control when selecting UTXOs
    return { ...state, selectedUTXOs: newSelected, showCoinControl: true };
  }

  if (action.type === 'DESELECT_UTXO') {
    const newSelected = new Set(state.selectedUTXOs);
    newSelected.delete(action.utxoId);
    return { ...state, selectedUTXOs: newSelected };
  }

  if (action.type === 'TOGGLE_UTXO') {
    const newSelected = new Set(state.selectedUTXOs);
    if (newSelected.has(action.utxoId)) {
      newSelected.delete(action.utxoId);
    } else {
      newSelected.add(action.utxoId);
    }
    // Auto-enable coin control when user selects any UTXO (switches to manual mode)
    const showCoinControl = newSelected.size > 0 ? true : state.showCoinControl;
    return { ...state, selectedUTXOs: newSelected, showCoinControl };
  }

  if (action.type === 'SELECT_ALL_UTXOS') {
    // Auto-enable coin control when selecting UTXOs
    return { ...state, selectedUTXOs: new Set(action.utxoIds), showCoinControl: true };
  }

  if (action.type === 'CLEAR_UTXO_SELECTION') {
    return { ...state, selectedUTXOs: new Set<string>() };
  }

  if (action.type === 'SET_SELECTED_UTXOS') {
    return { ...state, selectedUTXOs: new Set(action.utxoIds) };
  }

  return undefined;
}
