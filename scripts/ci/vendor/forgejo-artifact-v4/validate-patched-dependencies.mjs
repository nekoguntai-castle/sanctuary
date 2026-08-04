#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, actionKind] = process.argv.slice(2);
if (!sourceRoot || !['upload', 'download'].includes(actionKind)) {
  throw new Error(
    'usage: validate-patched-dependencies.mjs <source-root> <upload|download>',
  );
}

const requireFromAction = createRequire(pathToFileURL(path.join(sourceRoot, 'package.json')));
const fetch = requireFromAction('node-fetch');
const tr46 = requireFromAction('tr46');
const whatwgUrl = requireFromAction('whatwg-url');
const unzip = requireFromAction('unzip-stream');
const binary = requireFromAction('binary');
const Buffers = requireFromAction('buffers');
const artifactConfig = requireFromAction('@actions/artifact/lib/internal/shared/config');

const originalServerUrl = process.env.GITHUB_SERVER_URL;
process.env.GITHUB_SERVER_URL = 'https://forgejo.example.invalid';
try {
  assert.equal(artifactConfig.isGhes(), false);
} finally {
  if (originalServerUrl === undefined) {
    delete process.env.GITHUB_SERVER_URL;
  } else {
    process.env.GITHUB_SERVER_URL = originalServerUrl;
  }
}

async function validateHiddenFileBehavior() {
  const glob = requireFromAction('@actions/glob');
  const fixtureRoot = path.join(
    os.tmpdir(),
    'sanctuary-artifact-hidden-files-v1',
  );

  const visibleFile = path.join(fixtureRoot, 'visible.txt');
  const explicitHiddenFile = path.join(fixtureRoot, '.explicit-hidden.txt');
  const nestedVisibleFile = path.join(fixtureRoot, 'nested', 'visible.txt');
  const nestedHiddenFile = path.join(fixtureRoot, 'nested', '.hidden-file.txt');
  const hiddenDirectoryFile = path.join(
    fixtureRoot,
    'nested',
    '.hidden-directory',
    'secret.txt',
  );

  await mkdir(path.dirname(hiddenDirectoryFile), { recursive: true });
  await Promise.all(
    [
      visibleFile,
      explicitHiddenFile,
      nestedVisibleFile,
      nestedHiddenFile,
      hiddenDirectoryFile,
    ].map((filePath) => writeFile(filePath, path.basename(filePath))),
  );

  async function findFiles(searchPath, includeHiddenFiles) {
    const globber = await glob.create(searchPath, {
      followSymbolicLinks: true,
      implicitDescendants: true,
      omitBrokenSymbolicLinks: true,
      excludeHiddenFiles: !includeHiddenFiles,
    });
    const matches = await globber.glob();
    const files = [];
    for (const match of matches) {
      if ((await stat(match)).isFile()) {
        files.push(path.relative(fixtureRoot, match));
      }
    }
    return files.sort();
  }

  assert.deepEqual(await findFiles(fixtureRoot, false), [
    path.join('nested', 'visible.txt'),
    'visible.txt',
  ]);
  assert.deepEqual(await findFiles(fixtureRoot, true), [
    '.explicit-hidden.txt',
    path.join('nested', '.hidden-directory', 'secret.txt'),
    path.join('nested', '.hidden-file.txt'),
    path.join('nested', 'visible.txt'),
    'visible.txt',
  ]);
  assert.deepEqual(await findFiles(explicitHiddenFile, false), []);
  assert.deepEqual(await findFiles(explicitHiddenFile, true), [
    '.explicit-hidden.txt',
  ]);
}

assert.equal(tr46.toASCII('mañana.example'), 'xn--maana-pta.example');
assert.equal(new whatwgUrl.URL('https://mañana.example/a b').hostname, 'xn--maana-pta.example');

const parsed = binary.parse(Buffer.from([3, 65, 66, 67])).word8('size').buffer('body', 3).vars;
assert.equal(parsed.size, 3);
assert.equal(parsed.body.toString(), 'ABC');

const buffers = new Buffers([Buffer.from('ab'), Buffer.from('cd')]);
assert.equal(buffers.slice(1, 3).toString(), 'bc');
assert.equal(buffers.indexOf('cd'), 2);

if (actionKind === 'upload') {
  await validateHiddenFileBehavior();
}

// Instantiation reaches the allocation paths that emitted DEP0005 during a
// real artifact extraction. NODE_OPTIONS=--throw-deprecation makes regressions
// fail this process before the network validation begins.
const parser = unzip.Parse();
parser.on('error', () => {});
parser.end(Buffer.alloc(0));

const requests = [];
const server = http.createServer((request, response) => {
  requests.push({
    authorization: request.headers.authorization ?? '',
    host: request.headers.host ?? '',
    url: request.url ?? '',
  });
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: '/final?from=redirect' });
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('ok');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const queryResponse = await fetch(`${base}/space%20path?empty=&value=a%20b`);
  assert.equal(await queryResponse.text(), 'ok');

  const redirectResponse = await fetch(`${base}/redirect`);
  assert.equal(await redirectResponse.text(), 'ok');

  const authResponse = await fetch(
    `http://user%20name:p%40ss@127.0.0.1:${address.port}/auth`,
  );
  assert.equal(await authResponse.text(), 'ok');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

assert.deepEqual(
  requests.map(({ url }) => url),
  ['/space%20path?empty=&value=a%20b', '/redirect', '/final?from=redirect', '/auth'],
);
assert.equal(requests[3].authorization, `Basic ${Buffer.from('user name:p@ss').toString('base64')}`);

console.log('patched dependency behavior validated without Node deprecations');
