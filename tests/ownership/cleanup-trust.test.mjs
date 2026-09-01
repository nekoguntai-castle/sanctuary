import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';
import {
  cleanupTrustPath, validateCleanupTrust, verifyCleanupTrust,
} from '../../scripts/ownership/cleanup-trust.mjs';

const AUTH_A = 'a'.repeat(64);
const AUTH_B = 'b'.repeat(64);
const EVIDENCE_A = 'c'.repeat(64);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-trust-'));
  const checkoutRoot = path.join(root, 'checkout');
  const runtimeDirectory = path.join(root, 'runtime');
  const trustPath = cleanupTrustPath(runtimeDirectory, 'deploy-1');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(path.dirname(trustPath), { recursive: true, mode: 0o700 });
  chmodSync(runtimeDirectory, 0o700);
  chmodSync(path.join(runtimeDirectory, 'ownership'), 0o700);
  chmodSync(path.join(runtimeDirectory, 'ownership/deployments'), 0o700);
  return { checkoutRoot, runtimeDirectory, trustPath };
}

function trust(overrides = {}) {
  return {
    trustVersion: 1, deploymentId: 'deploy-1',
    validFrom: '2026-08-01T00:00:00.000Z', validUntil: '2026-09-30T00:00:00.000Z',
    authorizationFingerprints: [AUTH_A], evidenceFingerprints: [EVIDENCE_A],
    ...overrides,
  };
}

test('deployment trust accepts only configured, role-separated fingerprints', () => {
  const state = fixture();
  writeFileSync(state.trustPath, canonicalJson(trust({
    authorizationFingerprints: [AUTH_A, AUTH_B],
  })), { mode: 0o600 });
  const verified = verifyCleanupTrust({
    ...state, deploymentId: 'deploy-1', authorizationFingerprint: AUTH_B,
    evidenceFingerprint: EVIDENCE_A, now: new Date('2026-08-31T00:00:00.000Z'),
  });
  assert.equal(verified.filePath, state.trustPath);

  assert.throws(() => verifyCleanupTrust({
    ...state, deploymentId: 'deploy-1', authorizationFingerprint: 'd'.repeat(64),
    evidenceFingerprint: EVIDENCE_A, now: new Date('2026-08-31T00:00:00.000Z'),
  }), /not accepted/);
});

test('trust rejects shared role keys, unbounded overlap, and invalid validity windows', () => {
  assert.throws(() => validateCleanupTrust(trust({
    evidenceFingerprints: [AUTH_A],
  }), { deploymentId: 'deploy-1', now: new Date('2026-08-31T00:00:00.000Z') }), /must be distinct/);
  assert.throws(() => validateCleanupTrust(trust({
    authorizationFingerprints: [AUTH_A, AUTH_B, 'd'.repeat(64)],
  }), { deploymentId: 'deploy-1', now: new Date('2026-08-31T00:00:00.000Z') }), /rotation overlap/);
  assert.throws(() => validateCleanupTrust(trust(), {
    deploymentId: 'deploy-1', now: new Date('2026-10-01T00:00:00.000Z'),
  }), /not currently valid/);
  assert.throws(() => validateCleanupTrust(trust({ validUntil: '2027-08-01T00:00:00.000Z' }), {
    deploymentId: 'deploy-1', now: new Date('2026-08-31T00:00:00.000Z'),
  }), /exceeds 90 days/);
});

test('trust is fixed outside checkout and rejects permissive or symlink files', () => {
  const state = fixture();
  writeFileSync(state.trustPath, canonicalJson(trust()), { mode: 0o644 });
  const args = {
    ...state, deploymentId: 'deploy-1', authorizationFingerprint: AUTH_A,
    evidenceFingerprint: EVIDENCE_A, now: new Date('2026-08-31T00:00:00.000Z'),
  };
  assert.throws(() => verifyCleanupTrust(args), /owner-only/);
  chmodSync(state.trustPath, 0o600);
  const linkRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-trust-link-'));
  const linkedRuntime = path.join(linkRoot, 'runtime');
  symlinkSync(state.runtimeDirectory, linkedRuntime);
  assert.throws(() => verifyCleanupTrust({ ...args, runtimeDirectory: linkedRuntime }), /symlink|requested path/);
});
