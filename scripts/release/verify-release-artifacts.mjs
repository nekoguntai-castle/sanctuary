#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyReleaseArtifacts } from './release-artifact-verifier.mjs';

export function parseCliArgs(argv) {
  const options = {
    manifestPath: 'release-manifest.json',
    baseDir: '',
    publicKeyPath: '',
    strictStable: false,
    strictImages: false,
    verifyImageDigests: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      options.manifestPath = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--base-dir') {
      options.baseDir = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--public-key') {
      options.publicKeyPath = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--strict-stable') {
      options.strictStable = true;
    } else if (arg === '--strict-images') {
      options.strictImages = true;
    } else if (arg === '--verify-image-digests') {
      options.verifyImageDigests = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  scripts/release/verify-release-artifacts.sh --manifest release-manifest.json [options]

Options:
  --manifest FILE             Release manifest JSON to verify (default: release-manifest.json)
  --base-dir DIR              Directory containing local release assets (default: manifest directory)
  --public-key FILE           Public key for openssl-rsa-sha256 signatures
  --strict-stable             Enforce stable-release required artifact classes and evidence
  --strict-images             Require frontend/backend amd64+arm64 container evidence
  --verify-image-digests      Compare container digests against published registry metadata
  --help, -h                  Show this help text`);
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const result = verifyReleaseArtifacts(options);
  console.log(`Release artifact verification passed: ${result.artifactsChecked} artifacts, ${result.localFilesChecked} local files, ${result.checksumEntries} checksum entries.`);
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href
  && process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
