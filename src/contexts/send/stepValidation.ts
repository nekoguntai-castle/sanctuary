/**
 * Step Validation
 *
 * Defines validation rules for each wizard step.
 * Used to determine if a step can be marked as complete.
 */

import type { TransactionState, WizardStep } from './types';

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate the type selection step
 */
export function validateTypeStep(state: TransactionState): boolean {
  return state.transactionType !== null;
}

/**
 * Validate the outputs step (now includes coin control and fees)
 * - At least one output
 * - All outputs have valid addresses
 * - All outputs have amounts (unless sendMax)
 * - If coin control is enabled, at least one UTXO must be selected
 * - Fee rate must be positive
 */
export function validateOutputsStep(state: TransactionState): boolean {
  if (state.outputs.length === 0) return false;

  // Check that all outputs are valid
  if (!state.outputsValid.every(v => v === true)) return false;

  // Check that all outputs have addresses
  if (!state.outputs.every(o => o.address.trim() !== '')) return false;

  // Check that all non-sendMax outputs have amounts
  for (const output of state.outputs) {
    if (!output.sendMax && (!output.amount || parseInt(output.amount, 10) <= 0)) {
      return false;
    }
  }

  // Coin control validation - only block if user explicitly selected UTXOs and total is insufficient
  // When no UTXOs are selected, we use "auto" mode (server picks optimal UTXOs)
  // Selecting UTXOs means user wants manual control, so they must cover the transaction

  // Fee validation (now part of outputs step)
  if (state.feeRate <= 0) {
    return false;
  }

  return true;
}

/**
 * Validate the review step
 * - Review step is always valid (it's the final step)
 */
export function validateReviewStep(_state: TransactionState): boolean {
  return true;
}

// ============================================================================
// STEP VALIDATION MAP
// ============================================================================

export const stepValidators: Record<WizardStep, (state: TransactionState) => boolean> = {
  type: validateTypeStep,
  outputs: validateOutputsStep,
  review: validateReviewStep,
};

/**
 * Check if a specific step is valid
 */
export function isStepValid(step: WizardStep, state: TransactionState): boolean {
  const validator = stepValidators[step];
  return validator ? validator(state) : false;
}

/**
 * Check if the user can proceed to the next step
 */
export function canProceedToNextStep(state: TransactionState): boolean {
  return isStepValid(state.currentStep, state);
}

/**
 * Get validation errors for a step (for display)
 */
export function getStepErrors(step: WizardStep, state: TransactionState): string[] {
  const errors: string[] = [];

  switch (step) {
    case 'type':
      if (!state.transactionType) {
        errors.push('Please select a transaction type');
      }
      break;

    case 'outputs':
      if (state.outputs.length === 0) {
        errors.push('At least one output is required');
      }
      state.outputs.forEach((output, i) => {
        if (!output.address.trim()) {
          errors.push(`Output ${i + 1}: Address is required`);
        }
        if (state.outputsValid[i] === false) {
          errors.push(`Output ${i + 1}: Invalid Bitcoin address`);
        }
        if (!output.sendMax && (!output.amount || parseInt(output.amount, 10) <= 0)) {
          errors.push(`Output ${i + 1}: Amount is required`);
        }
      });
      // Coin control is now auto by default - no error if no UTXOs selected
      // Fee validation (now part of outputs step)
      if (state.feeRate <= 0) {
        errors.push('Fee rate must be greater than 0');
      }
      break;

    case 'review':
      // No errors possible for review step
      break;
  }

  return errors;
}

/**
 * Check if transaction is ready to be signed/broadcast
 */
export function isReadyToSign(state: TransactionState): boolean {
  return (
    validateTypeStep(state) &&
    validateOutputsStep(state)
  );
}
