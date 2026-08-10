import { inspectAddressEvidence } from './addressEvidence';
import { inspectDescriptorEvidence } from './descriptorEvidence';
import { inspectSignerEvidence } from './signerEvidence';
import {
  WALLET_SAFETY_AUDIT_SCHEMA_VERSION,
  walletSafetyAuditReportSchema,
  type RawAuditAddress,
  type RawAuditSigner,
  type RawAuditWallet,
  type WalletAuditClassification,
  type WalletAuditFindingId,
  type WalletSafetyAuditReport,
  type WalletSafetyRawSnapshot,
} from './schema';

const UNSUPPORTED_FINDINGS = new Set<WalletAuditFindingId>([
  'policy.ordered_multisig_unsupported',
  'policy.legacy_multisig_unsupported',
  'policy.taproot_multisig_unsupported',
]);

function classificationFor(findings: readonly WalletAuditFindingId[]): WalletAuditClassification {
  if (findings.length === 0) return 'proven_safe';
  return findings.every((finding) => UNSUPPORTED_FINDINGS.has(finding))
    ? 'unsupported_but_recoverable'
    : 'manual_investigation';
}

function byWalletId<T extends { walletId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.walletId) ?? [];
    existing.push(row);
    grouped.set(row.walletId, existing);
  }
  return grouped;
}

function inspectWallet(
  wallet: RawAuditWallet,
  addresses: RawAuditAddress[],
  signers: RawAuditSigner[],
) {
  const sortedAddresses = [...addresses].sort((left, right) =>
    left.index - right.index
    || left.derivationPath.localeCompare(right.derivationPath)
    || left.id.localeCompare(right.id),
  );
  const sortedSigners = [...signers].sort((left, right) =>
    (left.signerIndex ?? Number.MAX_SAFE_INTEGER) - (right.signerIndex ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id),
  );
  const descriptor = inspectDescriptorEvidence(wallet);
  const findingIds = new Set<WalletAuditFindingId>(descriptor.findings);
  for (const finding of inspectAddressEvidence(wallet, sortedAddresses, descriptor.receive, descriptor.change)) {
    findingIds.add(finding);
  }
  for (const finding of inspectSignerEvidence(wallet, sortedSigners, descriptor.receive)) {
    findingIds.add(finding);
  }
  const findings = [...findingIds].sort().map((id) => ({ id }));
  return {
    walletId: wallet.id,
    classification: classificationFor(findings.map((finding) => finding.id)),
    findings,
    evidence: { wallet, addresses: sortedAddresses, signers: sortedSigners },
  };
}

function reportSummary(wallets: ReturnType<typeof inspectWallet>[]) {
  return {
    provenSafe: wallets.filter((wallet) => wallet.classification === 'proven_safe').length,
    unsupportedButRecoverable: wallets.filter(
      (wallet) => wallet.classification === 'unsupported_but_recoverable',
    ).length,
    manualInvestigation: wallets.filter(
      (wallet) => wallet.classification === 'manual_investigation',
    ).length,
    findingCount: wallets.reduce((count, wallet) => count + wallet.findings.length, 0),
  };
}

export function buildWalletSafetyAuditReport(
  snapshot: WalletSafetyRawSnapshot,
  generatedAt: Date = new Date(),
): WalletSafetyAuditReport {
  const addresses = byWalletId(snapshot.addresses);
  const signers = byWalletId(snapshot.signers);
  const wallets = [...snapshot.wallets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((wallet) => inspectWallet(
      wallet,
      addresses.get(wallet.id) ?? [],
      signers.get(wallet.id) ?? [],
    ));

  return walletSafetyAuditReportSchema.parse({
    schemaVersion: WALLET_SAFETY_AUDIT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    snapshot: {
      databaseIsolation: 'repeatable_read',
      databaseAccess: 'read_only',
      walletCount: snapshot.wallets.length,
      addressCount: snapshot.addresses.length,
      signerCount: snapshot.signers.length,
    },
    summary: reportSummary(wallets),
    wallets,
  });
}

export function reportHasFindings(report: WalletSafetyAuditReport): boolean {
  return report.summary.findingCount > 0;
}
