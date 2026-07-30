/**
 * Send Transaction Context
 *
 * Provides transaction state and actions to all wizard components.
 * Eliminates prop drilling by using React Context.
 */

import React, { createContext, useContext, useReducer, useMemo, useCallback } from 'react';
import { transactionReducer, createInitialState } from './reducer';
import { isStepValid, canProceedToNextStep, getStepErrors, isReadyToSign } from './stepValidation';
import { canJumpToStep, serializeState, WIZARD_STEPS } from './types';
import type {
  TransactionState,
  TransactionAction,
  WizardStep,
  TransactionType,
  SerializableTransactionState,
  WalletAddress,
} from './types';
import type { Wallet, UTXO, FeeEstimate, Device } from '../../types';
import type { BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';

// ============================================================================
// CONTEXT VALUE TYPE
// ============================================================================

export interface SendTransactionContextValue {
  // State
  state: TransactionState;
  dispatch: React.Dispatch<TransactionAction>;

  // Wallet data (read-only, from parent)
  wallet: Wallet;
  devices: Device[];
  utxos: UTXO[];
  spendableUtxos: UTXO[];
  walletAddresses: WalletAddress[];

  // Fee data (from API)
  fees: FeeEstimate | null;
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;

  // Computed values
  selectedTotal: number;
  estimatedFee: number;
  maxSendableAmount: number;
  isSendMax: boolean;
  totalOutputAmount: number;

  // Navigation
  currentStep: WizardStep;
  canGoNext: boolean;
  canGoBack: boolean;
  canJumpTo: (step: WizardStep) => boolean;
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;

  // Validation
  isStepComplete: (step: WizardStep) => boolean;
  stepErrors: string[];
  isReadyToSign: boolean;

  // Convenience actions
  setTransactionType: (type: TransactionType) => void;
  addOutput: () => void;
  removeOutput: (index: number) => void;
  updateOutputAddress: (index: number, address: string) => void;
  updateOutputAmount: (index: number, amount: string, displayValue?: string) => void;
  toggleSendMax: (index: number) => void;
  setFeeRate: (rate: number) => void;
  toggleRbf: () => void;
  toggleSubtractFees: () => void;
  toggleDecoys: () => void;
  setDecoyCount: (count: number) => void;
  toggleCoinControl: () => void;
  toggleUtxo: (utxoId: string) => void;
  selectAllUtxos: () => void;
  clearUtxoSelection: () => void;
  reset: () => void;

  // Draft
  getSerializableState: () => SerializableTransactionState;
  loadDraft: (draft: Partial<SerializableTransactionState>) => void;
}

// ============================================================================
// CONTEXT
// ============================================================================

const SendTransactionContext = createContext<SendTransactionContextValue | undefined>(undefined);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

export interface SendTransactionProviderProps {
  children: React.ReactNode;

  // Required wallet data
  wallet: Wallet;
  devices: Device[];
  utxos: UTXO[];
  walletAddresses: WalletAddress[];

  // Fee data
  fees: FeeEstimate | null;
  mempoolBlocks?: BlockData[];
  queuedBlocksSummary?: QueuedBlocksSummary | null;

  // Optional initial state (for resuming drafts)
  initialState?: Partial<SerializableTransactionState>;

  // Fee calculation function (from useFeeEstimation or inline)
  calculateFee?: (numInputs: number, numOutputs: number, rate: number) => number;
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

function SendTransactionProviderState({
  children,
  wallet,
  devices,
  utxos,
  walletAddresses,
  fees,
  mempoolBlocks = [],
  queuedBlocksSummary = null,
  initialState,
  calculateFee: calculateFeeProp,
}: SendTransactionProviderProps) {
  // Initialize state (with optional draft data)
  const [state, dispatch] = useReducer(
    transactionReducer,
    fees?.halfHourFee ?? 1,
    (defaultFeeRate) => {
      const initial = createInitialState(defaultFeeRate);
      if (initialState) {
        return transactionReducer(initial, { type: 'LOAD_DRAFT', draft: initialState });
      }
      return initial;
    }
  );

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  // Filter spendable UTXOs (not frozen, not spent)
  const spendableUtxos = useMemo(() => {
    return utxos.filter(u => !u.frozen && !u.spent && u.spendable !== false);
  }, [utxos]);

  // Calculate selected UTXO total
  const selectedTotal = useMemo(() => {
    if (!state.showCoinControl || state.selectedUTXOs.size === 0) {
      return spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
    }
    return spendableUtxos
      .filter(u => state.selectedUTXOs.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.amount, 0);
  }, [spendableUtxos, state.showCoinControl, state.selectedUTXOs]);

  // Default fee calculation if not provided
  const calculateFee = useCallback((numInputs: number, numOutputs: number, rate: number): number => {
    if (calculateFeeProp) {
      return calculateFeeProp(numInputs, numOutputs, rate);
    }
    // Simple fallback: P2WPKH inputs (68 vB) + outputs (31 vB) + overhead (10.5 vB)
    const overhead = 10.5;
    const inputSize = 68;
    const outputSize = 31;
    const vsize = overhead + (numInputs * inputSize) + (numOutputs * outputSize);
    return Math.ceil(vsize * rate);
  }, [calculateFeeProp]);

  // Estimate fee for current transaction
  const estimatedFee = useMemo(() => {
    const numInputs = state.showCoinControl && state.selectedUTXOs.size > 0
      ? state.selectedUTXOs.size
      : Math.max(1, spendableUtxos.length);

    const hasSendMax = state.outputs.some(o => o.sendMax);
    const numOutputs = hasSendMax ? state.outputs.length : state.outputs.length + 1;

    return calculateFee(numInputs, numOutputs, state.feeRate);
  }, [state.showCoinControl, state.selectedUTXOs.size, state.outputs, state.feeRate, spendableUtxos.length, calculateFee]);

  // Calculate total output amount
  const totalOutputAmount = useMemo(() => {
    return state.outputs.reduce((sum, o) => {
      if (o.sendMax) return sum;
      return sum + (parseInt(o.amount, 10) || 0);
    }, 0);
  }, [state.outputs]);

  // Check if any output has sendMax
  const isSendMax = useMemo(() => {
    return state.outputs.some(o => o.sendMax);
  }, [state.outputs]);

  // Calculate max sendable amount
  const maxSendableAmount = useMemo(() => {
    if (isSendMax) return 0;
    return Math.max(0, selectedTotal - totalOutputAmount - estimatedFee);
  }, [selectedTotal, totalOutputAmount, estimatedFee, isSendMax]);

  // ========================================================================
  // NAVIGATION
  // ========================================================================

  const canGoNext = useMemo(() => {
    const stepValid = canProceedToNextStep(state);
    // Additional check: on outputs step, require at least one spendable UTXO to proceed
    // This prevents users from reaching the review step with nothing to spend
    if (state.currentStep === 'outputs' && spendableUtxos.length === 0) {
      return false;
    }
    return stepValid;
  }, [state, spendableUtxos.length]);

  const canGoBack = useMemo(() => {
    const currentIndex = WIZARD_STEPS.indexOf(state.currentStep);
    return currentIndex > 0;
  }, [state.currentStep]);

  const canJumpTo = useCallback((step: WizardStep) => {
    return canJumpToStep(step, state.currentStep, state.completedSteps);
  }, [state.currentStep, state.completedSteps]);

  const goToStep = useCallback((step: WizardStep) => {
    dispatch({ type: 'GO_TO_STEP', step });
  }, []);

  const nextStep = useCallback(() => {
    dispatch({ type: 'NEXT_STEP' });
  }, []);

  const prevStep = useCallback(() => {
    dispatch({ type: 'PREV_STEP' });
  }, []);

  // ========================================================================
  // VALIDATION
  // ========================================================================

  const isStepComplete = useCallback((step: WizardStep) => {
    return isStepValid(step, state);
  }, [state]);

  const stepErrors = useMemo(() => {
    return getStepErrors(state.currentStep, state);
  }, [state]);

  const readyToSign = useMemo(() => isReadyToSign(state), [state]);

  // ========================================================================
  // CONVENIENCE ACTIONS
  // ========================================================================

  const setTransactionType = useCallback((txType: TransactionType) => {
    dispatch({ type: 'SET_TRANSACTION_TYPE', txType });
  }, []);

  const addOutput = useCallback(() => {
    dispatch({ type: 'ADD_OUTPUT' });
  }, []);

  const removeOutput = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_OUTPUT', index });
  }, []);

  const updateOutputAddress = useCallback((index: number, address: string) => {
    dispatch({ type: 'SET_OUTPUT_ADDRESS', index, address });
  }, []);

  const updateOutputAmount = useCallback((index: number, amount: string, displayValue?: string) => {
    dispatch({ type: 'SET_OUTPUT_AMOUNT', index, amount, displayValue });
  }, []);

  const toggleSendMax = useCallback((index: number) => {
    dispatch({ type: 'TOGGLE_SEND_MAX', index });
  }, []);

  const setFeeRate = useCallback((rate: number) => {
    dispatch({ type: 'SET_FEE_RATE', rate });
  }, []);

  const toggleRbf = useCallback(() => {
    dispatch({ type: 'TOGGLE_RBF' });
  }, []);

  const toggleSubtractFees = useCallback(() => {
    dispatch({ type: 'TOGGLE_SUBTRACT_FEES' });
  }, []);

  const toggleDecoys = useCallback(() => {
    dispatch({ type: 'TOGGLE_DECOYS' });
  }, []);

  const setDecoyCount = useCallback((count: number) => {
    dispatch({ type: 'SET_DECOY_COUNT', count });
  }, []);

  const toggleCoinControl = useCallback(() => {
    dispatch({ type: 'TOGGLE_COIN_CONTROL' });
  }, []);

  const toggleUtxo = useCallback((utxoId: string) => {
    dispatch({ type: 'TOGGLE_UTXO', utxoId });
  }, []);

  const selectAllUtxos = useCallback(() => {
    const utxoIds = spendableUtxos.map(u => `${u.txid}:${u.vout}`);
    dispatch({ type: 'SELECT_ALL_UTXOS', utxoIds });
  }, [spendableUtxos]);

  const clearUtxoSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_UTXO_SELECTION' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // ========================================================================
  // DRAFT FUNCTIONS
  // ========================================================================

  const getSerializableState = useCallback(() => {
    return serializeState(state);
  }, [state]);

  const loadDraft = useCallback((draft: Partial<SerializableTransactionState>) => {
    dispatch({ type: 'LOAD_DRAFT', draft });
  }, []);

  // ========================================================================
  // CONTEXT VALUE
  // ========================================================================

  const value = useMemo<SendTransactionContextValue>(() => ({
    // State
    state,
    dispatch,

    // Wallet data
    wallet,
    devices,
    utxos,
    spendableUtxos,
    walletAddresses,

    // Fee data
    fees,
    mempoolBlocks,
    queuedBlocksSummary,

    // Computed values
    selectedTotal,
    estimatedFee,
    maxSendableAmount,
    isSendMax,
    totalOutputAmount,

    // Navigation
    currentStep: state.currentStep,
    canGoNext,
    canGoBack,
    canJumpTo,
    goToStep,
    nextStep,
    prevStep,

    // Validation
    isStepComplete,
    stepErrors,
    isReadyToSign: readyToSign,

    // Convenience actions
    setTransactionType,
    addOutput,
    removeOutput,
    updateOutputAddress,
    updateOutputAmount,
    toggleSendMax,
    setFeeRate,
    toggleRbf,
    toggleSubtractFees,
    toggleDecoys,
    setDecoyCount,
    toggleCoinControl,
    toggleUtxo,
    selectAllUtxos,
    clearUtxoSelection,
    reset,

    // Draft
    getSerializableState,
    loadDraft,
  }), [
    state,
    wallet,
    devices,
    utxos,
    spendableUtxos,
    walletAddresses,
    fees,
    mempoolBlocks,
    queuedBlocksSummary,
    selectedTotal,
    estimatedFee,
    maxSendableAmount,
    isSendMax,
    totalOutputAmount,
    canGoNext,
    canGoBack,
    canJumpTo,
    goToStep,
    nextStep,
    prevStep,
    isStepComplete,
    stepErrors,
    readyToSign,
    setTransactionType,
    addOutput,
    removeOutput,
    updateOutputAddress,
    updateOutputAmount,
    toggleSendMax,
    setFeeRate,
    toggleRbf,
    toggleSubtractFees,
    toggleDecoys,
    setDecoyCount,
    toggleCoinControl,
    toggleUtxo,
    selectAllUtxos,
    clearUtxoSelection,
    reset,
    getSerializableState,
    loadDraft,
  ]);

  return (
    <SendTransactionContext.Provider value={value}>
      {children}
    </SendTransactionContext.Provider>
  );
}

export function SendTransactionProvider(props: SendTransactionProviderProps) {
  return <SendTransactionProviderState key={props.wallet.id} {...props} />;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access send transaction context
 * Must be used within a SendTransactionProvider
 */
export function useSendTransaction(): SendTransactionContextValue {
  const context = useContext(SendTransactionContext);
  if (!context) {
    throw new Error('useSendTransaction must be used within a SendTransactionProvider');
  }
  return context;
}

/**
 * Hook to access just the dispatch function (for components that only dispatch)
 */
export function useSendTransactionDispatch(): React.Dispatch<TransactionAction> {
  const context = useContext(SendTransactionContext);
  if (!context) {
    throw new Error('useSendTransactionDispatch must be used within a SendTransactionProvider');
  }
  return context.dispatch;
}
