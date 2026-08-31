import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  composeArguments, diagnoseLegacyDeployment, resolveDeploymentDefinition, resolveDeploymentEnvFile,
} from '../../scripts/ownership/deployment-definition.mjs';
import { assertSecretFreeOverlay } from '../../scripts/ownership/overlay-policy.mjs';

const HASH = 'a'.repeat(64);
const checkoutRoot = path.resolve(import.meta.dirname, '../..');

function projectFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-definition-'));
  mkdirSync(path.join(root, 'docker/compose'), { recursive: true });
  const definitions = {
    'docker-compose.yml': 'services:\n  app:\n    environment:\n      JWT_SECRET: ${JWT_SECRET:?required}\n',
    'docker/compose/offline-core.yml': 'services:\n  app:\n    image: sanctuary:offline\n',
    'docker/compose/monitoring.yml': 'services:\n  metrics:\n    image: metrics:test\n',
    'docker/compose/offline-monitoring.yml': 'services:\n  metrics:\n    pull_policy: never\n',
    'docker/compose/tor.yml': 'services:\n  tor:\n    image: tor:test\n',
    'docker/compose/offline-tor.yml': 'services:\n  tor:\n    pull_policy: never\n',
  };
  for (const [relative, contents] of Object.entries(definitions)) writeFileSync(path.join(root, relative), contents);
  const runtimeDirectory = path.join(root, 'runtime');
  mkdirSync(runtimeDirectory);
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=never-persist-this-value\n');
  return { root, runtimeDirectory };
}

function options(fixture, extra = {}) {
  return {
    projectDirectory: fixture.root, runtimeDirectory: fixture.runtimeDirectory,
    ownerId: 'operator-1', release: 'v1.2.3', commit: 'b'.repeat(40),
    policyDigest: HASH, contextFingerprint: 'c'.repeat(64), ...extra,
  };
}

test('env resolution has one strict precedence and refuses a missing explicit path', () => {
  const fixture = projectFixture();
  const external = path.join(fixture.runtimeDirectory, 'sanctuary.env');
  writeFileSync(path.join(fixture.root, '.env'), 'A=legacy\n');
  writeFileSync(path.join(fixture.root, '.env.local'), 'A=local\n');
  assert.equal(resolveDeploymentEnvFile(fixture.root, { runtimeDirectory: fixture.runtimeDirectory }), external);
  assert.throws(() => resolveDeploymentEnvFile(fixture.root, { envFile: path.join(fixture.root, 'missing') }), /explicit environment file does not exist/);
});

test('resolver preserves the complete overlay order, profile, paths, hashes, and argv', () => {
  const fixture = projectFixture();
  const bundle = resolveDeploymentDefinition(options(fixture, {
    installMode: 'offline', monitoring: true, tor: true, mcp: true, composeProjectName: 'custom-project',
  }));
  assert.deepEqual(bundle.definition.overlays.map((entry) => path.relative(fixture.root, entry.sourcePath)), [
    'docker-compose.yml', 'docker/compose/offline-core.yml', 'docker/compose/monitoring.yml',
    'docker/compose/offline-monitoring.yml', 'docker/compose/tor.yml', 'docker/compose/offline-tor.yml',
  ]);
  assert.deepEqual(bundle.definition.profiles, ['mcp']);
  assert.equal(bundle.definition.composeProjectName, 'custom-project');
  assert.equal(bundle.snapshots.length, 6);
  const args = composeArguments(bundle.definition);
  assert.deepEqual(args.slice(0, 6), ['--project-directory', fixture.root, '--env-file', path.join(fixture.runtimeDirectory, 'sanctuary.env'), '-p', 'custom-project']);
  assert.equal(args.filter((entry) => entry === '-f').length, 6);
  assert.deepEqual(args.slice(-2), ['--profile', 'mcp']);
});

test('current tracked full-stack definitions pass the dependency-light raw policy', () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-definition-real-'));
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=private\n');
  const bundle = resolveDeploymentDefinition(options({ root: checkoutRoot, runtimeDirectory }, {
    installMode: 'offline', monitoring: true, tor: true, mcp: true,
  }));
  assert.equal(bundle.definition.overlays.length, 6);
});

