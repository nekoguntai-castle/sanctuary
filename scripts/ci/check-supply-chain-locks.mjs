#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IMAGE_TOKEN = /[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)*:[A-Za-z0-9._-]+/g;
const IGNORED_DIRS = new Set(['.git', '.tmp', 'coverage', 'dist', 'node_modules', 'playwright-report', 'reports', 'tasks', 'test-results']);

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function walk(root, relativeDir = '') {
  const directory = path.join(root, relativeDir);
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory).sort()) {
    if (IGNORED_DIRS.has(entry)) continue;
    const relativePath = path.join(relativeDir, entry);
    const absolutePath = path.join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) files.push(...walk(root, relativePath));
    else files.push(relativePath);
  }
  return files;
}

function isImageSource(relativePath) {
  const basename = path.basename(relativePath);
  if (/Dockerfile(?:\..+)?$/.test(basename)) return true;
  if (/\.(?:ya?ml)$/.test(relativePath)) return relativePath === 'docker-compose.yml'
    || relativePath.startsWith('.github/workflows/')
    || relativePath.startsWith('docker/')
    || relativePath.startsWith('scripts/verify-');
  if (/config\/(?:trezor-emulator-proof|jade-emulator-proof|jade-protocol-harness)\.json$/.test(relativePath)) return true;
  return ['scripts/offline/bundle-common.sh', 'scripts/ops/phase2-alert-receiver-smoke.mjs'].includes(relativePath);
}

function contextualImageLine(line, relativePath) {
  if (/^\s*FROM\s+/i.test(line) || /^\s*image:\s*/.test(line) || /"image"\s*:/.test(line)) return true;
  if (/\bdocker\s+(?:run|pull)\b/.test(line)) return true;
  return relativePath === 'scripts/offline/bundle-common.sh' && /^\s*"/.test(line);
}

function looksLikeImageReference(reference) {
  const tag = reference.slice(reference.lastIndexOf(':') + 1);
  if (/^[0-9]/.test(reference) || ['ro', 'host-gateway'].includes(tag)) return false;
  return !reference.includes('.sock') && !reference.startsWith('localhost');
}

function extractImageUses(root) {
  const uses = [];
  for (const relativePath of walk(root).filter(isImageSource)) {
    const lines = readFileSync(path.join(root, relativePath), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!contextualImageLine(line, relativePath)) return;
      for (const image of line.match(IMAGE_TOKEN) ?? []) {
        if (looksLikeImageReference(splitImage(image).reference)) uses.push({ image, file: relativePath, line: index + 1 });
      }
    });
  }
  return uses;
}

function splitImage(image) {
  const marker = image.lastIndexOf('@');
  return marker === -1
    ? { reference: image, digest: '' }
    : { reference: image.slice(0, marker), digest: image.slice(marker + 1) };
}

function isLocalImage(reference, prefixes) {
  return reference.includes('${') || prefixes.some((prefix) => reference.startsWith(prefix));
}

export function inspectContainerLocks(root) {
  const errors = [];
  const config = readJson(root, 'config/container-image-lock.json');
  if (config.schemaVersion !== 1) errors.push('container image lock schemaVersion must be 1');
  const locked = new Map();
  for (const entry of config.lockedImages ?? []) {
    if (!entry.reference || !SHA256.test(entry.digest ?? '') || !entry.scope) {
      errors.push(`invalid locked image entry: ${JSON.stringify(entry)}`);
      continue;
    }
    if (locked.has(entry.reference)) errors.push(`duplicate locked image reference: ${entry.reference}`);
    locked.set(entry.reference, entry.digest);
  }

  const seen = new Set();
  for (const use of extractImageUses(root)) {
    const { reference, digest } = splitImage(use.image);
    if (isLocalImage(reference, config.localImagePrefixes ?? [])) continue;
    const expected = locked.get(reference);
    if (!expected) {
      errors.push(`${use.file}:${use.line} external image is absent from the lock: ${reference}`);
      continue;
    }
    seen.add(reference);
    if (!digest) errors.push(`${use.file}:${use.line} external image is not digest-pinned: ${reference}`);
    else if (digest !== expected) errors.push(`${use.file}:${use.line} image digest drift for ${reference}: expected ${expected}, got ${digest}`);
  }

  for (const reference of locked.keys()) {
    if (!seen.has(reference)) errors.push(`unused locked image entry: ${reference}`);
  }
  verifyOsPackageAcquisition(root, config, errors);
  return errors;
}

