/**
 * Trezor Adapter Types
 *
 * Shared types and interfaces for the Trezor adapter modules.
 */

/** Trezor connection state */
export interface TrezorConnection {
  initialized: boolean;
  connected: boolean;
  deviceId?: string;
  fingerprint?: string;
  model?: string;
  label?: string;
}

/** Trezor multisig pubkey structure */
export interface TrezorMultisigPubkey {
  node: string;     // Hex-encoded pubkey or xpub
  address_n: number[]; // Child derivation path (change, index)
}

/** Trezor multisig structure for inputs/outputs */
export interface TrezorMultisig {
  pubkeys: TrezorMultisigPubkey[];
  signatures: string[];  // Empty strings for unsigned, hex for signed
  m: number;            // Required signatures (quorum)
}
