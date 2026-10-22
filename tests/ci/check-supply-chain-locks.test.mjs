import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  execFileSync('git', ['init', '--quiet', root]);
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
    runtimes: { node: '24.21.0', npm: '12.0.2', python: '3.10.12', go: '1.25.12' },
    artifacts: {
      nodeLinuxX64: {
        url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz',
        sha256: 'b'.repeat(64),
      },
      npm: {
        url: 'https://registry.npmjs.org/npm/-/npm-12.0.2.tgz',
        sha512: 'c'.repeat(128),
      },
    },
    fundsCriticalPackages: [{
      name: 'bitcoinjs-lib', version: '7.0.1', integrity: INTEGRITY,
      manifests: ['package.json'], lockfiles: ['package-lock.json'],
    }],
  });
  write(root, 'docker/proof/Dockerfile', `FROM example.invalid/proof:1.0.0@${DIGEST}\n`);
  write(root, 'scripts/ci/images/go-runner.Dockerfile', `FROM example.invalid/proof:1.0.0@${DIGEST}\nARG NODE_VERSION=24.21.0\nARG NODE_SHA256=${'b'.repeat(64)}\nARG NPM_VERSION=12.0.2\nARG NPM_SHA512=${'c'.repeat(128)}\nARG GO_VERSION=1.25.12\nENV GOTOOLCHAIN="local"\n`);
  write(root, '.github/actions/setup-node-toolchain/action.yml', 'runs:\n  using: composite\n  steps:\n    - run: bash scripts/ci/bootstrap-node.sh\n');
  write(root, 'scripts/verify-addresses/implementations/go.mod', 'module proof\n\ngo 1.25.0\ntoolchain go1.25.12\n');
  write(root, '.nvmrc', '24.21.0\n');
  for (const workflow of ['architecture.yml', 'test.yml', 'verify-vectors.yml']) {
    write(root, `.github/workflows/${workflow}`, "env:\n  NODE_VERSION: '24.21.0'\n");
  }
  write(root, '.github/workflows/quality.yml', "env:\n  NODE_VERSION: '24.21.0'\n  PYTHON_VERSION: '3.10.12'\n");
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
    const errorList = inspectSupplyChainLocks(root);
    const errors = errorList.join('\n');
    assert.match(errors, /must declare exact bitcoinjs-lib@7\.0\.1/);
    assert.match(errors, /lock drift for bitcoinjs-lib/);
    assert.match(errors, /unreviewed manifest boundary/);
    const hints = errorList.filter((line) => line.includes('scripts/bump-funds-critical.sh'));
    assert.equal(hints.length, 1, 'exactly one funds-critical remediation hint, not one per error');
    assert.match(hints[0], /scripts\/bump-funds-critical\.sh <package> <version>/);
    assert.match(hints[0], /ci-cd-strategy\.md/);
  });
});

test('emits no funds-critical remediation hint when locks are clean', () => {
  withFixture((root) => {
    assert.deepEqual(inspectSupplyChainLocks(root), []);
  });
});

