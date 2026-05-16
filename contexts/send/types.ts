/**
 * Send Transaction Wizard Types
 *
 * Type definitions for the transaction state reducer and actions.
 * Used by SendTransactionContext and all wizard step components.
 */

// ============================================================================
// WALLET ADDRESS
// ============================================================================

export interface WalletAddress {
  address: string;
  used: boolean;
  index: number;
  isChange?: boolean; // true for change addresses, false for receive addresses
}

// ============================================================================
// OUTPUT ENTRY
// ============================================================================

export interface OutputEntry {
  address: string;
  amount: string;
  sendMax?: boolean;
  displayValue?: string; // Temporary display value while typing decimals
}

// ============================================================================
// WIZARD STEPS
// ============================================================================

export type WizardStep = 'type' | 'outputs' | 'review';

export const WIZARD_STEPS: WizardStep[] = ['type', 'outputs', 'review'];

export const STEP_LABELS: Record<WizardStep, string> = {
  type: 'Type',
  outputs: 'Compose',
  review: 'Review',
};

// ============================================================================
// TRANSACTION TYPE
// ============================================================================

export type TransactionType = 'standard' | 'consolidation' | 'sweep';
export type PayjoinAttemptStatus = 'idle' | 'attempting' | 'success' | 'failed';

// ============================================================================
// TRANSACTION STATE
// ============================================================================

export interface TransactionState {
  // Wizard navigation
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;

  // Transaction type
  transactionType: TransactionType | null;

  // Outputs
  outputs: OutputEntry[];
  outputsValid: (boolean | null)[];
  scanningOutputIndex: number | null;

  // Coin control
  showCoinControl: boolean;
  selectedUTXOs: Set<string>;

  // Fees
  feeRate: number;
  rbfEnabled: boolean;
  subtractFees: boolean;

  // Decoys (Stonewall)
  useDecoys: boolean;
  decoyCount: number;

  // Payjoin
  payjoinUrl: string | null;
  payjoinStatus: PayjoinAttemptStatus;

  // Signing state
  signingDeviceId: string | null;
  expandedDeviceId: string | null;
  signedDevices: Set<string>;
  unsignedPsbt: string | null;
  showPsbtOptions: boolean;
  psbtDeviceId: string | null;

  // Draft
  draftId: string | null;
  isDraftMode: boolean;

  // UI state
  isSubmitting: boolean;
  error: string | null;
}

// ============================================================================
// ACTIONS
// ============================================================================

export type TransactionAction =
  // Navigation
  | { type: 'GO_TO_STEP'; step: WizardStep }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'MARK_STEP_COMPLETED'; step: WizardStep }
  | { type: 'UNMARK_STEP_COMPLETED'; step: WizardStep }

  // Type selection
  | { type: 'SET_TRANSACTION_TYPE'; txType: TransactionType }

  // Outputs
  | { type: 'ADD_OUTPUT' }
  | { type: 'REMOVE_OUTPUT'; index: number }
  | { type: 'UPDATE_OUTPUT'; index: number; field: keyof OutputEntry; value: string | boolean | undefined }
  | { type: 'SET_OUTPUT_ADDRESS'; index: number; address: string }
  | { type: 'SET_OUTPUT_AMOUNT'; index: number; amount: string; displayValue?: string }
  | { type: 'TOGGLE_SEND_MAX'; index: number }
  | { type: 'SET_OUTPUTS'; outputs: OutputEntry[] }
  | { type: 'SET_OUTPUTS_VALID'; valid: (boolean | null)[] }
  | { type: 'SET_SCANNING_OUTPUT_INDEX'; index: number | null }

  // Payjoin
  | { type: 'SET_PAYJOIN_URL'; url: string | null }
  | { type: 'SET_PAYJOIN_STATUS'; status: PayjoinAttemptStatus }

  // Coin control
  | { type: 'TOGGLE_COIN_CONTROL' }
  | { type: 'SET_SHOW_COIN_CONTROL'; show: boolean }
  | { type: 'SELECT_UTXO'; utxoId: string }
  | { type: 'DESELECT_UTXO'; utxoId: string }
  | { type: 'TOGGLE_UTXO'; utxoId: string }
  | { type: 'SELECT_ALL_UTXOS'; utxoIds: string[] }
  | { type: 'CLEAR_UTXO_SELECTION' }
  | { type: 'SET_SELECTED_UTXOS'; utxoIds: string[] }

  // Fees
  | { type: 'SET_FEE_RATE'; rate: number }
  | { type: 'TOGGLE_RBF' }
  | { type: 'SET_RBF_ENABLED'; enabled: boolean }
  | { type: 'TOGGLE_SUBTRACT_FEES' }
  | { type: 'SET_SUBTRACT_FEES'; enabled: boolean }

  // Decoys
  | { type: 'TOGGLE_DECOYS' }
  | { type: 'SET_USE_DECOYS'; enabled: boolean }
  | { type: 'SET_DECOY_COUNT'; count: number }

  // Signing
  | { type: 'SET_SIGNING_DEVICE'; deviceId: string | null }
  | { type: 'SET_EXPANDED_DEVICE'; deviceId: string | null }
  | { type: 'MARK_DEVICE_SIGNED'; deviceId: string }
  | { type: 'SET_UNSIGNED_PSBT'; psbt: string | null }
  | { type: 'TOGGLE_PSBT_OPTIONS' }
  | { type: 'SET_SHOW_PSBT_OPTIONS'; show: boolean }
  | { type: 'SET_PSBT_DEVICE_ID'; deviceId: string | null }
  | { type: 'CLEAR_SIGNATURES' }
  | { type: 'SET_SIGNED_DEVICES'; deviceIds: string[] }

  // Draft
  | { type: 'LOAD_DRAFT'; draft: Partial<SerializableTransactionState> }
  | { type: 'SET_DRAFT_ID'; id: string | null }
  | { type: 'SET_DRAFT_MODE'; isDraft: boolean }

  // UI
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

