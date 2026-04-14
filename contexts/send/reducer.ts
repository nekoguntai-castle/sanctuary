/**
 * Send Transaction Reducer
 *
 * Handles all state transitions for the transaction wizard.
 * Pure function - no side effects, easy to test.
 */

import { reduceCoinControl } from './reducerParts/coinControl';
import { reduceDecoys } from './reducerParts/decoys';
import { reduceDraft } from './reducerParts/draft';
import { reduceFees } from './reducerParts/fees';
import { reduceNavigation } from './reducerParts/navigation';
import { reduceOutputCollection, reduceOutputEditing, reduceOutputMetadata } from './reducerParts/outputs';
import { reducePayjoin } from './reducerParts/payjoin';
import { reduceSigning } from './reducerParts/signing';
import { reduceTransactionType } from './reducerParts/transactionType';
import type { ActionReducer, ReducerResult } from './reducerParts/types';
import type {
  TransactionState,
  TransactionAction,
  WizardStep,
} from './types';

// ============================================================================
// INITIAL STATE
// ============================================================================

/**
 * Create initial transaction state
 * @param defaultFeeRate - Default fee rate to use (from fee estimates)
 */
export function createInitialState(defaultFeeRate = 1): TransactionState {
  return {
    // Wizard navigation
    currentStep: 'type',
    completedSteps: new Set<WizardStep>(),

    // Transaction type
    transactionType: null,

    // Outputs
    outputs: [{ address: '', amount: '', sendMax: false }],
    outputsValid: [null],
    scanningOutputIndex: null,

    // Coin control
    showCoinControl: false,
    selectedUTXOs: new Set<string>(),

    // Fees
    feeRate: defaultFeeRate,
    rbfEnabled: true,
    subtractFees: false,

    // Decoys (Stonewall)
    useDecoys: false,
    decoyCount: 2,

    // Payjoin
    payjoinUrl: null,
    payjoinStatus: 'idle',

    // Signing state
    signingDeviceId: null,
    expandedDeviceId: null,
    signedDevices: new Set<string>(),
    unsignedPsbt: null,
    showPsbtOptions: false,
    psbtDeviceId: null,

    // Draft
    draftId: null,
    isDraftMode: false,

    // UI state
    isSubmitting: false,
    error: null,
  };
}

// ============================================================================
// LOCAL REDUCER HELPERS
// ============================================================================

function reduceUi(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_SUBMITTING') {
    return { ...state, isSubmitting: action.isSubmitting };
  }

  if (action.type === 'SET_ERROR') {
    return { ...state, error: action.error };
  }

  if (action.type === 'RESET') {
    return createInitialState(state.feeRate);
  }

  return undefined;
}

const actionReducers: ActionReducer[] = [
  reduceNavigation,
  reduceTransactionType,
  reduceOutputCollection,
  reduceOutputEditing,
  reduceOutputMetadata,
  reducePayjoin,
  reduceCoinControl,
  reduceFees,
  reduceDecoys,
  reduceSigning,
  reduceDraft,
  reduceUi,
];

// ============================================================================
// REDUCER
// ============================================================================

export function transactionReducer(
  state: TransactionState,
  action: TransactionAction
): TransactionState {
  for (const reduceAction of actionReducers) {
    const nextState = reduceAction(state, action);
    if (nextState) {
      return nextState;
    }
  }

  return state;
}
