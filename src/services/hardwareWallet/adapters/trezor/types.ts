/**
 * Trezor Adapter Types
 *
 * Shared types and interfaces for the Trezor adapter modules.
 */

/** Trezor connection state */
export interface TrezorSessionIdentity {
  path: string;
  state: string;
  instance: number;
}

export interface TrezorConnection {
  initialized: boolean;
  connected: boolean;
  session?: TrezorSessionIdentity;
  deviceId?: string;
  fingerprint?: string;
  model?: string;
  label?: string;
  firmwareVersion?: string;
  connectVersion?: string;
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
  pubkeys_order: 'LEXICOGRAPHIC';
}
