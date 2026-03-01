/**
 * Transaction Confirmations - Re-export
 *
 * This file re-exports from the modularized confirmations/ directory
 * to maintain backward compatibility with existing imports.
 *
 * @see ./confirmations/ for the implementation
 */

export {
  type ConfirmationUpdate,
  type PopulateFieldsResult,
  updateTransactionConfirmations,
  populateMissingTransactionFields,
} from './confirmations/index';
