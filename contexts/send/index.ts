/**
 * Send Transaction Context - Public API
 *
 * Re-exports all public types, components, and hooks for the send transaction wizard.
 */

// Types
export type {
  WizardStep,
  TransactionType,
  PayjoinAttemptStatus,
  TransactionState,
  TransactionAction,
  SerializableTransactionState,
  WalletAddress,
} from './types';

export {
  WIZARD_STEPS,
  STEP_LABELS,
  serializeState,
  deserializeState,
  getNextStep,
  getPrevStep,
  canJumpToStep,
} from './types';

// Reducer
export { transactionReducer, createInitialState } from './reducer';

// Validation
export {
  isStepValid,
  canProceedToNextStep,
  getStepErrors,
  isReadyToSign,
  stepValidators,
} from './stepValidation';

// Context
export type { SendTransactionContextValue, SendTransactionProviderProps } from './SendTransactionContext';
export { SendTransactionProvider, useSendTransaction, useSendTransactionDispatch } from './SendTransactionContext';