test('definition digest covers raw overlay bytes but excludes env contents', () => {
  const fixture = projectFixture();
  const first = resolveDeploymentDefinition(options(fixture));
  writeFileSync(path.join(fixture.runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=a-different-secret\n');
  const second = resolveDeploymentDefinition(options(fixture));
  assert.equal(first.definition.definitionDigest, second.definition.definitionDigest);
  assert.ok(!JSON.stringify(first.definition).includes('never-persist-this-value'));
  writeFileSync(path.join(fixture.root, 'docker-compose.yml'), 'services:\n  changed:\n    image: changed:test\n');
  const third = resolveDeploymentDefinition(options(fixture));
  assert.notEqual(first.definition.definitionDigest, third.definition.definitionDigest);
});

test('generated overlays have deterministic virtual identity and are snapshotted last', () => {
  const fixture = projectFixture();
  const generated = { name: 'legacy-durable-resources', bytes: Buffer.from('volumes:\n  data: !override\n    external: true\n') };
  const first = resolveDeploymentDefinition(options(fixture, { generatedOverlays: [generated] }));
  const second = resolveDeploymentDefinition(options(fixture, { generatedOverlays: [generated] }));
  const overlay = first.definition.overlays.at(-1);
  assert.equal(overlay.kind, 'generated');
  assert.match(overlay.sourcePath, /^generated\/legacy-durable-resources-[a-f0-9]{64}\.yml$/);
  assert.match(overlay.sourceIdentity, /^generated:[a-f0-9]{64}$/);
  assert.deepEqual(first.definition, second.definition);
  assert.deepEqual(first.snapshots.at(-1).bytes, generated.bytes);
  assert.throws(() => resolveDeploymentDefinition(options(fixture, {
    generatedOverlays: [{ name: 'unsafe', bytes: Buffer.from('API_TOKEN: literal\n') }],
  })), /literal secret/);
});

test('custom overlays are opt-in, raw-scanned, and reject secret/config bypasses', () => {
  const fixture = projectFixture();
  const custom = path.join(fixture.root, 'custom.yml');
  writeFileSync(custom, 'services:\n  app:\n    environment:\n      API_TOKEN: literal-value\n');
  assert.throws(() => resolveDeploymentDefinition(options(fixture, { customOverlays: [custom] })), /literal secret/);
  writeFileSync(custom, 'services:\n  app:\n    environment:\n      API_TOKEN: ${API_TOKEN:?required}\n');
  const bundle = resolveDeploymentDefinition(options(fixture, { customOverlays: [custom] }));
  assert.equal(bundle.definition.overlays.at(-1).kind, 'custom');
  writeFileSync(custom, 'services:\n  app:\n    env_file: private.env\n');
  assert.throws(() => resolveDeploymentDefinition(options(fixture, { customOverlays: [custom] })), /external secret\/config locator/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('url: https://user:pass@example.test\n')), /literal URL credentials/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('environment:\n  - API_TOKEN=literal\n'), { custom: true }), /literal secret/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('environment:\n  - "API_TOKEN=literal"\n'), { custom: true }), /literal secret/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('environment: {API_TOKEN: literal}\n'), { custom: true }), /flow collection/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('environment: ["API_TOKEN=literal"]\n'), { custom: true }), /flow collection/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('environment:\n  "API_TOKEN": literal\n'), { custom: true }), /literal secret/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from("environment:\n  'API_TOKEN': literal\n"), { custom: true }), /literal secret/);
  assert.doesNotThrow(() => assertSecretFreeOverlay(Buffer.from('environment: {API_TOKEN: literal}\n')));
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('API_TOKEN: ${API_TOKEN:-literal}\n'), { custom: true }), /literal secret/);
  assert.throws(() => assertSecretFreeOverlay(Buffer.from('PRIVATE_KEY_PATH: ./key.pem\n'), { custom: true }), /sensitive file locator/);
  const target = path.join(fixture.root, 'target.yml');
  const link = path.join(fixture.root, 'linked.yml');
  writeFileSync(target, 'services: {}\n');
  symlinkSync(target, link);
  assert.throws(() => resolveDeploymentDefinition(options(fixture, { customOverlays: [link] })), /non-symlink/);
});

test('compose arguments refuse environment path replacement without hashing its contents', () => {
  const fixture = projectFixture();
  const bundle = resolveDeploymentDefinition(options(fixture));
  const envFile = path.join(fixture.runtimeDirectory, 'sanctuary.env');
  renameSync(envFile, `${envFile}.old`);
  writeFileSync(envFile, 'JWT_SECRET=replacement\n');
  assert.throws(() => composeArguments(bundle.definition), /environment file identity changed/);
});

test('legacy diagnostics are read-only and never infer adoption', () => {
  const fixture = projectFixture();
  const result = diagnoseLegacyDeployment(fixture.root, options(fixture));
  assert.equal(result.state, 'legacy-unregistered');
  assert.equal(result.adoptable, false);
});
