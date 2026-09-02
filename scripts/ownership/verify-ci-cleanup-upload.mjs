#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignedArtifact } from './cleanup-evidence.mjs';
import { verifyCleanupTrust } from './cleanup-trust.mjs';
import { publicKeyFingerprint } from './crypto.mjs';
import { readCoordinatorState } from './ci-cleanup-state.mjs';
import { assertCiCleanupAuthority } from './ci-cleanup-authority.mjs';
import { ciCleanupProviderContext } from './ci-cleanup-trust.mjs';
import { assertUploadSafe } from './privacy.mjs';

const MAX_STATE_FILES = 512;

function coordinatorStates(root) {
  const pending = [path.resolve(root)];
  const states = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === 'coordinator-state.json') {
        states.push(candidate);
        if (states.length > MAX_STATE_FILES) throw new Error('too many cleanup coordinator states');
      }
    }
  }
  return states;
}

function providerMatches(authority, live) {
  return ['provider', 'runId', 'runAttempt', 'identityDigest']
    .every((key) => authority[key] === live[key]);
}

function trustedFingerprint({ runtimeRoot, checkoutRoot, publicKeyPath }) {
  const fingerprint = publicKeyFingerprint(readFileSync(publicKeyPath));
  const live = ciCleanupProviderContext();
  const matches = [];
  for (const statePath of coordinatorStates(runtimeRoot)) {
    let current;
    try { current = readCoordinatorState(statePath, { checkoutRoot }); } catch { continue; }
    const state = current.state;
    if (state.phase !== 'projected' || state.evidenceFingerprint !== fingerprint
        || !providerMatches(state.authority, live)) continue;
    const runtimeDirectory = path.dirname(statePath);
    const prebind = state.authority.authorityMode === 'deployment_managed_by_subject'
      && state.deploymentManifestDigest === null && state.runManifestDigest === null
      && state.subjectExitStatus !== null && state.planningReceiptPath !== null;
    if (prebind) assertCiCleanupAuthority(state, checkoutRoot);
    else {
      verifyCleanupTrust({
        runtimeDirectory, checkoutRoot, deploymentId: state.authority.deploymentId,
        authorizationFingerprint: state.authorizationFingerprint,
        evidenceFingerprint: fingerprint,
        expectedAuthorityIdentityDigest: live.identityDigest,
        operationRunId: state.authority.operationRunId,
        deploymentManifestDigest: state.deploymentManifestDigest,
      });
    }
    matches.push(fingerprint);
  }
  if (matches.length !== 1) {
    throw new Error(`cleanup evidence key must match exactly one provider-bound coordinator state (found ${matches.length})`);
  }
  return fingerprint;
}

export function verifyCiCleanupUpload({ artifactRoot, runtimeRoot, checkoutRoot }) {
  const root = path.resolve(artifactRoot);
  const publicKeyPath = path.join(root, 'evidence-public.pem');
  const expectedFingerprint = trustedFingerprint({ runtimeRoot, checkoutRoot, publicKeyPath });
  for (const name of ['planning-upload', 'final-upload']) {
    const verified = verifySignedArtifact({
      inputPath: path.join(root, `${name}.json`),
      signaturePath: path.join(root, `${name}.json.sig`),
      checksumPath: path.join(root, `${name}.sha256`),
      publicKeyPath, expectedFingerprint, checkoutRoot,
    });
    assertUploadSafe(verified.artifact);
  }
  return expectedFingerprint;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--artifact-root', '--runtime-root', '--checkout-root'].includes(key) || !value) {
      throw new Error('usage: verify-ci-cleanup-upload.mjs --artifact-root DIR --runtime-root DIR --checkout-root DIR');
    }
    values[key.slice(2)] = value;
  }
  return {
    artifactRoot: values['artifact-root'], runtimeRoot: values['runtime-root'],
    checkoutRoot: values['checkout-root'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyCiCleanupUpload(parseArgs(process.argv.slice(2))); } catch (error) {
    process.stderr.write(`verify-ci-cleanup-upload: ${error.message}\n`);
    process.exitCode = 1;
  }
}
