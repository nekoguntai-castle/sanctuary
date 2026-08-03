import type { OutputEntry, TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

function copyOutputs(outputs: OutputEntry[]): OutputEntry[] {
  return outputs.map((output) => ({ ...output }));
}

function disableSendMaxOnOtherOutputs(
  outputs: OutputEntry[],
  activeIndex: number
): void {
  outputs.forEach((output, index) => {
    if (index !== activeIndex) {
      output.sendMax = false;
    }
  });
}

export function reduceOutputCollection(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'ADD_OUTPUT') {
    return {
      ...state,
      outputs: [...state.outputs, { address: '', amount: '', sendMax: false }],
      outputsValid: [...state.outputsValid, null],
    };
  }

  if (action.type === 'REMOVE_OUTPUT') {
    if (state.outputs.length <= 1) return state;

    return {
      ...state,
      outputs: state.outputs.filter((_, i) => i !== action.index),
      outputsValid: state.outputsValid.filter((_, i) => i !== action.index),
    };
  }

  if (action.type === 'SET_OUTPUTS') {
    return {
      ...state,
      outputs: action.outputs,
      outputsValid: action.outputs.map(() => null),
    };
  }

  return undefined;
}

export function reduceOutputEditing(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'UPDATE_OUTPUT') {
    const newOutputs = copyOutputs(state.outputs);
    newOutputs[action.index] = {
      ...newOutputs[action.index],
      [action.field]: action.value,
    };

    // If setting sendMax, clear amount and unset on other outputs
    if (action.field === 'sendMax' && action.value === true) {
      disableSendMaxOnOtherOutputs(newOutputs, action.index);
      newOutputs[action.index].amount = '';
    }

    // If manually setting amount, clear sendMax (user is overriding max)
    if (action.field === 'amount' && action.value && newOutputs[action.index].sendMax) {
      newOutputs[action.index].sendMax = false;
    }

    return { ...state, outputs: newOutputs };
  }

  if (action.type === 'SET_OUTPUT_ADDRESS') {
    const newOutputs = copyOutputs(state.outputs);
    newOutputs[action.index] = {
      ...newOutputs[action.index],
      address: action.address,
    };
    return { ...state, outputs: newOutputs };
  }

  if (action.type === 'SET_OUTPUT_AMOUNT') {
    const newOutputs = copyOutputs(state.outputs);
    newOutputs[action.index] = {
      ...newOutputs[action.index],
      amount: action.amount,
      displayValue: action.displayValue,
      // Clear sendMax when user manually sets an amount
      sendMax: action.amount ? false : newOutputs[action.index].sendMax,
    };
    return { ...state, outputs: newOutputs };
  }

  if (action.type === 'TOGGLE_SEND_MAX') {
    const newOutputs = copyOutputs(state.outputs);
    const newValue = !newOutputs[action.index].sendMax;

    newOutputs[action.index] = {
      ...newOutputs[action.index],
      sendMax: newValue,
    };

    // If enabling, disable on other outputs and clear amount
    if (newValue) {
      disableSendMaxOnOtherOutputs(newOutputs, action.index);
      newOutputs[action.index].amount = '';
    }

    return { ...state, outputs: newOutputs };
  }

  return undefined;
}

export function reduceOutputMetadata(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_OUTPUTS_VALID') {
    return { ...state, outputsValid: action.valid };
  }

  if (action.type === 'SET_SCANNING_OUTPUT_INDEX') {
    return { ...state, scanningOutputIndex: action.index };
  }

  return undefined;
}
