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
import { parseStrictJson } from './canonical-json.mjs';

const MAX_STATE_FILES = 512;
const MAX_ARTIFACT_DIRECTORIES = 512;
const MAX_ARTIFACT_DEPTH = 8;
const RECEIPT_FILES = Object.freeze([
  'authorization-public.pem',
  'evidence-public.pem',
  'final-upload.json',
  'final-upload.json.sig',
  'final-upload.sha256',
  'planning-upload.json',
  'planning-upload.json.sig',
  'planning-upload.sha256',
]);

function directoryEntries(directory) {
  return readdirSync(directory).sort().map((name) => {
    const candidate = path.join(directory, name);
    const info = lstatSync(candidate);
    if (info.isSymbolicLink()) throw new Error(`cleanup evidence contains a symlink: ${candidate}`);
    if (info.isDirectory()) return { candidate, kind: 'directory', name };
    if (info.isFile()) return { candidate, kind: 'file', name };
    throw new Error(`cleanup evidence contains an unsupported entry: ${candidate}`);
  });
}

function assertReceiptLeaf(directory, entries) {
  const actual = entries.map(({ name }) => name);
  if (actual.length !== RECEIPT_FILES.length
      || actual.some((name, index) => name !== RECEIPT_FILES[index])) {
    throw new Error(`cleanup evidence leaf has an incomplete or unexpected receipt bundle: ${directory}`);
  }
  for (const { candidate } of entries) {
    if (lstatSync(candidate).size === 0) {
      throw new Error(`cleanup evidence receipt file is empty: ${candidate}`);
    }
  }
}

export function cleanupArtifactRoots(root, mode = 'single') {
  if (!['single', 'children', 'recursive'].includes(mode)) {
    throw new Error('artifact mode must be single, children, or recursive');
  }
  const resolved = path.resolve(root);
  const rootInfo = lstatSync(resolved);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`cleanup evidence root must be a real directory: ${resolved}`);
  }
  const receipts = [];
  const visit = (directory, depth, leafRequired) => {
    if (depth > MAX_ARTIFACT_DEPTH) throw new Error('cleanup evidence tree exceeds the depth limit');
    const entries = directoryEntries(directory);
    if (entries.length === 0) throw new Error(`cleanup evidence directory is empty: ${directory}`);
    const directories = entries.filter(({ kind }) => kind === 'directory');
    const files = entries.filter(({ kind }) => kind === 'file');
    if (directories.length > 0 && files.length > 0) {
      throw new Error(`cleanup evidence directory mixes receipt files and child directories: ${directory}`);
    }
    if (directories.length === 0) {
      assertReceiptLeaf(directory, files);
      receipts.push(directory);
      if (receipts.length > MAX_ARTIFACT_DIRECTORIES) {
        throw new Error('cleanup evidence tree exceeds the receipt limit');
      }
      return;
    }
    if (leafRequired) throw new Error(`cleanup evidence expected an immediate receipt leaf: ${directory}`);
    for (const { candidate } of directories) visit(candidate, depth + 1, false);
  };
  if (mode === 'single') visit(resolved, 0, true);
  else if (mode === 'children') {
    const entries = directoryEntries(resolved);
    if (entries.length === 0 || entries.some(({ kind }) => kind !== 'directory')) {
      throw new Error(`cleanup evidence children root must contain only directories: ${resolved}`);
    }
    for (const { candidate } of entries) visit(candidate, 1, true);
  } else visit(resolved, 0, false);
  return Object.freeze(receipts);
}

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

export function verifyCiCleanupUploads({
  artifactRoot, artifactMode = 'single', runtimeRoot, checkoutRoot, requireCleanupSuccess = false,
}) {
  const roots = cleanupArtifactRoots(artifactRoot, artifactMode);
  for (const root of roots) {
    verifyCiCleanupUpload({ artifactRoot: root, runtimeRoot, checkoutRoot });
    if (requireCleanupSuccess) {
      const receipt = parseStrictJson(readFileSync(path.join(root, 'final-upload.json')));
      if (!['cleaned', 'no_op', 'recovered'].includes(receipt.state)) {
        throw new Error(`cleanup evidence final state is not successful: ${root}`);
      }
    }
  }
  return roots;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--artifact-root', '--artifact-mode', '--runtime-root', '--checkout-root', '--require-cleanup-success'].includes(key) || !value) {
      throw new Error('usage: verify-ci-cleanup-upload.mjs --artifact-root DIR --artifact-mode single|children|recursive --runtime-root DIR --checkout-root DIR --require-cleanup-success true|false');
    }
    values[key.slice(2)] = value;
  }
  if (values['require-cleanup-success'] !== undefined
      && !['true', 'false'].includes(values['require-cleanup-success'])) {
    throw new Error('require-cleanup-success must be true or false');
  }
  return {
    artifactRoot: values['artifact-root'], artifactMode: values['artifact-mode'] ?? 'single',
    runtimeRoot: values['runtime-root'], checkoutRoot: values['checkout-root'],
    requireCleanupSuccess: values['require-cleanup-success'] === 'true',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyCiCleanupUploads(parseArgs(process.argv.slice(2))); } catch (error) {
    process.stderr.write(`verify-ci-cleanup-upload: ${error.message}\n`);
    process.exitCode = 1;
  }
}
