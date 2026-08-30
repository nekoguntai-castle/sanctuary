#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyReleaseArtifacts } from './release-artifact-verifier.mjs';
import { collectManifestAssetNames, validateAssetDirectory } from './release-asset-common.mjs';

const RC_TAG_RE = /^v\d+\.\d+\.\d+-rc[1-9]\d*$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;

export function verifyPrestableRehearsal(input) {
  const repo = realpathSync(path.resolve(input.repo));
  const manifestPath = requireExternalFile(repo, input.manifest, 'rehearsal manifest');
  const signaturePath = requireExternalFile(repo, `${manifestPath}.sig`, 'rehearsal manifest signature');
  const publicKeyPath = requireRegularFile(input.publicKey, 'release public key');
  const baseDir = realpathSync(path.dirname(manifestPath));
  if (manifestPath !== path.join(baseDir, 'release-manifest.json')) {
    throw new Error('rehearsal manifest must be named release-manifest.json');
  }
  if (!RC_TAG_RE.test(input.tag ?? '') || !COMMIT_RE.test(input.commit ?? '')) {
    throw new Error('expected rehearsal identity is invalid');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.release?.tag !== input.tag
    || manifest.release?.commit !== input.commit
    || manifest.release?.stability !== 'prerelease') {
    throw new Error('rehearsal manifest is for a different release candidate');
  }
  verifyManifestSignature(manifestPath, signaturePath, publicKeyPath);
  validateAssetDirectory(baseDir, collectManifestAssetNames(manifest));
  const result = verifyReleaseArtifacts({
    manifestPath,
    baseDir,
    publicKeyPath,
    strictComplete: true,
  });
  return { ...result, manifestPath, baseDir };
}

function requireExternalFile(repo, inputPath, label) {
  const candidate = requireRegularFile(inputPath, label);
  const relative = path.relative(repo, candidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the release checkout`);
  }
  return candidate;
}

function requireRegularFile(inputPath, label) {
  if (!path.isAbsolute(inputPath ?? '')) throw new Error(`${label} path must be absolute`);
  const metadata = lstatSync(inputPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return realpathSync(inputPath);
}

function verifyManifestSignature(manifestPath, signaturePath, publicKeyPath) {
  const result = spawnSync('openssl', [
    'dgst', '-sha256', '-verify', publicKeyPath,
    '-signature', signaturePath, manifestPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('rehearsal manifest signature is invalid');
}

function parseArgs(argv) {
  const names = new Map([
    ['--repo', 'repo'], ['--manifest', 'manifest'], ['--public-key', 'publicKey'],
    ['--tag', 'tag'], ['--commit', 'commit'],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = names.get(argv[index]);
    const value = argv[index + 1];
    if (!name || !value || value.startsWith('--') || options[name]) {
      throw new Error('invalid arguments');
    }
    options[name] = value;
  }
  if ([...names.values()].some((name) => !options[name])) throw new Error('invalid arguments');
  return options;
}

function main() {
  try {
    const result = verifyPrestableRehearsal(parseArgs(process.argv.slice(2)));
    process.stdout.write(`Pre-stable signed rehearsal accepted: ${result.artifactsChecked} artifacts.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Pre-stable rehearsal gate failed: ${message}.\n`);
    process.exitCode = 1;
    return;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
