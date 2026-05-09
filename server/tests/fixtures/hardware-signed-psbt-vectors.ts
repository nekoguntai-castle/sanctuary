/**
 * Hardware-signed PSBT fixture intake.
 *
 * This artifact list is intentionally empty until sanitized Ledger, Trezor, and
 * BitBox artifacts are captured from physical devices. Unsupported rows are
 * recorded separately so missing evidence is not confused with blocked product
 * behavior.
 */

export type HardwareWalletVendor = 'ledger' | 'trezor' | 'bitbox';

export type HardwareSignedScriptType =
  | 'p2wpkh'
  | 'p2sh-p2wpkh'
  | 'p2tr'
  | 'p2wsh'
  | 'p2sh-p2wsh';

export type HardwareSignedNetwork = 'regtest' | 'testnet' | 'signet';

export interface RequiredHardwareSignedRow {
  vendor: HardwareWalletVendor;
  scriptType: HardwareSignedScriptType;
}

export interface UnsupportedHardwareSignedRow extends RequiredHardwareSignedRow {
  reason: string;
  productDecision: 'blocked' | 'not-supported-by-device';
}

export interface HardwareSignedExpectedOutput {
  index: number;
  address: string;
  valueSats: number;
  isChange: boolean;
  derivationPath?: string;
}

export interface HardwareSignedPsbtVector {
  id: string;
  description: string;
  vendor: HardwareWalletVendor;
  scriptType: HardwareSignedScriptType;
  network: HardwareSignedNetwork;
  device: {
    model: string;
    firmwareVersion: string;
    bitcoinAppVersion?: string;
    transport: 'webusb' | 'webhid' | 'trezor-connect';
    transportVersion?: string;
  };
  account: {
    fingerprint: string;
    accountPath: string;
    xpubPrefix: string;
    walletPolicy?: string;
  };
  unsignedPsbtBase64: string;
  signedPsbtBase64?: string;
  rawTxHex?: string;
  inputValueSats: number;
  expectedFeeSats: number;
  expectedVsize: number;
  expectedTxid: string;
  expectedOutputs: HardwareSignedExpectedOutput[];
  signedBy: Array<{
    fingerprint: string;
    derivationPath: string;
    pubkey?: string;
  }>;
  evidence: {
    capturedAt: string;
    operator: string;
    bitcoinCoreVersion?: string;
    mempoolAcceptAllowed?: boolean;
    notes?: string;
  };
}

export const REQUIRED_HARDWARE_SIGNED_ROWS: RequiredHardwareSignedRow[] = [
  { vendor: 'ledger', scriptType: 'p2wpkh' },
  { vendor: 'ledger', scriptType: 'p2sh-p2wpkh' },
  { vendor: 'ledger', scriptType: 'p2tr' },
  { vendor: 'ledger', scriptType: 'p2wsh' },
  { vendor: 'ledger', scriptType: 'p2sh-p2wsh' },
  { vendor: 'trezor', scriptType: 'p2wpkh' },
  { vendor: 'trezor', scriptType: 'p2sh-p2wpkh' },
  { vendor: 'trezor', scriptType: 'p2tr' },
  { vendor: 'trezor', scriptType: 'p2wsh' },
  { vendor: 'trezor', scriptType: 'p2sh-p2wsh' },
  { vendor: 'bitbox', scriptType: 'p2wpkh' },
  { vendor: 'bitbox', scriptType: 'p2sh-p2wpkh' },
  { vendor: 'bitbox', scriptType: 'p2tr' },
  { vendor: 'bitbox', scriptType: 'p2wsh' },
  { vendor: 'bitbox', scriptType: 'p2sh-p2wsh' },
];

export const UNSUPPORTED_HARDWARE_SIGNED_ROWS: UnsupportedHardwareSignedRow[] = [
  {
    vendor: 'ledger',
    scriptType: 'p2wsh',
    reason: 'Current Ledger signing adapter builds single-sig DefaultWalletPolicy templates only; '
      + 'multisig Ledger signing is not exposed in the product.',
    productDecision: 'blocked',
  },
  {
    vendor: 'ledger',
    scriptType: 'p2sh-p2wsh',
    reason: 'Current Ledger signing adapter builds single-sig DefaultWalletPolicy templates only; '
      + 'multisig Ledger signing is not exposed in the product.',
    productDecision: 'blocked',
  },
  {
    vendor: 'bitbox',
    scriptType: 'p2wsh',
    reason: 'Current BitBox02 signing adapter uses btcSignSimple single-sig script configs only; '
      + 'multisig BitBox signing is not exposed in the product.',
    productDecision: 'blocked',
  },
  {
    vendor: 'bitbox',
    scriptType: 'p2sh-p2wsh',
    reason: 'Current BitBox02 signing adapter uses btcSignSimple single-sig script configs only; '
      + 'multisig BitBox signing is not exposed in the product.',
    productDecision: 'blocked',
  },
];

export const HARDWARE_SIGNED_PSBT_VECTORS: HardwareSignedPsbtVector[] = [];
