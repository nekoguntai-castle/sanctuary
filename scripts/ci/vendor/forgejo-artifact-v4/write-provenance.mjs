#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [outputRoot] = process.argv.slice(2);
if (!outputRoot) {
  throw new Error('usage: write-provenance.mjs <output-root>');
}

const upstream = {
  upload: {
    repository: 'https://data.forgejo.org/forgejo/upload-artifact',
    commit: '16871d9e8cfcf27ff31822cac382bbb5450f1e1e',
    archiveSha256: '6383687c4832a4f77bb28dea05b3b0d8fc636b3d572416fad630d436cf125df1',
    artifactPackageVersion: '2.1.1',
  },
  download: {
    repository: 'https://data.forgejo.org/forgejo/download-artifact',
    commit: 'd8d0a99033603453ad2255e58720b460a0555e1e',
    archiveSha256: '85011bcbcd2bfac17da6c593a40600ee7e66fce6b69264e7f392ad7319779f02',
    artifactPackageVersion: '2.1.4',
  },
};

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

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const files = Object.fromEntries(
  listFiles(outputRoot)
    .filter((relativePath) => relativePath !== 'provenance.json')
    .map((relativePath) => [relativePath, sha256(path.join(outputRoot, relativePath))]),
);

const provenance = {
  schemaVersion: 1,
  runtime: 'node24',
  protocol: 'Forgejo patched artifact v4',
  forgejoCompatibilityBoundary:
    'disable upstream GHES rejection and use the Forgejo-provided results service',
  protocolDependencies: {
    '@azure/storage-blob': '12.17.0',
    'node-fetch': {
      upload: '2.7.0',
      download: '2.6.12',
    },
    'unzip-stream': '0.3.1',
    punycode: {
      upload: '2.1.1',
      download: '2.3.1',
    },
    '@vercel/ncc': {
      upload: '0.36.0',
      download: '0.33.4',
    },
  },
  upstream,
  files,
};

writeFileSync(
  path.join(outputRoot, 'provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
