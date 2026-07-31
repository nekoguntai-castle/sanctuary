import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function sha256File(filePath) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, 'r');
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function collectManifestAssetNames(manifest) {
  const names = new Set(['release-manifest.json', 'release-manifest.json.sig']);
  for (const artifact of manifest.artifacts ?? []) {
    addReference(names, artifact.path);
    addReference(names, artifact.signature?.path);
    addReference(names, artifact.sbom?.path);
    addReference(names, artifact.provenance?.path);
    addReference(names, artifact.attestation?.path);
  }
  return names;
}

export function validateAssetDirectory(assetDir, expectedNames) {
  const root = realpathSync(assetDir);
  const actualNames = new Set();
  for (const name of expectedNames) {
    validateAssetName(name);
    const candidate = path.join(root, name);
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`release asset must be a regular, non-symlink file: ${name}`);
    }
    if (realpathSync(candidate) !== candidate) {
      throw new Error(`release asset resolves outside its canonical path: ${name}`);
    }
    actualNames.add(name);
  }
  const unexpected = readdirSync(root).filter((name) => !actualNames.has(name));
  if (unexpected.length > 0) {
    throw new Error(`unlisted files in release asset directory: ${unexpected.join(', ')}`);
  }
  return { root, names: actualNames };
}

export function validateManifestIdentity(manifest, tag, commit) {
  if (manifest.release?.tag !== tag) {
    throw new Error(`manifest tag mismatch: expected ${tag}, got ${manifest.release?.tag ?? '<missing>'}`);
  }
  if (manifest.release?.commit !== commit) {
    throw new Error(`manifest commit mismatch: expected ${commit}, got ${manifest.release?.commit ?? '<missing>'}`);
  }
  const expectedStability = tag.includes('-') ? 'prerelease' : 'stable';
  if (manifest.release?.stability !== expectedStability) {
    throw new Error(`manifest stability mismatch: expected ${expectedStability}`);
  }
}

export function validateAssetName(name) {
  if (typeof name !== 'string' || !SAFE_ASSET_NAME.test(name) || path.basename(name) !== name) {
    throw new Error(`unsafe release asset name: ${name}`);
  }
}

function addReference(names, name) {
  if (name !== undefined) {
    names.add(name);
  }
}
