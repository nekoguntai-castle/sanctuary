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

/**
 * Statistics tracked during field population
 */
export interface PopulationStats {
  feesPopulated: number;
  blockHeightsPopulated: number;
  blockTimesPopulated: number;
  counterpartyAddressesPopulated: number;
  addressIdsPopulated: number;
}

/**
 * Pending update entry for batch database writes
 */
export interface PendingUpdate {
  id: string;
  txid: string;
  oldConfirmations: number;
  data: Record<string, unknown>;
}
