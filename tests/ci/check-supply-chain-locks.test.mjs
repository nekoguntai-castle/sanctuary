import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectSupplyChainLocks } from '../../scripts/ci/check-supply-chain-locks.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const INTEGRITY = `sha512-${Buffer.from('reviewed artifact').toString('base64')}`;

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sanctuary-supply-chain-'));
  write(root, 'config/container-image-lock.json', {
    schemaVersion: 1,
    lockedImages: [{ reference: 'example.invalid/proof:1.0.0', digest: DIGEST, scope: 'wallet-proof' }],
    localImagePrefixes: ['sanctuary-'],
  });
  write(root, 'config/ci-toolchain-lock.json', {
    schemaVersion: 1,
    runnerImage: {
      reference: 'example.invalid/proof:1.0.0', digest: DIGEST,
      parentReference: 'example.invalid/proof:1.0.0', parentDigest: DIGEST,
    },
    runtimes: { node: '24.19.0', npm: '11.19.0', python: '3.10.12', go: '1.25.12' },
    artifacts: {
      nodeLinuxX64: {
        url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz',
        sha256: 'b'.repeat(64),
      },
      npm: {
        url: 'https://registry.npmjs.org/npm/-/npm-11.19.0.tgz',
        sha512: 'c'.repeat(128),
      },
    },
    fundsCriticalPackages: [{
      name: 'bitcoinjs-lib', version: '7.0.1', integrity: INTEGRITY,
      manifests: ['package.json'], lockfiles: ['package-lock.json'],
    }],
  });
  write(root, 'docker/proof/Dockerfile', `FROM example.invalid/proof:1.0.0@${DIGEST}\n`);
  write(root, 'scripts/ci/images/go-runner.Dockerfile', `FROM example.invalid/proof:1.0.0@${DIGEST}\nARG NODE_VERSION=24.19.0\nARG NODE_SHA256=${'b'.repeat(64)}\nARG NPM_VERSION=11.19.0\nARG NPM_SHA512=${'c'.repeat(128)}\nARG GO_VERSION=1.25.12\nENV GOTOOLCHAIN="local"\n`);
  write(root, '.github/actions/setup-node-toolchain/action.yml', 'runs:\n  using: composite\n  steps:\n    - run: bash scripts/ci/bootstrap-node.sh\n');
  write(root, 'scripts/verify-addresses/implementations/go.mod', 'module proof\n\ngo 1.25.0\ntoolchain go1.25.12\n');
  write(root, '.nvmrc', '24.19.0\n');
  for (const workflow of ['architecture.yml', 'test.yml', 'verify-vectors.yml']) {
    write(root, `.github/workflows/${workflow}`, "env:\n  NODE_VERSION: '24.19.0'\n");
  }
  write(root, '.github/workflows/quality.yml', "env:\n  NODE_VERSION: '24.19.0'\n  PYTHON_VERSION: '3.10.12'\n");
  write(root, 'package.json', { dependencies: { 'bitcoinjs-lib': '7.0.1' } });
  write(root, 'package-lock.json', { packages: { 'node_modules/bitcoinjs-lib': { version: '7.0.1', integrity: INTEGRITY } } });
  return root;
}

function withFixture(run) {
  const root = fixture();
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts exact image, toolchain, package, and integrity locks', () => {
  withFixture((root) => assert.deepEqual(inspectSupplyChainLocks(root), []));
});

test('rejects unpinned, unknown, and digest-drifted images', () => {
  withFixture((root) => {
    write(root, 'docker/proof/Dockerfile', 'FROM example.invalid/proof:1.0.0\n');
    assert.match(inspectSupplyChainLocks(root).join('\n'), /not digest-pinned/);
    write(root, 'docker/proof/Dockerfile', `FROM example.invalid/proof:1.0.0@sha256:${'b'.repeat(64)}\nFROM unknown.invalid/image:2@${DIGEST}\n`);
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /image digest drift/);
    assert.match(errors, /absent from the lock/);
  });
});

