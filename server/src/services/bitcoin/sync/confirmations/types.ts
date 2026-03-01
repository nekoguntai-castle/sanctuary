/**
 * Confirmation Types
 *
 * Shared interfaces for the confirmations module.
 */

/**
 * Confirmation update result with milestone tracking
 */
export interface ConfirmationUpdate {
  txid: string;
  oldConfirmations: number;
  newConfirmations: number;
}

/**
 * Result from populating missing transaction fields
 */
export interface PopulateFieldsResult {
  updated: number;
  confirmationUpdates: ConfirmationUpdate[];
}