function verifyOsPackageAcquisition(root, config, errors) {
  const reviewed = new Map((config.reviewedOsPackageAcquisition ?? []).map((entry) => [entry.file, entry]));
  const packageDockerfiles = walk(root).filter((file) => {
    if (!/Dockerfile(?:\..+)?$/.test(path.basename(file))) return false;
    return /\b(?:apk add|apt-get install|apt install)\b/.test(readFileSync(path.join(root, file), 'utf8'));
  });
  for (const file of packageDockerfiles) {
    const entry = reviewed.get(file);
    if (!entry) {
      errors.push(`${file} has unreviewed OS package acquisition`);
      continue;
    }
    if (!entry.review) errors.push(`${file} OS package review must include a rationale`);
    const digest = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
    if (entry.sha256 !== digest) errors.push(`${file} changed after its OS package acquisition review`);
    reviewed.delete(file);
  }
  for (const file of reviewed.keys()) errors.push(`unused OS package acquisition review: ${file}`);
}

function packageSpec(manifest, name) {
  return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? manifest.optionalDependencies?.[name];
}

function packageLockEntry(lock, name) {
  return lock.packages?.[`node_modules/${name}`];
}

function verifyCriticalPackage(root, policy, packageManifests, packageLocks, errors) {
  const expectedManifests = new Set(policy.manifests);
  const expectedLocks = new Set(policy.lockfiles);
  for (const relativePath of packageManifests) {
    const declared = packageSpec(readJson(root, relativePath), policy.name);
    if (declared !== undefined && !expectedManifests.has(relativePath)) errors.push(`${policy.name} has unreviewed manifest boundary: ${relativePath}`);
  }
  for (const relativePath of policy.manifests) {
    const actual = packageSpec(readJson(root, relativePath), policy.name);
    if (actual !== policy.version) errors.push(`${relativePath} must declare exact ${policy.name}@${policy.version}; got ${actual ?? 'missing'}`);
  }
  for (const relativePath of packageLocks) {
    const entry = packageLockEntry(readJson(root, relativePath), policy.name);
    if (entry && !expectedLocks.has(relativePath)) errors.push(`${policy.name} has unreviewed lockfile boundary: ${relativePath}`);
  }
  for (const relativePath of policy.lockfiles) {
    const entry = packageLockEntry(readJson(root, relativePath), policy.name);
    if (!entry) errors.push(`${relativePath} is missing locked ${policy.name}`);
    else if (entry.version !== policy.version || entry.integrity !== policy.integrity) {
      errors.push(`${relativePath} lock drift for ${policy.name}: expected ${policy.version} with reviewed integrity`);
    }
  }
}