test('rejects runner parent and exact Go toolchain drift', () => {
  withFixture((root) => {
    write(root, 'scripts/ci/images/go-runner.Dockerfile', `FROM example.invalid/proof:1.0.0\nARG NODE_VERSION=24.21.0\nARG NPM_VERSION=12.0.2\nARG GO_VERSION=1.25.13\n`);
    write(root, 'scripts/verify-addresses/implementations/go.mod', 'module proof\n\ngo 1.25.0\ntoolchain go1.25.13\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /Go runner parent must be/);
    assert.match(errors, /bake exact go 1\.25\.12/);
    assert.match(errors, /disable automatic Go toolchain downloads/);
    assert.match(errors, /go\.mod toolchain must be go1\.25\.12/);
  });
});

test('accepts the exact Go minimum without a redundant toolchain and rejects drift', () => {
  withFixture((root) => {
    const file = 'scripts/verify-addresses/implementations/go.mod';
    write(root, file, 'module example\n\ngo 1.25.12\n');
    assert.deepEqual(inspectSupplyChainLocks(root), []);
    write(root, file, 'module example\n\ngo 1.25.11\n');
    assert.match(inspectSupplyChainLocks(root).join('\n'), /go\.mod toolchain must be go1\.25\.12/);
    write(root, file, 'module example\n\ngo 1.25.12\n\ntoolchain go1.25.13\n');
    assert.match(inspectSupplyChainLocks(root).join('\n'), /go\.mod toolchain must be go1\.25\.12/);
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

test('rejects untagged images in Dockerfile, compose and workflow image contexts', () => {
  withFixture((root) => {
    write(root, 'docker/proof/Dockerfile', `FROM example.invalid/proof:1.0.0@${DIGEST} AS base\nFROM base\nFROM alpine\n`);
    write(root, 'docker/compose/proof.yml', 'services:\n  db:\n    image: postgres\n  cache:\n    image: "docker.io/library/redis"\n');
    write(root, '.github/workflows/proof.yml', 'jobs:\n  proof:\n    container:\n      image: node\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /docker\/proof\/Dockerfile:3 external image is untagged and not digest-pinned: alpine/);
    assert.match(errors, /docker\/compose\/proof\.yml:3 external image is untagged and not digest-pinned: postgres/);
    assert.match(errors, /docker\/compose\/proof\.yml:5 external image is untagged and not digest-pinned: docker\.io\/library\/redis/);
    assert.match(errors, /\.github\/workflows\/proof\.yml:4 external image is untagged and not digest-pinned: node/);
    assert.doesNotMatch(errors, /: base\b/, 'a FROM naming an earlier stage is not an image pull');
  });
});

test('checks the image argument of a backslash-continued docker run', () => {
  withFixture((root) => {
    write(root, '.github/workflows/proof.yml', [
      'jobs:', '  proof:', '    steps:', '      - run: |',
      '          docker run --rm "${labels[@]}" -v "$sock:/var/run/docker.sock:ro" \\',
      '              example.invalid/proof:1.0.0 test -S /var/run/docker.sock',
      '          docker run -d --name proxy \\', '            -e CONTAINERS=1 \\',
      `            docker.io/unknown/proxy:latest@${DIGEST}`, '',
    ].join('\n'));
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /proof\.yml:5 external image is not digest-pinned: example\.invalid\/proof:1\.0\.0/);
    assert.match(errors, /proof\.yml:7 external image is absent from the lock: docker\.io\/unknown\/proxy:latest/);
  });
});

test('scans every shell script that names an image, not a fixed list', () => {
  withFixture((root) => {
    write(root, 'scripts/verify-addresses/verify-repeatable.sh', `core_image='example.invalid/proof:1.0.0@sha256:${'b'.repeat(64)}'\n`);
    write(root, 'scripts/offline/create-bundle.sh', `printf '%s\\n' \\\n  "unknown.invalid/db:16@${DIGEST}"\n`);
    write(root, 'tests/install/utils/helpers.sh', 'docker run --rm -v "$dir:/probe:ro" unknown.invalid/probe:3 ls /probe\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /verify-repeatable\.sh:1 image digest drift for example\.invalid\/proof:1\.0\.0/);
    assert.match(errors, /create-bundle\.sh:1 external image is absent from the lock: unknown\.invalid\/db:16/);
    assert.match(errors, /tests\/install\/utils\/helpers\.sh:1 external image is absent from the lock: unknown\.invalid\/probe:3/);
  });
});

test('ignores variables, comments, gitignored paths and test fixtures', () => {
  withFixture((root) => {
    write(root, 'scripts/proof.sh', [
      '# docker run alpine sh', 'docker pull "$IMAGE"', 'docker run --rm "${OWNERSHIP_LABEL_ARGS[@]}" "$image" true',
      'echo "  docker run --rm ${image_name} --version"', '',
    ].join('\n'));
    write(root, 'docker/proof/Dockerfile', `ARG BASE=example.invalid/proof:1.0.0@${DIGEST}\nFROM \${BASE}\nFROM scratch\n`);
    write(root, '.gitignore', 'ignored/\n');
    write(root, 'ignored/Dockerfile', 'FROM alpine\n');
    write(root, 'tests/ci/proof.test.sh', 'docker run --rm alpine true\n');
    write(root, 'docs/how-to/proof.md', 'docker run --rm alpine true\n');
    assert.deepEqual(inspectSupplyChainLocks(root), []);
  });
});

test('treats Docker Hub spellings of one image as the same lock entry', () => {
  withFixture((root) => {
    const lockPath = path.join(root, 'config/container-image-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.lockedImages.push({ reference: 'docker.io/library/hubimage:1.0', digest: DIGEST, scope: 'proof' });
    write(root, 'config/container-image-lock.json', lock);
    write(root, 'docker/compose/hub.yml', `services:\n  hub:\n    image: hubimage:1.0@${DIGEST}\n`);
    assert.deepEqual(inspectSupplyChainLocks(root), []);
    lock.lockedImages.push({ reference: 'hubimage:1.0', digest: DIGEST, scope: 'proof' });
    write(root, 'config/container-image-lock.json', lock);
    assert.match(inspectSupplyChainLocks(root).join('\n'), /duplicate locked image reference: hubimage:1\.0/);
  });
});

test('follows docker run past more value flags, variable arguments and a variable docker binary', () => {
  withFixture((root) => {
    write(root, 'scripts/proof.sh', [
      'docker run --rm --ip "$ip" alpine:3.20 true',
      'docker run --memory-swap 2g busybox:1.36 true',
      'docker run --cpuset-cpus 0 debian:12 true',
      'docker run --gpus all unknown.invalid/gpu:1 nvidia-smi',
      'docker run --unlisted-numeric-flag 5 unknown.invalid/digit:1 true',
      'docker run $EXTRA_ARGS redis:7 true',
      '"$DOCKER" run nginx:1.27 true',
      '',
    ].join('\n'));
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /proof\.sh:1 external image is absent from the lock: alpine:3\.20/);
    assert.match(errors, /proof\.sh:2 external image is absent from the lock: busybox:1\.36/);
    assert.match(errors, /proof\.sh:3 external image is absent from the lock: debian:12/);
    assert.match(errors, /proof\.sh:4 external image is absent from the lock: unknown\.invalid\/gpu:1/);
    assert.match(errors, /proof\.sh:5 external image is absent from the lock: unknown\.invalid\/digit:1/);
    assert.match(errors, /proof\.sh:6 external image is absent from the lock: redis:7/);
    assert.match(errors, /proof\.sh:7 external image is absent from the lock: nginx:1\.27/);
    assert.doesNotMatch(errors, /untagged and not digest-pinned: all/, 'the --gpus value is not the image');
  });
});

test('scans Containerfile and Makefile sources', () => {
  withFixture((root) => {
    write(root, 'docker/proof/Containerfile', 'FROM fedora:40\n');
    write(root, 'Makefile', 'pull:\n\tdocker pull ubuntu:24.04\n');
    const errors = inspectSupplyChainLocks(root).join('\n');
    assert.match(errors, /docker\/proof\/Containerfile:1 external image is absent from the lock: fedora:40/);
    assert.match(errors, /Makefile:2 external image is absent from the lock: ubuntu:24\.04/);
  });
});

test('does not read other run commands or vendored actions as image pulls', () => {
  withFixture((root) => {
    write(root, 'scripts/proof.sh', '"$NPM" run build\n$PYTHON run alpine\ndocker run "$image" true\n');
    write(root, '.github/actions/vendor/checkout/action.yml', 'runs:\n  using: docker\n  image: alpine\n');
    assert.deepEqual(inspectSupplyChainLocks(root), []);
  });
});
