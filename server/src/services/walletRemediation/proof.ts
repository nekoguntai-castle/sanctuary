import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import { randomUUID } from 'node:crypto';
import {
  CANONICAL_ADDRESS_COORDINATE_VERSION,
  WALLET_POLICY_REGISTRY_VERSION,
  accountPathMatchesWalletPolicy,
  findWalletPolicy,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  isWalletScriptType,
  isWalletType,
  type WalletScriptType,
  type WalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import { deriveCanonicalAddress } from '../bitcoin/addressDerivation';
import { convertToStandardXpub } from '../bitcoin/addressDerivation/xpubConversion';
import { getNetwork } from '../bitcoin/addressDerivation/utils';
import {
  parseCanonicalDescriptor,
  validateCanonicalDescriptorPair,
} from '../bitcoin/descriptorParser';
import { prepareDescriptorPolicy } from '../wallet/descriptorPolicy';
import { remediationDigest, remediationProofDigest } from '../../utils/walletRemediationCanonicalDocument';
import {
  WALLET_REMEDIATION_SCHEMA_VERSION,
  type RemediationBlocker,
  type RemediationChange,
  type RemediationSignerRow,
  type WalletRemediationDocument,
  type WalletRemediationSnapshot,
} from './types';

const MAX_REMEDIATION_ADDRESSES = 5_000;
const FORWARD_FIX_MESSAGE = 'Applied proof metadata is immutable. Backout disables the affected capability and uses a reviewed forward fix; it never clears evidence.';

interface ProvenWalletPolicy {
  change: RemediationChange | null;
  receive: string;
  changeDescriptor: string;
}

type ParsedDescriptorKey = ReturnType<typeof parseCanonicalDescriptor>['keys'][number];
type WalletRow = WalletRemediationSnapshot['wallet'];
type SupportedWalletRow = WalletRow & {
  type: WalletType;
  scriptType: WalletScriptType;
  descriptor: string;
  changeDescriptor: string;
  sourceDescriptor: string;
};
type PreparedPolicy = ReturnType<typeof prepareDescriptorPolicy>;
type RegisteredPolicy = NonNullable<ReturnType<typeof findWalletPolicy>>;
type ProposedMetadata = Record<string, string | number>;

const blocker = (code: string, message: string): RemediationBlocker => ({ code, message });

function exactOriginalState(snapshot: WalletRemediationSnapshot): WalletRemediationSnapshot {
  const walletFields: Array<keyof WalletRemediationSnapshot['wallet']> = [
    'id', 'type', 'scriptType', 'network', 'quorum', 'totalSigners', 'descriptor',
    'changeDescriptor', 'descriptorPolicyVersion', 'descriptorSourceKind', 'sourceDescriptor',
    'sourceChangeDescriptor', 'sourceDescriptorChecksum', 'sourceChangeDescriptorChecksum',
    'fingerprint', 'canonicalPolicyId', 'canonicalPolicyVersion',
  ];
  const signerFields: Array<keyof RemediationSignerRow> = [
    'id', 'walletId', 'deviceId', 'deviceAccountId', 'signerIndex', 'signerBindingVersion',
    'signerFingerprint', 'signerXpub', 'signerDerivationPath', 'signerPurpose', 'signerScriptType',
    'deviceFingerprint', 'accountId', 'accountPurpose', 'accountScriptType',
    'accountDerivationPath', 'accountXpub',
  ];
  const addressFields: Array<keyof WalletRemediationSnapshot['addresses'][number]> = [
    'id', 'walletId', 'address', 'derivationPath', 'index', 'branch', 'coordinateVersion',
    'canonicalPolicyId', 'canonicalPolicyVersion', 'scriptPubKey',
  ];
  const pick = <T extends object>(value: T, fields: Array<keyof T>): T => Object.fromEntries(
    fields.map(field => [field, value[field]]),
  ) as T;
  return {
    wallet: pick(snapshot.wallet, walletFields),
    signers: snapshot.signers.map(signer => pick(signer, signerFields)).sort((a, b) => a.id.localeCompare(b.id)),
    addresses: snapshot.addresses.map(address => pick(address, addressFields)).sort((a, b) => a.id.localeCompare(b.id)),
    ownerUserIds: [...snapshot.ownerUserIds].sort(),
  };
}

const underlyingXpubBytes = (xpub: string): string | null => {
  try {
    const bytes = bs58check.decode(convertToStandardXpub(xpub));
    /* v8 ignore next -- canonical descriptor parsing admits only 78-byte extended public keys */
    return bytes.length === 78 ? Buffer.from(bytes.slice(13)).toString('hex') : null;
  } catch {
    /* v8 ignore next -- malformed xpubs fail exact equality before this defensive decoder fallback */
    return null;
  }
};

const exactNullable = (
  current: string | number | null,
  proposed: string | number,
): string | number | undefined => {
  if (current === null) return proposed;
  if (current !== proposed) throw new Error('Existing metadata conflicts with proven metadata');
  return undefined;
};

const containsOrderedMultisigDescriptor = (
  wallet: WalletRow,
): boolean => {
  const descriptors = [
    wallet.descriptor,
    wallet.changeDescriptor,
    wallet.sourceDescriptor,
    wallet.sourceChangeDescriptor,
  ];
  for (const descriptor of descriptors) {
    if (descriptor === null) continue;
    const normalized = descriptor.toLowerCase();
    if (normalized.startsWith('multi(') || normalized.includes('(multi(')) return true;
  }
  return false;
};

const validateWalletPolicyCandidate = (
  wallet: WalletRow,
  blockers: RemediationBlocker[],
): wallet is SupportedWalletRow => {
  if (!wallet.descriptor || !wallet.changeDescriptor || !wallet.sourceDescriptor) {
    blockers.push(blocker('descriptor.provenance_missing', 'Exact descriptor provenance is required.'));
    return false;
  }
  if (!isWalletType(wallet.type) || !isWalletScriptType(wallet.scriptType)) {
    blockers.push(blocker('policy.unsupported', 'Wallet policy is unsupported.'));
    return false;
  }
  if (wallet.type === 'multi_sig' && (wallet.scriptType === 'legacy' || wallet.scriptType === 'taproot')) {
    blockers.push(blocker('policy.multisig_unsupported', 'Legacy and Taproot multisig remediation remain blocked.'));
    return false;
  }
  if (containsOrderedMultisigDescriptor(wallet)) {
    blockers.push(blocker('policy.ordered_multisig_unsupported', 'Ordered multisig remediation remains blocked.'));
    return false;
  }
  return true;
};

const prepareWalletDescriptors = (wallet: SupportedWalletRow): PreparedPolicy => {
  if (wallet.sourceChangeDescriptor === null) {
    return prepareDescriptorPolicy({ receiveDescriptor: wallet.sourceDescriptor, sourceKind: 'imported' });
  }
  return prepareDescriptorPolicy({
    receiveDescriptor: wallet.sourceDescriptor,
    changeDescriptor: wallet.sourceChangeDescriptor,
    sourceKind: wallet.descriptorSourceKind === 'generated_pair' ? 'generated_pair' : 'imported',
  });
};

const proveDescriptorPolicy = (
  wallet: SupportedWalletRow,
  prepared: PreparedPolicy,
): RegisteredPolicy => {
  if (prepared.descriptor !== wallet.descriptor || prepared.changeDescriptor !== wallet.changeDescriptor) {
    throw new Error('Source descriptors do not reproduce active descriptors');
  }
  const pair = validateCanonicalDescriptorPair(wallet.descriptor, wallet.changeDescriptor);
  const policy = findWalletPolicy(wallet.type, wallet.scriptType);
  if (!policy || pair.receive.wrapper !== policy.descriptorWrapper) {
    throw new Error('Descriptor wrapper does not match wallet policy');
  }
  const fingerprint = pair.receive.keys.map((key) => key.fingerprint).join('-');
  if (wallet.fingerprint?.toLowerCase() !== fingerprint) {
    throw new Error('Wallet fingerprint order does not match descriptor order');
  }
  return policy;
};

const walletPolicyPatch = (
  wallet: WalletRow,
  prepared: PreparedPolicy,
  policy: RegisteredPolicy,
): Record<string, string | number> => {
  const proposed: Record<string, string | number> = {};
  const values = {
    descriptorPolicyVersion: prepared.descriptorPolicyVersion,
    descriptorSourceKind: prepared.descriptorSourceKind,
    sourceDescriptorChecksum: prepared.sourceDescriptorChecksum,
    sourceChangeDescriptorChecksum: prepared.sourceChangeDescriptorChecksum,
    canonicalPolicyId: policy.id,
    canonicalPolicyVersion: policy.version,
  } as const;
  for (const [field, value] of Object.entries(values)) {
    if (value === null) continue;
    const current = wallet[field as keyof WalletRow] as string | number | null;
    const patch = exactNullable(current, value);
    if (patch !== undefined) proposed[field] = patch;
  }
  return proposed;
};

const walletPolicyChange = (
  snapshot: WalletRemediationSnapshot,
  blockers: RemediationBlocker[],
): ProvenWalletPolicy | null => {
  const wallet = snapshot.wallet;
  if (!validateWalletPolicyCandidate(wallet, blockers)) return null;

  try {
    const prepared = prepareWalletDescriptors(wallet);
    const policy = proveDescriptorPolicy(wallet, prepared);
    const proposed = walletPolicyPatch(wallet, prepared, policy);
    return {
      change: Object.keys(proposed).length === 0 ? null : {
        kind: 'wallet_policy',
        recordId: wallet.id,
        proposed,
        evidenceIds: ['wallet:' + wallet.id + ':descriptor-policy'],
      },
      receive: prepared.descriptor,
      changeDescriptor: prepared.changeDescriptor,
    };
  } catch (error) {
    blockers.push(blocker(
      'descriptor.provenance_unproven',
      /* v8 ignore next -- every called descriptor/policy boundary throws Error objects */
      error instanceof Error ? error.message : 'Descriptor provenance is unproven.',
    ));
    return null;
  }
};

const signerMetadataPatch = (
  signer: RemediationSignerRow,
  key: ParsedDescriptorKey,
  position: number,
): ProposedMetadata => {
  const proposed: ProposedMetadata = {};
  const values = {
    deviceAccountId: signer.accountId as string,
    signerIndex: position,
    signerBindingVersion: 1,
    signerFingerprint: key.fingerprint,
    signerXpub: signer.accountXpub as string,
    signerDerivationPath: key.accountPath,
    signerPurpose: signer.accountPurpose as string,
    signerScriptType: signer.accountScriptType as string,
  };
  for (const [field, value] of Object.entries(values)) {
    const current = signer[field as keyof RemediationSignerRow] as string | number | null;
    const patch = exactNullable(current, value);
    if (patch !== undefined) proposed[field] = patch;
  }
  return proposed;
};

const uniqueSignerMatch = (
  snapshot: WalletRemediationSnapshot,
  key: ParsedDescriptorKey,
  position: number,
  usedSignerIds: Set<string>,
): RemediationSignerRow => {
  const matches = snapshot.signers.filter((signer) => signerMatchesKey(signer, key, snapshot));
  /* v8 ignore next -- duplicate-link reuse is retained as defense after exact one-match filtering */
  if (matches.length !== 1 || usedSignerIds.has(matches[0]?.id ?? '')) {
    throw new Error('Descriptor signer ' + position + ' does not have one unique linked DeviceAccount');
  }
  const signer = matches[0];
  if (signer.signerIndex !== null && signer.signerIndex !== position) {
    throw new Error('Stored signer index ' + signer.signerIndex
      + ' conflicts with descriptor position ' + position);
  }
  return signer;
};

const signerChanges = (
  snapshot: WalletRemediationSnapshot,
  receiveDescriptor: string,
  blockers: RemediationBlocker[],
): RemediationChange[] => {
  try {
    const descriptor = parseCanonicalDescriptor(receiveDescriptor);
    const signers = snapshot.signers;
    const linkCount = new Set(signers.map((signer) => signer.id)).size;
    if (descriptor.keys.length !== linkCount || linkCount === 0) {
      throw new Error('Descriptor signer and wallet link counts differ');
    }
    const usedSignerIds = new Set<string>();
    const changes: RemediationChange[] = [];
    for (const [position, key] of descriptor.keys.entries()) {
      const signer = uniqueSignerMatch(snapshot, key, position, usedSignerIds);
      usedSignerIds.add(signer.id);
      const proposed = signerMetadataPatch(signer, key, position);
      if (Object.keys(proposed).length > 0) changes.push({
        kind: 'signer_binding',
        recordId: signer.id,
        proposed,
        evidenceIds: ['wallet:' + snapshot.wallet.id + ':signer:' + position],
      });
    }
    return changes;
  } catch (error) {
    blockers.push(blocker(
      'signer.binding_ambiguous',
      /* v8 ignore next -- every called signer boundary throws Error objects */
      error instanceof Error ? error.message : 'Signer binding is ambiguous.',
    ));
    return [];
  }
};

const signerMatchesKey = (
  signer: RemediationSignerRow,
  key: ParsedDescriptorKey,
  snapshot: WalletRemediationSnapshot,
): boolean => {
  if (!signer.accountId || !signer.accountXpub || !signer.accountDerivationPath
    || !signer.accountPurpose || !signer.accountScriptType) return false;
  if (signer.deviceAccountId !== null && signer.deviceAccountId !== signer.accountId) return false;
  const wallet = snapshot.wallet;
  return signer.deviceFingerprint.toLowerCase() === key.fingerprint
    && signer.accountDerivationPath === key.accountPath
    && signer.accountPurpose === (wallet.type === 'multi_sig' ? 'multisig' : 'single_sig')
    && signer.accountScriptType === wallet.scriptType
    && accountPathMatchesWalletPolicy(signer.accountDerivationPath, {
      walletType: wallet.type as never,
      scriptType: wallet.scriptType as never,
      chainEnvironment: wallet.network as never,
    })
    && signer.accountXpub === key.xpub
    && underlyingXpubBytes(signer.accountXpub) === key.underlyingKeyId;
};

const addressChanges = (
  snapshot: WalletRemediationSnapshot,
  descriptors: { receive: string; changeDescriptor: string },
  blockers: RemediationBlocker[],
): RemediationChange[] => {
  const wallet = snapshot.wallet;
  if (snapshot.addresses.length === 0) {
    blockers.push(blocker('address.zero_addresses', 'Zero-address wallets cannot be remediated automatically.'));
    return [];
  }
  if (snapshot.addresses.length > MAX_REMEDIATION_ADDRESSES) {
    blockers.push(blocker('address.limit_exceeded', 'Wallet exceeds the reviewed remediation address limit.'));
    return [];
  }
  const policy = findWalletPolicy(wallet.type as never, wallet.scriptType as never);
  /* v8 ignore next -- walletPolicyChange already proves this same registry identity */
  if (!policy) return [];
  const changes: RemediationChange[] = [];
  for (const address of snapshot.addresses) {
    try {
      const storedScript = Buffer.from(bitcoin.address.toOutputScript(
        address.address,
        getNetwork(wallet.network as never),
      )).toString('hex');
      const candidates = ([0, 1] as const).map((branch) => deriveCanonicalAddress(
        { receiveDescriptor: descriptors.receive, changeDescriptor: descriptors.changeDescriptor },
        { branch, index: address.index, network: wallet.network as never },
      )).filter((derived) => derived.address === address.address
        && derived.scriptPubKey === storedScript
        && derived.derivationPath === address.derivationPath);
      if (candidates.length !== 1) throw new Error('Stored address does not have one exact branch match');
      const derived = candidates[0];
      const proposed: Record<string, string | number> = {};
      const values = {
        branch: derived.branch,
        coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION,
        canonicalPolicyId: policy.id,
        canonicalPolicyVersion: WALLET_POLICY_REGISTRY_VERSION,
        scriptPubKey: storedScript,
      };
      for (const [field, value] of Object.entries(values)) {
        const current = address[field as keyof typeof address] as string | number | null;
        const patch = exactNullable(current, value);
        if (patch !== undefined) proposed[field] = patch;
      }
      if (Object.keys(proposed).length > 0) changes.push({
        kind: 'address_coordinate',
        recordId: address.id,
        proposed,
        evidenceIds: ['wallet:' + wallet.id + ':address:' + address.id],
      });
    } catch (error) {
      blockers.push(blocker(
        'address.proof_ambiguous',
        /* v8 ignore next -- every called address boundary throws Error objects */
        address.id + ': ' + (error instanceof Error ? error.message : 'Address proof failed.'),
      ));
    }
  }
  return changes;
};

export const buildWalletRemediationDocument = (
  snapshot: WalletRemediationSnapshot,
  attemptId: string = randomUUID(),
): WalletRemediationDocument => {
  const blockers: RemediationBlocker[] = [];
  const changes: RemediationChange[] = [];
  const policy = walletPolicyChange(snapshot, blockers);
  if (policy) {
    if (policy.change) changes.push(policy.change);
    changes.push(...signerChanges(snapshot, policy.receive, blockers));
    changes.push(...addressChanges(snapshot, policy, blockers));
  }
  const eligible = blockers.length === 0;
  const changeEvidenceIds = changes.flatMap((change) => change.evidenceIds);
  const originalState = exactOriginalState(snapshot);
  const originalStateDigest = remediationDigest(originalState);
  const recoveryEvidenceDigest = eligible ? remediationDigest({
    walletId: snapshot.wallet.id,
    descriptor: snapshot.wallet.descriptor,
    changeDescriptor: snapshot.wallet.changeDescriptor,
    fingerprint: snapshot.wallet.fingerprint,
    policyId: snapshot.wallet.canonicalPolicyId ?? changes.find(change => change.kind === 'wallet_policy')
      ?.proposed.canonicalPolicyId,
    policyVersion: snapshot.wallet.canonicalPolicyVersion ?? changes.find(change => change.kind === 'wallet_policy')
      ?.proposed.canonicalPolicyVersion,
    signers: originalState.signers.map(signer => ({
      linkId: signer.id,
      accountId: signer.accountId,
      fingerprint: signer.deviceFingerprint,
      derivationPath: signer.accountDerivationPath,
      xpub: signer.accountXpub,
    })),
  }) : null;
  const evidenceIds = eligible && recoveryEvidenceDigest
    ? [...new Set([
      ...changeEvidenceIds,
      'wallet:' + snapshot.wallet.id + ':recovery:' + recoveryEvidenceDigest,
    ])]
    : [];
  const proofDocument: Omit<WalletRemediationDocument, 'proofDigest'> = {
    schemaVersion: WALLET_REMEDIATION_SCHEMA_VERSION,
    attemptId,
    walletId: snapshot.wallet.id,
    eligible,
    originalStateDigest,
    originalState,
    changes: eligible ? changes : [],
    blockers,
    proof: {
      preservedPolicyDigest: remediationDigest({
        descriptor: snapshot.wallet.descriptor,
        changeDescriptor: snapshot.wallet.changeDescriptor,
        fingerprint: snapshot.wallet.fingerprint,
        type: snapshot.wallet.type,
        scriptType: snapshot.wallet.scriptType,
        network: snapshot.wallet.network,
        quorum: snapshot.wallet.quorum,
        totalSigners: snapshot.wallet.totalSigners,
      }),
      addressCount: snapshot.addresses.length,
      unchangedAddressCount: eligible ? snapshot.addresses.length : 0,
      scriptPubKeyCount: snapshot.addresses.length,
      unchangedScriptPubKeyCount: eligible ? snapshot.addresses.length : 0,
      recoveryStatus: eligible ? 'recovery-proven' : 'blocked',
      signingStatus: 'not-tested',
      recoveryEvidenceDigest,
      evidenceIds: eligible ? evidenceIds : [],
    },
    backout: { state: 'not-applied', message: FORWARD_FIX_MESSAGE },
  };
  return {
    ...proofDocument,
    proofDigest: remediationProofDigest(proofDocument),
  };
};
