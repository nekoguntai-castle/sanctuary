const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertLockedResolutions } = require('../../server/scripts/project-runtime-dependencies.cjs');
const {
  checkRuntimePrismaClient,
  checkRuntimePrismaDependencies,
} = require('../../server/scripts/check-runtime-prisma-deps.cjs');

test('runtime projection preserves reviewed resolutions even when npm hoists them', () => {
  const record = { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity: 'sha512-reviewed' };
  const source = { packages: { 'server/node_modules/pkg': record } };
  assert.doesNotThrow(() => assertLockedResolutions(source, { packages: { 'node_modules/pkg': record } }));
  for (const change of [{ version: '2.0.0' }, { integrity: 'sha512-unreviewed' }, { resolved: 'https://other.example/pkg.tgz' }]) {
    assert.throws(() => assertLockedResolutions(source, { packages: { 'node_modules/pkg': { ...record, ...change } } }), /not in the reviewed lockfile/);
  }
  assert.throws(() => assertLockedResolutions(source, { packages: { 'node_modules/other': record } }), /not in the reviewed lockfile/);
});

test('image check rejects nested and scoped CLI dependencies but permits Prisma runtime', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-prisma-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, '@prisma/client');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: '@prisma/client' }));
  assert.doesNotThrow(() => checkRuntimePrismaDependencies(root));
  const nested = path.join(runtime, 'node_modules/hidden');
  fs.mkdirSync(nested, { recursive: true });
  for (const name of ['prisma', '@prisma/config', '@prisma/dev', 'effect', '@electric-sql/pglite']) {
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name }));
    assert.throws(() => checkRuntimePrismaDependencies(root), /Migration-only dependency/);
  }
});

test('runtime image loads the generated Prisma client through Node native CommonJS resolution', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-prisma-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'internal'), { recursive: true });
  fs.writeFileSync(path.join(root, 'internal/class.js'), 'module.exports = { PrismaClient: class PrismaClient {} };\n');
  const client = path.join(root, 'client.js');
  fs.writeFileSync(client, 'const { PrismaClient } = require("./internal/class.js"); module.exports = { PrismaClient };\n');

  assert.doesNotThrow(() => checkRuntimePrismaClient(client));

  const hybrid = path.join(root, 'hybrid.js');
  fs.writeFileSync(hybrid, 'module.exports = {}; void import.meta.url;\n');
  assert.throws(() => checkRuntimePrismaClient(hybrid), /cannot be loaded/);

  const schema = fs.readFileSync(path.join(__dirname, '../../server/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /moduleFormat\s*=\s*"cjs"/);
});
