import { parseDescriptorForImport } from '../bitcoin/descriptorParser';
import { removeChecksum } from '../bitcoin/descriptorParser/checksum';
import {
  prepareDescriptorPolicy,
  type PreparedDescriptorPolicy,
} from '../wallet/descriptorPolicy';
import type { ParsedDescriptor } from '../bitcoin/descriptorParser/types';
import type {
  RawAuditWallet,
  WalletAuditFindingId,
} from './schema';
import { inspectExtendedKeyEvidence } from './extendedKeyEvidence';
import { accountPathMatchesWalletPolicy } from './signerEvidence';

export interface DescriptorEvidenceResult {
  findings: WalletAuditFindingId[];
  receive: ParsedDescriptor | null;
  change: ParsedDescriptor | null;
}

const orderedMulti = (value: string): boolean => /(^|\()multi\(/i.test(value);

const descriptorTokens = (wallet: RawAuditWallet): string[] => [
  wallet.descriptor,
  wallet.changeDescriptor,
  wallet.sourceDescriptor,
  wallet.sourceChangeDescriptor,
].filter((value): value is string => value !== null);

function unsupportedFindings(wallet: RawAuditWallet): WalletAuditFindingId[] {
  const combined = descriptorTokens(wallet).join('\n');
  const findings: WalletAuditFindingId[] = [];
  if (orderedMulti(combined)) findings.push('policy.ordered_multisig_unsupported');
  if (wallet.type === 'multi_sig' && wallet.scriptType === 'legacy') {
    findings.push('policy.legacy_multisig_unsupported');
  }
  if (wallet.type === 'multi_sig' && wallet.scriptType === 'taproot') {
    findings.push('policy.taproot_multisig_unsupported');
  }
  return findings;
}

function hasMixedBranches(value: string | null): boolean {
  if (!value || value.includes('<0;1>')) return false;
  const branches = new Set(Array.from(value.matchAll(/\/([01])\/\*/g), (match) => match[1]));
  return branches.size > 1;
}

function checksumSuffix(value: string): string | null {
  const separator = value.lastIndexOf('#');
  return separator === -1 ? null : value.slice(separator + 1);
}

function parsedPoliciesMatch(left: ParsedDescriptor, right: ParsedDescriptor): boolean {
  return left.type === right.type
    && left.scriptType === right.scriptType
    && descriptorNetworkFamily(left.network) === descriptorNetworkFamily(right.network)
    && left.quorum === right.quorum
    && left.totalSigners === right.totalSigners
    && left.devices.length === right.devices.length
    && left.devices.every((device, index) => {
      const other = right.devices[index];
      return other !== undefined
        && device.fingerprint.toLowerCase() === other.fingerprint.toLowerCase()
        && device.xpub === other.xpub
        && device.derivationPath === other.derivationPath;
    });
}

function sourceTokensMatchRuntime(wallet: RawAuditWallet): boolean {
  if (!wallet.descriptor || !wallet.changeDescriptor
    || !wallet.sourceDescriptor || !wallet.sourceChangeDescriptor) return false;
  return removeChecksum(wallet.sourceDescriptor) === wallet.descriptor
    && removeChecksum(wallet.sourceChangeDescriptor) === wallet.changeDescriptor
    && checksumSuffix(wallet.sourceDescriptor) === wallet.sourceDescriptorChecksum
    && checksumSuffix(wallet.sourceChangeDescriptor) === wallet.sourceChangeDescriptorChecksum;
}

function hasExactOrderedRecoveryProvenance(wallet: RawAuditWallet): boolean {
  try {
    if (!sourceTokensMatchRuntime(wallet)) return false;
    const receive = parseDescriptorForImport(wallet.descriptor as string);
    const change = parseDescriptorForImport(wallet.changeDescriptor as string);
    const sourceReceive = parseDescriptorForImport(wallet.sourceDescriptor as string);
    const sourceChange = parseDescriptorForImport(wallet.sourceChangeDescriptor as string);
    return !receive.isChange
      && change.isChange
      && !sourceReceive.isChange
      && sourceChange.isChange
      && parsedPoliciesMatch(receive, change)
      && parsedPoliciesMatch(sourceReceive, sourceChange)
      && parsedPoliciesMatch(receive, sourceReceive)
      && parsedPoliciesMatch(change, sourceChange);
  } catch {
    return false;
  }
}

function reconstructPolicy(wallet: RawAuditWallet): PreparedDescriptorPolicy | null {
  if (!wallet.sourceDescriptor) return null;
  if (wallet.descriptorSourceKind === 'generated_pair') {
    if (!wallet.sourceChangeDescriptor) return null;
    return prepareDescriptorPolicy({
      receiveDescriptor: wallet.sourceDescriptor,
      changeDescriptor: wallet.sourceChangeDescriptor,
      sourceKind: 'generated_pair',
    });
  }
  if (wallet.descriptorSourceKind === 'imported_pair') {
    if (!wallet.sourceChangeDescriptor) return null;
    return prepareDescriptorPolicy({
      receiveDescriptor: wallet.sourceDescriptor,
      changeDescriptor: wallet.sourceChangeDescriptor,
      sourceKind: 'imported',
    });
  }
  if (wallet.descriptorSourceKind === 'imported_multipath') {
    return prepareDescriptorPolicy({
      receiveDescriptor: wallet.sourceDescriptor,
      sourceKind: 'imported',
    });
  }
  return null;
}

function policyMatches(wallet: RawAuditWallet, policy: PreparedDescriptorPolicy): boolean {
  return wallet.descriptorPolicyVersion === policy.descriptorPolicyVersion
    && wallet.descriptorSourceKind === policy.descriptorSourceKind
    && wallet.descriptor === policy.descriptor
    && wallet.changeDescriptor === policy.changeDescriptor
    && wallet.sourceDescriptor === policy.sourceDescriptor
    && wallet.sourceChangeDescriptor === policy.sourceChangeDescriptor
    && wallet.sourceDescriptorChecksum === policy.sourceDescriptorChecksum
    && wallet.sourceChangeDescriptorChecksum === policy.sourceChangeDescriptorChecksum;
}

function parseBranches(wallet: RawAuditWallet): Pick<DescriptorEvidenceResult, 'receive' | 'change'> {
  if (!wallet.descriptor || !wallet.changeDescriptor) return { receive: null, change: null };
  try {
    return {
      receive: parseDescriptorForImport(wallet.descriptor),
      change: parseDescriptorForImport(wallet.changeDescriptor),
    };
  } catch {
    return { receive: null, change: null };
  }
}

function descriptorKeyFindings(
  wallet: RawAuditWallet,
  descriptor: ParsedDescriptor | null,
): WalletAuditFindingId[] {
  if (!descriptor) return [];
  return descriptor.devices.flatMap((device) => inspectExtendedKeyEvidence({
    xpub: device.xpub,
    fingerprint: device.fingerprint,
    derivationPath: device.derivationPath,
    walletNetwork: wallet.network,
    walletType: wallet.type,
    scriptType: wallet.scriptType,
  }));
}

function descriptorNetworkFamily(value: string): 'mainnet' | 'testnet' | null {
  if (value === 'mainnet') return 'mainnet';
  if (['testnet', 'testnet3', 'testnet4', 'signet', 'regtest'].includes(value)) return 'testnet';
  return null;
}

function parsedPolicyMatchesWallet(wallet: RawAuditWallet, parsed: ParsedDescriptor): boolean {
  const fingerprint = parsed.devices.map((device) => device.fingerprint).join('-');
  return parsed.type === wallet.type
    && parsed.scriptType === wallet.scriptType
    && descriptorNetworkFamily(parsed.network) === descriptorNetworkFamily(wallet.network)
    && (parsed.quorum ?? null) === wallet.quorum
    && (parsed.totalSigners ?? null) === wallet.totalSigners
    && fingerprint.toLowerCase() === wallet.fingerprint?.toLowerCase()
    // Validate every origin, including signerless wallets: consistent but
    // noncanonical raw database values must never become proven-safe evidence.
    && parsed.devices.every((device) => accountPathMatchesWalletPolicy(
      device.derivationPath,
      wallet,
    ));
}

export function inspectDescriptorEvidence(wallet: RawAuditWallet): DescriptorEvidenceResult {
  const findings = unsupportedFindings(wallet);
  if (descriptorTokens(wallet).some(hasMixedBranches)) {
    findings.push('descriptor.mixed_change_branches');
  }

  if (findings.some((finding) => finding.startsWith('policy.'))) {
    if (!hasExactOrderedRecoveryProvenance(wallet)) {
      findings.push('descriptor.provenance_unproven');
    }
    const parsed = parseBranches(wallet);
    if (parsed.receive && !parsedPolicyMatchesWallet(wallet, parsed.receive)) {
      findings.push('descriptor.policy_inconsistent');
    }
    findings.push(...descriptorKeyFindings(wallet, parsed.receive));
    return { findings: [...new Set(findings)], ...parsed };
  }

  try {
    const policy = reconstructPolicy(wallet);
    if (!policy) findings.push('descriptor.provenance_unproven');
    else if (!policyMatches(wallet, policy)) findings.push('descriptor.policy_inconsistent');
  } catch {
    findings.push('descriptor.policy_inconsistent');
  }

  const parsed = parseBranches(wallet);
  if (!parsed.receive || !parsed.change) findings.push('descriptor.policy_inconsistent');
  else if (!parsedPolicyMatchesWallet(wallet, parsed.receive)) {
    findings.push('descriptor.policy_inconsistent');
  }
  findings.push(...descriptorKeyFindings(wallet, parsed.receive));
  return { findings: [...new Set(findings)], ...parsed };
}