function verifyToolchainSources(root, config, errors) {
  const dockerfile = readFileSync(path.join(root, 'scripts/ci/images/go-runner.Dockerfile'), 'utf8');
  const parent = `${config.runnerImage.parentReference}@${config.runnerImage.parentDigest}`;
  const nodeArtifact = config.artifacts?.nodeLinuxX64;
  const npmArtifact = config.artifacts?.npm;
  const expectedNodeUrl = `https://nodejs.org/dist/v${config.runtimes.node}/node-v${config.runtimes.node}-linux-x64.tar.xz`;
  if (nodeArtifact?.url !== expectedNodeUrl || !/^[a-f0-9]{64}$/.test(nodeArtifact?.sha256 ?? '')) {
    errors.push(`Node ${config.runtimes.node} archive must have an exact official URL and SHA-256`);
  }
  const expectedNpmUrl = `https://registry.npmjs.org/npm/-/npm-${config.runtimes.npm}.tgz`;
  if (npmArtifact?.url !== expectedNpmUrl || !/^[a-f0-9]{128}$/.test(npmArtifact?.sha512 ?? '')) {
    errors.push(`npm ${config.runtimes.npm} archive must have an exact official URL and SHA-512`);
  }
  for (const [name, version] of Object.entries({ NODE: config.runtimes.node, NPM: config.runtimes.npm, GO: config.runtimes.go })) {
    if (!dockerfile.includes(`ARG ${name}_VERSION=${version}`)) errors.push(`Go runner must bake exact ${name.toLowerCase()} ${version}`);
  }
  if (!dockerfile.includes(`FROM ${parent}`)) errors.push(`Go runner parent must be ${parent}`);
  if (nodeArtifact?.sha256 && !dockerfile.includes(`ARG NODE_SHA256=${nodeArtifact.sha256}`)) {
    errors.push('Go runner Node archive SHA-256 must match the toolchain lock');
  }
  if (npmArtifact?.sha512 && !dockerfile.includes(`ARG NPM_SHA512=${npmArtifact.sha512}`)) {
    errors.push('Go runner npm archive SHA-512 must match the toolchain lock');
  }
  if (!dockerfile.includes('GOTOOLCHAIN="local"')) errors.push('Go runner must disable automatic Go toolchain downloads');

  const setupAction = readFileSync(path.join(root, '.github/actions/setup-node-toolchain/action.yml'), 'utf8');
  if (!setupAction.includes('scripts/ci/bootstrap-node.sh')) errors.push('shared Node setup must bootstrap the checksum-locked runtime');

  const goMod = readFileSync(path.join(root, 'scripts/verify-addresses/implementations/go.mod'), 'utf8');
  if (!goMod.split(/\r?\n/).includes(`toolchain go${config.runtimes.go}`)) errors.push(`go.mod toolchain must be go${config.runtimes.go}`);
  if (readFileSync(path.join(root, '.nvmrc'), 'utf8').trim() !== config.runtimes.node) errors.push(`.nvmrc must be ${config.runtimes.node}`);
  for (const workflow of ['architecture.yml', 'quality.yml', 'test.yml', 'verify-vectors.yml']) {
    const contents = readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
    if (!contents.includes(`NODE_VERSION: '${config.runtimes.node}'`)) {
      errors.push(`${workflow} must declare exact Node ${config.runtimes.node}`);
    }
  }
  const quality = readFileSync(path.join(root, '.github/workflows/quality.yml'), 'utf8');
  if (!quality.includes(`PYTHON_VERSION: '${config.runtimes.python}'`)) {
    errors.push(`quality.yml must declare exact Python ${config.runtimes.python}`);
  }
}

export function inspectToolchainLocks(root) {
  const errors = [];
  const config = readJson(root, 'config/ci-toolchain-lock.json');
  if (config.schemaVersion !== 1) errors.push('CI toolchain lock schemaVersion must be 1');
  const allFiles = walk(root);
  const packageManifests = allFiles.filter((file) => path.basename(file) === 'package.json');
  const packageLocks = allFiles.filter((file) => path.basename(file) === 'package-lock.json');
  for (const policy of config.fundsCriticalPackages ?? []) verifyCriticalPackage(root, policy, packageManifests, packageLocks, errors);
  verifyToolchainSources(root, config, errors);
  return errors;
}

export function inspectSupplyChainLocks(root) {
  return [...inspectContainerLocks(root), ...inspectToolchainLocks(root)];
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex === -1 ? process.cwd() : path.resolve(process.argv[rootIndex + 1] ?? '');
  const errors = inspectSupplyChainLocks(root);
  if (errors.length > 0) {
    console.error(`Supply-chain lock validation failed:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Supply-chain image, toolchain, and funds-critical package locks verified');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
