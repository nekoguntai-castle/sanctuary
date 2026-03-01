/**
 * Confirmations Module
 *
 * Barrel file re-exporting all confirmation-related functionality.
 * Maintains the same public API as the original confirmations.ts file.
 */

// Types
export type { ConfirmationUpdate, PopulateFieldsResult } from './types';

// Update confirmations
export { updateTransactionConfirmations } from './updateConfirmations';

// Populate missing fields
export { populateMissingTransactionFields } from './populateFields';
