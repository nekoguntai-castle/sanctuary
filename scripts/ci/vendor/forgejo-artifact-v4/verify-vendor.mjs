#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [vendorRoot] = process.argv.slice(2);
if (!vendorRoot) {
  throw new Error('usage: verify-vendor.mjs <vendor-root>');
}

const provenance = JSON.parse(readFileSync(path.join(vendorRoot, 'provenance.json'), 'utf8'));
assert.equal(provenance.schemaVersion, 1);
assert.equal(provenance.runtime, 'node24');

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

for (const [relativePath, expectedHash] of Object.entries(provenance.files)) {
  assert.equal(sha256(path.join(vendorRoot, relativePath)), expectedHash, relativePath);
}

function listFiles(directory, prefix = '') {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const absolutePath = path.join(directory, name);
      const relativePath = path.posix.join(prefix, name);
      return statSync(absolutePath).isDirectory()
        ? listFiles(absolutePath, relativePath)
        : [relativePath];
    });
}

assert.deepEqual(
  listFiles(vendorRoot).filter((relativePath) => relativePath !== 'provenance.json'),
  Object.keys(provenance.files),
  'vendored file inventory must exactly match provenance',
);

for (const actionKind of ['upload', 'download']) {
  const actionRoot = path.join(vendorRoot, actionKind);
  const manifest = readFileSync(path.join(actionRoot, 'action.yml'), 'utf8');
  assert.match(manifest, /using: ['"]node24['"]/);
  assert.doesNotMatch(manifest, /using: ['"]node20['"]/);

  const bundlePath = path.join(
    actionRoot,
    actionKind === 'upload' ? 'dist/upload/index.js' : 'dist/index.js',
  );
  const bundle = readFileSync(bundlePath, 'utf8');
  assert.match(bundle, /function isGhes\(\) \{\s+return false;\s+\}/);
  assert.doesNotMatch(bundle, /module\.exports = require\(["']punycode["']\)/);
  assert.doesNotMatch(bundle, /\bUrl\.parse\b|\burl\.parse\s*\(/);

  // The old unzip stack is the only production path that emitted DEP0005.
  // Exclude constructor examples embedded in third-party comments/licenses.
  assert.doesNotMatch(bundle, /\bnew Buffer\((?:''|""|4|search|needle|this\.buffer)\)/);
}

console.log('vendored Forgejo artifact action hashes and runtime roots verified');
