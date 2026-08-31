import { canonicalSha256 } from './canonical-json.mjs';
import { ARTIFACT_SCHEMA_VERSIONS, validateArtifact } from './schemas.mjs';

const MAX_APPROVAL_MS = 24 * 60 * 60 * 1000;

function assertPlanReceipt(plan, receipt) {
  validateArtifact(plan);
  validateArtifact(receipt);
  if (receipt.phase !== 'planning' || receipt.state !== 'dry_run') {
    throw new Error('only a successful planning dry-run can be authorized');
  }
  if (receipt.planDigest !== canonicalSha256(plan)) throw new Error('dry-run receipt does not bind the plan');
  for (const key of [
    'deploymentId', 'operationRunId', 'policyDigest', 'deploymentManifestDigest',
    'runManifestDigest',
  ]) if (receipt[key] !== plan[key]) throw new Error(`dry-run receipt ${key} does not match plan`);
}

export function buildCleanupApproval(plan, dryRunReceipt, {
  signerKeyId,
  nonce,
  expiresAt,
  decommission = false,
  now = () => new Date(),
} = {}) {
  assertPlanReceipt(plan, dryRunReceipt);
  if (typeof nonce !== 'string' || nonce.length === 0) throw new Error('approval nonce is required');
  const issued = now();
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= issued) throw new Error('approval expiration must be in the future');
  if (expires.getTime() - issued.getTime() > MAX_APPROVAL_MS) throw new Error('approval lifetime must not exceed 24 hours');
  const permittedClasses = [...new Set(plan.actions.map((entry) => entry.resourceClass))].sort();
  const approval = {
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.cleanup_approval,
    artifactType: 'cleanup_approval',
    deploymentId: plan.deploymentId,
    operationRunId: plan.operationRunId,
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
    nonce,
    dryRunReceiptDigest: canonicalSha256(dryRunReceipt),
    planDigest: canonicalSha256(plan),
    policyDigest: plan.policyDigest,
    deploymentManifestDigest: plan.deploymentManifestDigest,
    runManifestDigest: plan.runManifestDigest,
    contextFingerprint: plan.contextFingerprint,
    actions: plan.actions,
    permittedClasses,
    permittedActionCount: plan.actions.length,
    decommission,
    signerKeyId,
  };
  validateArtifact(approval);
  return approval;
}

export function verifyCleanupApproval(approval, plan, dryRunReceipt, {
  now = new Date(),
  expectedContextFingerprint,
} = {}) {
  validateArtifact(approval, { now });
  assertPlanReceipt(plan, dryRunReceipt);
  if (new Date(approval.issuedAt) > now) throw new Error('cleanup approval is not yet valid');
  if (new Date(approval.expiresAt) <= now) throw new Error('cleanup approval has expired');
  const expected = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: approval.signerKeyId,
    nonce: approval.nonce,
    expiresAt: approval.expiresAt,
    decommission: approval.decommission,
    now: () => new Date(approval.issuedAt),
  });
  if (canonicalSha256(expected) !== canonicalSha256(approval)) throw new Error('cleanup approval scope does not match the plan');
  if (expectedContextFingerprint !== undefined && approval.contextFingerprint !== expectedContextFingerprint) {
    throw new Error('cleanup approval context fingerprint mismatch');
  }
  return approval;
}
