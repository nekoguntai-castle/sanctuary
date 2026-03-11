/**
 * Shared types and helpers for send transaction hooks.
 *
 * Contains the public API types, transaction data shape, and utility functions
 * used across all sub-hooks in the send transaction flow.
 */

import type { Wallet, Device } from '../../types';
import type { TransactionState } from '../../contexts/send/types';
import type { DeviceType } from '../../services/hardwareWallet/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('SendTxHelpers');

export interface TransactionData {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount?: number;
  utxos: Array<{
    txid: string;
    vout: number;
    address?: string;
    amount?: number;
  }>;
  outputs?: Array<{ address: string; amount: number }>;
  inputPaths?: string[];
  decoyOutputs?: Array<{ address: string; amount: number }>;
}

export interface UseSendTransactionActionsProps {
  walletId: string;
  wallet: Wallet;
  state: TransactionState;
  // Initial values for draft mode
  initialPsbt?: string | null;
  initialTxData?: TransactionData | null;
}

export interface UseSendTransactionActionsResult {
  // State
  isCreating: boolean;
  isSigning: boolean;
  isBroadcasting: boolean;
  isSavingDraft: boolean;
  error: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedRawTx: string | null;  // Raw tx hex from Trezor signing
  signedDevices: Set<string>;
  payjoinStatus: 'idle' | 'attempting' | 'success' | 'failed';

  // Actions
  createTransaction: () => Promise<TransactionData | null>;
  signWithHardwareWallet: () => Promise<string | null>;
  signWithDevice: (device: Device) => Promise<boolean>;
  broadcastTransaction: (signedPsbt?: string, rawTxHex?: string) => Promise<boolean>;
  saveDraft: (label?: string) => Promise<string | null>;
  downloadPsbt: () => void;
  uploadSignedPsbt: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  processQrSignedPsbt: (signedPsbt: string, deviceId: string) => void;
  markDeviceSigned: (deviceId: string) => void;
  clearError: () => void;
  reset: () => void;
}

/**
 * Map device type string to hardware wallet DeviceType
 * E.g., "trezor-safe-7" -> "trezor", "ledger-nano-x" -> "ledger"
 */
export function getHardwareWalletType(deviceType: string): DeviceType | null {
  const normalizedType = deviceType.toLowerCase();
  if (normalizedType.includes('trezor')) return 'trezor';
  if (normalizedType.includes('ledger')) return 'ledger';
  if (normalizedType.includes('coldcard')) return 'coldcard';
  if (normalizedType.includes('bitbox')) return 'bitbox';
  if (normalizedType.includes('passport') || normalizedType.includes('foundation')) return 'passport';
  if (normalizedType.includes('jade') || normalizedType.includes('blockstream')) return 'jade';
  return null;
}

/**
 * Extract xpubs from a multisig descriptor keyed by fingerprint
 * Returns a map of fingerprint (lowercase) -> xpub for Trezor multisig signing
 */
export function extractXpubsFromDescriptor(descriptor: string | undefined): Record<string, string> | undefined {
  if (!descriptor) {
    log.warn('extractXpubsFromDescriptor: No descriptor provided');
    return undefined;
  }

  log.info('extractXpubsFromDescriptor: Parsing descriptor', {
    descriptorLength: descriptor.length,
    descriptorPreview: descriptor.substring(0, 100) + '...',
  });

  // Match patterns like [fingerprint/path]xpub...
  // Handles sortedmulti, wsh, sh-wsh descriptors
  // The xpub can contain any base58 character (alphanumeric except 0, O, I, l)
  const keyRegex = /\[([a-fA-F0-9]{8})\/[^\]]+\]([xyztuvYZTUV]pub[1-9A-HJ-NP-Za-km-z]+)/g;
  const xpubMap: Record<string, string> = {};

  let match;
  while ((match = keyRegex.exec(descriptor)) !== null) {
    const fingerprint = match[1].toLowerCase();
    const xpub = match[2];
    log.info('extractXpubsFromDescriptor: Found xpub', {
      fingerprint,
      xpubPrefix: xpub.substring(0, 20),
      xpubLength: xpub.length,
    });
    xpubMap[fingerprint] = xpub;
  }

  if (Object.keys(xpubMap).length === 0) {
    log.warn('extractXpubsFromDescriptor: No xpubs found in descriptor');
    return undefined;
  }

  log.info('extractXpubsFromDescriptor: Extracted xpubs', {
    fingerprints: Object.keys(xpubMap),
    count: Object.keys(xpubMap).length,
  });

  return xpubMap;
}
