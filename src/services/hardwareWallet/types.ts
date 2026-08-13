/**
 * Hardware Wallet Types and Interfaces
 *
 * Defines the contract that all hardware wallet adapters must implement,
 * enabling extensible support for different device vendors.
 */

import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

export type DeviceType =
  'coldcard' | 'ledger' | 'trezor' | 'bitbox' | 'passport' | 'jade' | 'unknown';

export interface HardwareWalletDevice {
  id: string;
  type: DeviceType;
  name: string;
  model?: string;
  connected: boolean;
  fingerprint?: string;
  needsPin?: boolean;
  needsPassphrase?: boolean;
  firmwareVersion?: string;
  transportVersion?: string;
}

export interface PSBTSignRequest {
  walletId?: string;
  psbt: string; // Base64 encoded PSBT
  signingContext?: PsbtSigningContext;
  /** @deprecated Compared to signingContext and never used as a fallback. */
  inputPaths?: string[];
  /** @deprecated Compared to signingContext and never used as a fallback. */
  changeOutputs?: number[];
  /** @deprecated Compared to signingContext and never used as a fallback. */
  accountPath?: string;
  /** @deprecated Compared to signingContext and never used as a fallback. */
  scriptType?: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr';
  // Multisig xpubs keyed by fingerprint (lowercase hex) - needed for Trezor multisig signing
  multisigXpubs?: Record<string, string>;
}

export interface TrezorConnectSignedArtifact {
  type: 'trezor-connect-transaction';
  sourcePsbt: string;
  connectSignatures: string[];
  serializedTx: string;
}

export interface LedgerSignedPsbtArtifact {
  type: 'ledger-signed-psbt';
  sourcePsbt: string;
  signatures: Array<{
    inputIndex: number;
    pubkey: string;
    signature: string;
    tapleafHash?: string;
  }>;
  reconstructedPsbt: string;
}

export interface PSBTSignResponse {
  psbt?: string; // Base64 encoded signed PSBT when the adapter returns one
  signatures: number; // Number of signatures added
  rawTx?: string; // Raw signed transaction hex (for devices that return complete tx)
  trezorArtifact?: TrezorConnectSignedArtifact;
  ledgerArtifact?: LedgerSignedPsbtArtifact;
}

export interface TransactionForSigning {
  walletId: string;
  recipient: string;
  amount: number; // satoshis
  feeRate: number; // sat/vB
  utxos?: string[]; // Optional: specific UTXOs to use
  changeAddress?: string;
}

export interface XpubResult {
  xpub: string;
  fingerprint: string;
  path: string;
}

export interface HardwareWalletConnectionOptions {
  chainEnvironment?: NetworkType;
  expectedModel?: string;
}

/**
 * DeviceAdapter Interface
 *
 * All hardware wallet implementations must conform to this interface.
 * This enables adding new device support without modifying the core service.
 */
export interface DeviceAdapter {
  /** Device type identifier */
  readonly type: DeviceType;

  /** Human-readable name for the device */
  readonly displayName: string;

  /**
   * Check if this adapter is supported in the current environment
   * (e.g., WebUSB availability, HTTPS context)
   */
  isSupported(): boolean;

  /**
   * Check if a device is currently connected
   */
  isConnected(): boolean;

  /**
   * Get the currently connected device info
   */
  getDevice(): HardwareWalletDevice | null;

  /**
   * Connect to a device
   * @returns Device info on successful connection
   */
  connect(options?: HardwareWalletConnectionOptions): Promise<HardwareWalletDevice>;

  /**
   * Disconnect from the device
   */
  disconnect(): Promise<void>;

  /**
   * Get extended public key from the device
   * @param path BIP32 derivation path
   */
  getXpub(path: string): Promise<XpubResult>;

  /**
   * Sign a PSBT with the device
   * @param request PSBT signing request
   * @returns Signed PSBT and optionally raw transaction
   */
  signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse>;

  /**
   * Verify an address on the device display (optional)
   * @param path Derivation path
   * @param address Address to verify
   * @returns true if user confirmed, false if rejected
   */
  verifyAddress?(path: string, address: string): Promise<boolean>;

  /**
   * Get list of previously authorized devices (optional, for WebUSB devices)
   */
  getAuthorizedDevices?(): Promise<HardwareWalletDevice[]>;
}
