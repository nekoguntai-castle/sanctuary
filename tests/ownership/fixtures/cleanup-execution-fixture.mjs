// Shared signed-cleanup fixtures for the cleanup execution and terminal-state
// suites: one compose_network ownership row shape, its inventory, and a
// planned, dry-run-receipted and approved cleanup over chosen rows.
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from '../../../scripts/ownership/canonical-json.mjs';
import { buildCleanupApproval } from '../../../scripts/ownership/cleanup-approval.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from '../../../scripts/ownership/cleanup-planner.mjs';
import { publicKeyFingerprint } from '../../../scripts/ownership/crypto.mjs';

export const HASH = 'a'.repeat(64);
export const ID = 'b'.repeat(64);
export const AUTH_SIGNER = 'c'.repeat(64);

export function keys(directory) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPath = path.join(directory, 'private.pem');
  const publicKeyPath = path.join(directory, 'public.pem');
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKey, publicKey, privateKeyPath, publicKeyPath, signerKeyId: publicKeyFingerprint(publicKey) };
}

export function ownership(identity = ID) {
  return {
    project: 'fixture', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass: 'compose_network', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'unreleased',
    createdByCommit: 'd'.repeat(40), creationRunId: 'create-1', immutableIdentity: identity,
  };
}

export function row(identity = ID) {
  const authority = ownership(identity);
  return {
    resourceClass: 'compose_network', locatorKind: 'engine_id', locator: identity,
    immutableIdentity: identity, ownership: authority, ownershipDigest: canonicalSha256(authority),
    observationDigest: HASH, disposition: 'eligible', failureClasses: [], references: [],
    contentDigests: [], dependencyIdentities: [], active: false, protected: false, data: false,
    running: null,
  };
}

export function inventory(resources, observedAt) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 1, observedAt, complete: true,
    policyDigest: HASH, deploymentManifestDigest: HASH, runManifestDigest: HASH,
    contextFingerprint: HASH, resources, ambiguities: [],
  };
}

export const contract = {
  resourceClasses: [{ classId: 'compose_network', dependsOn: [], cleanupPolicies: ['exact_delete'] }],
};

// Private checkout and runtime directories, a signer, and an approved plan
// that removes `resources`.
export function fixture(nonce, resources = [row()]) {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), `cleanup-${nonce}-checkout-`));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), `cleanup-${nonce}-runtime-`));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const inventoryBefore = inventory(resources, '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(inventoryBefore, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(inventoryBefore, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce, expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  return { checkoutRoot, runtimeDirectory, signer, inventoryBefore, plan, dryRunReceipt, approval };
}
