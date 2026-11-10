/**
 * Trezor Adapter Types
 *
 * Shared types and interfaces for the Trezor adapter modules.
 */

import type { TrezorPayToScriptType, TrezorSpendScriptType } from './signPsbtTypes';

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

/*
 * Connect boundary DTOs. These are the only shapes the adapter exchanges with
 * connectClient.ts, which alone imports the Trezor SDK. Field names follow the
 * Connect wire format so the client can pass them through unchanged. tsc
 * checks them against the SDK at the call sites in connectClient.ts, which
 * also converts the two fields whose wire encoding differs (device state,
 * multisig pubkey order).
 */

/** Bitcoin network a Connect call targets; the client maps it to a Connect coin. */
export type TrezorNetwork = 'mainnet' | 'testnet' | 'regtest';

/** Device identity sent with every bound Connect call. */
export interface TrezorDeviceIdentity {
  path: string;
  state: string | undefined;
  instance: number;
}

/** Identity of a session whose passphrase state is resolved. */
export interface TrezorBoundDeviceIdentity extends TrezorDeviceIdentity {
  state: string;
}

/** Device identity as Connect reports it; validated by sessionIdentity.ts. */
export interface TrezorResponseDevice {
  path?: unknown;
  state?: unknown;
  instance?: unknown;
}

export interface TrezorCallFailure {
  /** Connect's error message, or undefined when Connect supplied none. */
  message: string | undefined;
  code: string | undefined;
}

export type TrezorCallResult<T> =
  | { ok: true; value: T; device?: TrezorResponseDevice }
  | { ok: false; error: TrezorCallFailure };

export interface TrezorFeatures {
  device_id?: string | null;
  label?: string | null;
  model?: string;
  internal_model?: string;
  pin_protection?: boolean | null;
  unlocked?: boolean | null;
  passphrase_protection?: boolean | null;
  major_version?: number;
  minor_version?: number;
  patch_version?: number;
}

export interface TrezorDeviceState {
  state?: unknown;
}

export interface TrezorPublicKey {
  childNum?: number;
  descriptor?: string;
  depth?: number;
  fingerprint?: number;
  publicKey?: string;
  xpub?: string;
}

export interface TrezorAddress {
  address?: string;
}

export interface TrezorSignedTransaction {
  serializedTx?: unknown;
  signatures?: unknown;
}

export interface TrezorSignInput {
  address_n: number[];
  prev_hash: string;
  prev_index: number;
  sequence?: number;
  script_type: TrezorSpendScriptType;
  amount: string;
  multisig?: TrezorMultisig;
}

export interface TrezorChangeOutput {
  address_n: number[];
  amount: string;
  script_type: TrezorPayToScriptType;
  multisig?: TrezorMultisig;
}

export interface TrezorExternalOutput {
  address: string;
  amount: string;
  script_type: 'PAYTOADDRESS';
}

export type TrezorSignOutput = TrezorChangeOutput | TrezorExternalOutput;

export interface TrezorRefTx {
  hash: string;
  version: number;
  lock_time: number;
  inputs: Array<{ prev_hash: string; prev_index: number; script_sig: string; sequence: number }>;
  bin_outputs: Array<{ amount: string; script_pubkey: string }>;
}

export interface TrezorSignTransactionParams {
  inputs: TrezorSignInput[];
  outputs: TrezorSignOutput[];
  refTxs?: TrezorRefTx[];
  network: TrezorNetwork;
  version: number;
  locktime: number;
  device: TrezorDeviceIdentity;
}

/** The Connect operations Sanctuary uses, in Sanctuary's own types. */
export interface TrezorConnectClient {
  init(): Promise<void>;
  getFeatures(): Promise<TrezorCallResult<TrezorFeatures>>;
  getDeviceState(params: { device: TrezorDeviceIdentity }): Promise<TrezorCallResult<TrezorDeviceState>>;
  getPublicKey(params: {
    path: string;
    network: TrezorNetwork;
    scriptType?: TrezorSpendScriptType;
    showOnTrezor: boolean;
    device: TrezorDeviceIdentity;
  }): Promise<TrezorCallResult<TrezorPublicKey>>;
  getAddress(params: {
    path: string;
    address: string;
    network: TrezorNetwork;
    scriptType: TrezorSpendScriptType;
    showOnTrezor: boolean;
    device: TrezorDeviceIdentity;
  }): Promise<TrezorCallResult<TrezorAddress>>;
  signTransaction(
    params: TrezorSignTransactionParams
  ): Promise<TrezorCallResult<TrezorSignedTransaction>>;
}
