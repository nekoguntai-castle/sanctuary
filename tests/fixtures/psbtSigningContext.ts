import type { PsbtSigningContext } from '../../shared/schemas/psbtSigningContext';

const masterFingerprint = 'a1b2c3d4';
const accountPath = "m/84'/0'/0'";
const addressPath = `${accountPath}/0/0`;

/**
 * Schema-valid server evidence for hook and response-contract tests that do not
 * exercise the lower-level PSBT/context cryptographic comparison themselves.
 */
export const testPsbtSigningContext = {
  version: 1,
  walletId: 'wallet-1',
  network: 'mainnet',
  walletType: 'single_sig',
  scriptType: 'native_segwit',
  canonicalPolicyId: 'single-sig-native-segwit',
  canonicalPolicyVersion: 1,
  descriptorDigest: 'b'.repeat(64),
  unsignedTransactionDigest: 'c'.repeat(64),
  signers: [{
    signerIndex: 0,
    deviceId: 'device-1',
    deviceAccountId: 'device-account-1',
    masterFingerprint,
    accountPath,
    accountXpub: 'xpub-test-account-1',
  }],
  inputs: [{
    inputIndex: 0,
    txid: 'a'.repeat(64),
    vout: 0,
    amountSats: '10123',
    scriptPubKey: `0014${'1'.repeat(40)}`,
    addressPath,
    signerOrigins: [{
      masterFingerprint,
      path: addressPath,
      pubkey: `02${'2'.repeat(64)}`,
    }],
  }],
  changeOutputs: [],
} satisfies PsbtSigningContext;
