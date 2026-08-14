import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareReleaseAssets } from '../../scripts/release/prepare-release-assets.mjs';
import { sha256File } from '../../scripts/release/release-asset-common.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'sanctuary-prepare-assets-test-'));

try {
  const repo = path.join(root, 'repo');
  const output = path.join(root, 'output');
  mkdirSync(repo);
  mkdirSync(output);
  mkdirSync(path.join(repo, 'scripts/offline'), { recursive: true });
  copyFileSync(path.resolve('scripts/offline/apply-bundle.sh'), path.join(repo, 'scripts/offline/apply-bundle.sh'));
  copyFileSync(path.resolve('scripts/offline/bundle-common.sh'), path.join(repo, 'scripts/offline/bundle-common.sh'));
  run('git', ['-C', repo, 'init', '-q']);
  run('git', ['-C', repo, 'config', 'user.name', 'Release Test']);
  run('git', ['-C', repo, 'config', 'user.email', 'release@example.invalid']);
  writeFileSync(path.join(repo, 'install.sh'), '#!/usr/bin/env bash\necho install\n');
  writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  writeFileSync(path.join(repo, 'package.json'), '{"version":"1.2.3"}\n');
  run('git', ['-C', repo, 'add', '.']);
  run('git', ['-C', repo, 'commit', '-qm', 'fixture release']);
  run('git', ['-C', repo, 'tag', '-a', 'v1.2.3-rc.1', '-m', 'fixture release candidate']);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(root, 'private.pem');
  const publicKeyPath = path.join(root, 'public.pem');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const bundleStage = path.join(root, 'bundle-stage');
  mkdirSync(bundleStage);
  mkdirSync(path.join(bundleStage, 'repo'));
  mkdirSync(path.join(bundleStage, 'images/core'), { recursive: true });
  mkdirSync(path.join(bundleStage, 'images/monitoring'), { recursive: true });
  mkdirSync(path.join(bundleStage, 'images/tor'), { recursive: true });
  writeFileSync(path.join(bundleStage, 'payload.txt'), 'signed bundle fixture\n');
  const commit = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(path.join(bundleStage, 'manifest.env'), `SANCTUARY_OFFLINE_BUNDLE_SCHEMA=1\nSANCTUARY_VERSION=1.2.3\nSANCTUARY_GIT_TAG=v1.2.3-rc.1\nSANCTUARY_GIT_COMMIT=${commit}\nSANCTUARY_PLATFORM=linux/amd64\nSANCTUARY_BUNDLE_FLAVOR=full\nSANCTUARY_INCLUDED_PROFILES=core,monitoring,tor\n`);
  writeFileSync(path.join(bundleStage, 'manifest.json'), `${JSON.stringify({ schema: 1, version: '1.2.3', gitTag: 'v1.2.3-rc.1', gitCommit: commit, platform: 'linux/amd64', flavor: 'full', includedProfiles: 'core,monitoring,tor' })}\n`);
  const expectedImages = spawnSync('bash', ['-c', 'source "$1"; offline_all_release_images', '_', path.join(repo, 'scripts/offline/bundle-common.sh')], { encoding: 'utf8' }).stdout.trim().split('\n');
  const imageInventory = expectedImages.map((image) => ({
    image,
    id: `sha256:${'b'.repeat(64)}`,
    os: 'linux',
    architecture: 'amd64',
    repoDigests: image.startsWith('sanctuary-') ? [] : [`example.invalid/image@sha256:${'c'.repeat(64)}`],
  }));
  for (const image of expectedImages) {
    const bucket = image.startsWith('sanctuary-grafana-migration:') || /^(jaegertracing|grafana|prom)\//.test(image)
      ? 'monitoring'
      : image.startsWith('dperson/torproxy:') ? 'tor' : 'core';
    writeFileSync(path.join(bundleStage, 'images', bucket, `${image.replace(/[^A-Za-z0-9._-]/g, '-')}.tar`), `image ${image}\n`);
  }
  writeFileSync(path.join(bundleStage, 'image-inventory.json'), `${JSON.stringify({ schema: 1, platform: 'linux/amd64', images: imageInventory })}\n`);
  run('git', ['-C', repo, 'bundle', 'create', path.join(bundleStage, 'repo/sanctuary.git.bundle'), 'refs/tags/v1.2.3-rc.1']);
  const imageFiles = expectedImages.map((image) => {
    const bucket = image.startsWith('sanctuary-grafana-migration:') || /^(jaegertracing|grafana|prom)\//.test(image)
      ? 'monitoring'
      : image.startsWith('dperson/torproxy:') ? 'tor' : 'core';
    return `images/${bucket}/${image.replace(/[^A-Za-z0-9._-]/g, '-')}.tar`;
  });
  const checksumFiles = ['payload.txt', 'manifest.env', 'manifest.json', 'image-inventory.json', 'repo/sanctuary.git.bundle', ...imageFiles];
  writeFileSync(path.join(bundleStage, 'checksums.sha256'), `${checksumFiles.map((name) => {
    const sha = spawnSync('sha256sum', [path.join(bundleStage, name)], { encoding: 'utf8' }).stdout.split(' ')[0];
    return `${sha}  ${name}`;
  }).join('\n')}\n`);
  run('openssl', ['dgst', '-sha256', '-sign', privateKeyPath, '-out', path.join(bundleStage, 'checksums.sha256.sig'), path.join(bundleStage, 'checksums.sha256')]);
  const bundle = path.join(root, 'input.tar.gz');
  run('tar', ['-czf', bundle, '-C', bundleStage, '.']);
  run('openssl', ['dgst', '-sha256', '-sign', privateKeyPath, '-out', `${bundle}.sig`, bundle]);

  const result = prepareReleaseAssets({
    tag: 'v1.2.3-rc.1',
    outputDir: output,
    signingKey: privateKeyPath,
    publicKey: publicKeyPath,
    repoRoot: repo,
    bundlePath: bundle,
    runId: 'test-run-1',
  });
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.release.tag, 'v1.2.3-rc.1');
  assert.equal(manifest.artifacts.find((item) => item.type === 'offline-bundle').platform, 'linux/amd64');
  assert.equal(manifest.artifacts.some((item) => item.type === 'container-image'), false);
  assert.match(readFileSync(path.join(output, `${path.basename(result.bundlePath)}.spdx.json`), 'utf8'), /SPDX-2.3/);
  writeFileSync(path.join(bundleStage, 'manifest.json'), `${JSON.stringify({ schema: 1, version: '9.9.9', gitTag: 'v9.9.9', gitCommit: commit, platform: 'linux/amd64', flavor: 'full', includedProfiles: 'core,monitoring,tor' })}\n`);
  writeFileSync(path.join(bundleStage, 'checksums.sha256'), `${checksumFiles.map((name) => {
    const sha = spawnSync('sha256sum', [path.join(bundleStage, name)], { encoding: 'utf8' }).stdout.split(' ')[0];
    return `${sha}  ${name}`;
  }).join('\n')}\n`);
  run('openssl', ['dgst', '-sha256', '-sign', privateKeyPath, '-out', path.join(bundleStage, 'checksums.sha256.sig'), path.join(bundleStage, 'checksums.sha256')]);
  run('tar', ['-czf', bundle, '-C', bundleStage, '.']);
  run('openssl', ['dgst', '-sha256', '-sign', privateKeyPath, '-out', `${bundle}.sig`, bundle]);
  assert.throws(() => prepareReleaseAssets({
    tag: 'v1.2.3-rc.1', outputDir: path.join(root, 'wrong-identity'), signingKey: privateKeyPath,
    publicKey: publicKeyPath, repoRoot: repo, bundlePath: bundle,
  }), /bundle identity does not match/);
  assert.throws(() => prepareReleaseAssets({
    tag: 'v1.2.3-rc.1', outputDir: path.join(root, 'arm'), signingKey: privateKeyPath,
    publicKey: publicKeyPath, repoRoot: repo, bundlePath: bundle, platform: 'linux/arm64',
  }), /only linux\/amd64 is release-verified/);
  const sparse = path.join(root, 'large-sparse.bin');
  writeFileSync(sparse, '');
  truncateSync(sparse, 64 * 1024 * 1024);
  const expectedSparseSha = spawnSync('sha256sum', [sparse], { encoding: 'utf8' }).stdout.split(' ')[0];
  assert.equal(sha256File(sparse), expectedSparseSha, 'large files must hash incrementally');
  console.log('release asset preparation tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