// ============================================================================
// SERIALIZABLE STATE (for draft storage)
// ============================================================================

/**
 * Serializable version of TransactionState for storage/transmission.
 * Sets are converted to arrays.
 */
export interface SerializableTransactionState {
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  transactionType: TransactionType | null;
  outputs: OutputEntry[];
  outputsValid: (boolean | null)[];
  scanningOutputIndex: number | null;
  showCoinControl: boolean;
  selectedUTXOs: string[];
  feeRate: number;
  rbfEnabled: boolean;
  subtractFees: boolean;
  useDecoys: boolean;
  decoyCount: number;
  payjoinUrl: string | null;
  payjoinStatus: PayjoinAttemptStatus;
  signingDeviceId: string | null;
  expandedDeviceId: string | null;
  signedDevices: string[];
  unsignedPsbt: string | null;
  showPsbtOptions: boolean;
  psbtDeviceId: string | null;
  draftId: string | null;
  isDraftMode: boolean;
  isSubmitting: boolean;
  error: string | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert TransactionState to serializable format (for storage)
 */
export function serializeState(state: TransactionState): SerializableTransactionState {
  return {
    ...state,
    completedSteps: Array.from(state.completedSteps),
    selectedUTXOs: Array.from(state.selectedUTXOs),
    signedDevices: Array.from(state.signedDevices),
  };
}

/**
 * Convert serializable format back to TransactionState
 */
export function deserializeState(data: Partial<SerializableTransactionState>): Partial<TransactionState> {
  // Destructure array properties that need conversion to Sets
  const {
    completedSteps,
    selectedUTXOs,
    signedDevices,
    ...rest
  } = data;

  const result: Partial<TransactionState> = { ...rest };

  if (completedSteps) {
    result.completedSteps = new Set(completedSteps);
  }
  if (selectedUTXOs) {
    result.selectedUTXOs = new Set(selectedUTXOs);
  }
  if (signedDevices) {
    result.signedDevices = new Set(signedDevices);
  }

  return result;
}

/**
 * Get the next step in the wizard
 */
export function getNextStep(currentStep: WizardStep): WizardStep | null {
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex >= WIZARD_STEPS.length - 1) {
    return null;
  }
  return WIZARD_STEPS[currentIndex + 1];
}

/**
 * Get the previous step in the wizard
 */
export function getPrevStep(currentStep: WizardStep): WizardStep | null {
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);
  if (currentIndex <= 0) {
    return null;
  }
  return WIZARD_STEPS[currentIndex - 1];
}

/**
 * Check if a step can be jumped to (must be completed or current)
 */
export function canJumpToStep(
  targetStep: WizardStep,
  currentStep: WizardStep,
  completedSteps: Set<WizardStep>
): boolean {
  if (targetStep === currentStep) return true;
  return completedSteps.has(targetStep);
}
