import { normalizeDerivationPath, parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import type { ParsedDescriptor } from '../bitcoin/descriptorParser/types';
import type {
  RawAuditSigner,
  RawAuditWallet,
  WalletAuditFindingId,
} from './schema';
import { inspectExtendedKeyEvidence } from './extendedKeyEvidence';

// BIP32 reserves the high bit for hardened child-number serialization, so an
// account index cannot exceed the largest unhardened index.
const MAX_BIP32_INDEX = 0x7fffffff;

export function networkCoinType(value: string): number | null {
  if (value === 'mainnet') return 0;
  if (['testnet3', 'testnet4', 'testnet', 'signet', 'regtest'].includes(value)) return 1;
  return null;
}

/**
 * Verifies that raw audit evidence names an exact hardened account-level path
 * for the wallet policy. BIP44/49/84/86 are the supported single-sig families;
 * BIP48 script branches 1 and 2 are the supported multisig families. Null,
 * address-level, non-hardened, cross-network, and semantically mismatched paths
 * fail closed so legacy database drift cannot be classified as proven safe.
 */
export function accountPathMatchesWalletPolicy(
  derivationPath: string | null,
  wallet: RawAuditWallet,
): boolean {
  const parsed = parseDerivationPath(derivationPath);
  const normalized = normalizeDerivationPath(derivationPath);
  const expectedPurpose = wallet.type === 'multi_sig' ? 'multisig' : 'single_sig';
  const canonicalPath = wallet.type === 'multi_sig'
    ? /^m\/48'\/(?:0|1)'\/\d+'\/(?:1|2)'$/
    : /^m\/(?:44|49|84|86)'\/(?:0|1)'\/\d+'$/;
  return parsed.valid
    // An exact account path has no receive/change or address suffix.
    && parsed.accountPath === normalized
    && canonicalPath.test(normalized)
    && parsed.accountIndex !== null
    && parsed.accountIndex <= MAX_BIP32_INDEX
    && parsed.coinType === networkCoinType(wallet.network)
    && parsed.accountPurpose === expectedPurpose
    && parsed.scriptType === wallet.scriptType;
}

export function snapshotComplete(signer: RawAuditSigner): boolean {
  return signer.deviceAccountId !== null
    && signer.signerIndex !== null
    && signer.signerBindingVersion === 1
    && signer.signerFingerprint !== null
    && signer.signerXpub !== null
    && signer.signerDerivationPath !== null
    && signer.signerPurpose !== null
    && signer.signerScriptType !== null
    && signer.accountPurpose !== null
    && signer.accountScriptType !== null
    && signer.accountDerivationPath !== null
    && signer.accountXpub !== null;
}

export function snapshotMatchesCurrentAccount(signer: RawAuditSigner): boolean {
  return signer.signerFingerprint?.toLowerCase() === signer.deviceFingerprint.toLowerCase()
    && signer.signerXpub === signer.accountXpub
    && normalizeDerivationPath(signer.signerDerivationPath) === normalizeDerivationPath(signer.accountDerivationPath)
    && signer.signerPurpose === signer.accountPurpose
    && signer.signerScriptType === signer.accountScriptType;
}

export function snapshotMatchesWallet(signer: RawAuditSigner, wallet: RawAuditWallet): boolean {
  const expectedPurpose = wallet.type === 'multi_sig' ? 'multisig' : 'single_sig';
  return accountPathMatchesWalletPolicy(signer.signerDerivationPath, wallet)
    && signer.signerPurpose === expectedPurpose
    && signer.signerScriptType === wallet.scriptType;
}

export function snapshotMatchesDescriptor(signer: RawAuditSigner, descriptor: ParsedDescriptor): boolean {
  if (signer.signerIndex === null) return false;
  const device = descriptor.devices[signer.signerIndex];
  return device !== undefined
    && device.fingerprint.toLowerCase() === signer.signerFingerprint?.toLowerCase()
    && device.xpub === signer.signerXpub
    && device.derivationPath === normalizeDerivationPath(signer.signerDerivationPath);
}

export function indicesAreExact(signers: readonly RawAuditSigner[]): boolean {
  for (const [position, signer] of signers.entries()) {
    if (signer.signerIndex !== position) return false;
  }
  return true;
}

export function inspectSignerEvidence(
  wallet: RawAuditWallet,
  signers: readonly RawAuditSigner[],
  descriptor: ParsedDescriptor | null,
): WalletAuditFindingId[] {
  if (signers.length === 0) return [];
  const findings = new Set<WalletAuditFindingId>();
  if (!descriptor || descriptor.devices.length !== signers.length || !indicesAreExact(signers)) {
    findings.add('signer.binding_ambiguous');
  }

  for (const signer of signers) {
    if (!snapshotComplete(signer)) {
      findings.add('signer.binding_incomplete');
      continue;
    }
    if (!snapshotMatchesCurrentAccount(signer) || !snapshotMatchesWallet(signer, wallet)) {
      findings.add('signer.snapshot_mismatch');
    }
    if (!descriptor || !snapshotMatchesDescriptor(signer, descriptor)) {
      findings.add('signer.binding_ambiguous');
    }
    for (const finding of inspectExtendedKeyEvidence({
      xpub: signer.signerXpub as string,
      fingerprint: signer.signerFingerprint as string,
      derivationPath: signer.signerDerivationPath as string,
      walletNetwork: wallet.network,
      walletType: wallet.type,
      scriptType: wallet.scriptType,
    })) findings.add(finding);
  }
  return [...findings];
}