test('permits only locked tag aliases in exact offline runtime overlays', () => {
  withFixture((root) => {
    write(root, 'docker/compose/offline-core.yml', 'services:\n  proof:\n    image: example.invalid/proof:1.0.0\n');
    assert.deepEqual(inspectSupplyChainLocks(root), []);

    write(root, 'docker/compose/offline-core.yml', 'services:\n  proof:\n    image: unknown.invalid/proof:1.0.0\n');
    assert.match(inspectSupplyChainLocks(root).join('\n'), /absent from the lock/);

    write(root, 'docker/compose/not-offline.yml', 'services:\n  proof:\n    image: example.invalid/proof:1.0.0\n');
    assert.match(inspectSupplyChainLocks(root).join('\n'), /not digest-pinned/);
  });
});

test('rejects version ranges, integrity drift, and undeclared package boundaries', () => {
  withFixture((root) => {
    write(root, 'package.json', { dependencies: { 'bitcoinjs-lib': '^7.0.1' } });
    write(root, 'package-lock.json', { packages: { 'node_modules/bitcoinjs-lib': { version: '7.0.1', integrity: 'sha512-drift' } } });
    write(root, 'extra/package.json', { dependencies: { 'bitcoinjs-lib': '7.0.1' } });
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /must declare exact bitcoinjs-lib@7\.0\.1/);
    assert.match(errors, /lock drift for bitcoinjs-lib/);
    assert.match(errors, /unreviewed manifest boundary/);
  });
});

test('rejects runner parent and exact Go toolchain drift', () => {
  withFixture((root) => {
    write(root, 'scripts/ci/images/go-runner.Dockerfile', `FROM example.invalid/proof:1.0.0\nARG NODE_VERSION=24.19.0\nARG NPM_VERSION=11.19.0\nARG GO_VERSION=1.25.13\n`);
    write(root, 'scripts/verify-addresses/implementations/go.mod', 'module proof\n\ngo 1.25.0\ntoolchain go1.25.13\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /Go runner parent must be/);
    assert.match(errors, /bake exact go 1\.25\.12/);
    assert.match(errors, /disable automatic Go toolchain downloads/);
    assert.match(errors, /go\.mod toolchain must be go1\.25\.12/);
  });
});

test('rejects Node archive or shared bootstrap drift', () => {
  withFixture((root) => {
    const lockPath = path.join(root, 'config/ci-toolchain-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.artifacts.nodeLinuxX64.url = 'https://example.invalid/node.tar.xz';
    lock.artifacts.nodeLinuxX64.sha256 = 'not-a-digest';
    lock.artifacts.npm.url = 'https://example.invalid/npm.tgz';
    lock.artifacts.npm.sha512 = 'not-a-digest';
    write(root, 'config/ci-toolchain-lock.json', lock);
    write(root, '.github/actions/setup-node-toolchain/action.yml', 'runs:\n  using: composite\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /archive must have an exact official URL and SHA-256/);
    assert.match(errors, /archive must have an exact official URL and SHA-512/);
    assert.match(errors, /shared Node setup must bootstrap/);
  });
});

test('requires reviewed OS package acquisition and invalidates the review on drift', () => {
  withFixture((root) => {
    const dockerfile = 'FROM example.invalid/proof:1.0.0@' + DIGEST + '\nRUN apk add --no-cache openssl\n';
    write(root, 'docker/proof/Dockerfile', dockerfile);
    assert.match(inspectSupplyChainLocks(root).join('\n'), /unreviewed OS package acquisition/);
    const configPath = path.join(root, 'config/container-image-lock.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.reviewedOsPackageAcquisition = [{
      file: 'docker/proof/Dockerfile',
      sha256: createHash('sha256').update(dockerfile).digest('hex'),
      review: 'reviewed test acquisition',
    }];
    write(root, 'config/container-image-lock.json', config);
    assert.deepEqual(inspectSupplyChainLocks(root), []);
    write(root, 'docker/proof/Dockerfile', `${dockerfile}RUN apk add --no-cache curl\n`);
    assert.match(inspectSupplyChainLocks(root).join('\n'), /changed after its OS package acquisition review/);
  });
});
