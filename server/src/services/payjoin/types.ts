/**
 * Payjoin Types
 *
 * BIP78 error codes, result types, and validation types.
 */

// BIP78 error codes
export const PayjoinErrors = {
  VERSION_UNSUPPORTED: 'version-unsupported',
  UNAVAILABLE: 'unavailable',
  NOT_ENOUGH_MONEY: 'not-enough-money',
  ORIGINAL_PSBT_REJECTED: 'original-psbt-rejected',
  RECEIVER_ERROR: 'receiver-error',
} as const;

export type PayjoinErrorCode = typeof PayjoinErrors[keyof typeof PayjoinErrors];

export interface PayjoinResult {
  success: boolean;
  proposalPsbt?: string;
  error?: PayjoinErrorCode;
  errorMessage?: string;
}

export interface PayjoinValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
