#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IMAGE_TOKEN = /[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)*:[A-Za-z0-9._-]+/g;
const DIGEST_IMAGE_TOKEN = /[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}/g;
const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/;
const IGNORED_DIRS = new Set(['.git', '.tmp', 'coverage', 'dist', 'node_modules', 'playwright-report', 'reports', 'tasks', 'test-results']);
// The image scan reads every tracked or unignored file except prose, generated
// output and test data that writes image strings as fixtures. The install
// lanes' harness (tests/install/utils, tests/install/e2e) runs a real daemon,
// so it stays in scope.
const IMAGE_SCAN_EXCLUDED = /^(?:docs|tasks|reports)\/|(?:^|\/)fixtures\/|^scripts\/verify-addresses\/output\/|^server\/tests\/|^tests\/(?!install\/(?:utils|e2e)\/)|^\.github\/actions\/vendor\//;
// docker/podman run, create and pull options that consume the next token as
// their value (docker run reference plus common podman additions). An unlisted
// flag still consumes a following digit-leading token (sizes, counts, CPU sets).
const DOCKER_VALUE_FLAGS = new Set(['-a', '--add-host', '--annotation', '--arch', '--attach', '--blkio-weight',
  '--blkio-weight-device', '-c', '--cap-add', '--cap-drop', '--cgroup-parent', '--cgroupns', '--cidfile', '--cpu-count',
  '--cpu-percent', '--cpu-period', '--cpu-quota', '--cpu-rt-period', '--cpu-rt-runtime', '--cpu-shares', '--cpus',
  '--cpuset-cpus', '--cpuset-mems', '--detach-keys', '--device', '--device-cgroup-rule', '--device-read-bps',
  '--device-read-iops', '--device-write-bps', '--device-write-iops', '--dns', '--dns-option', '--dns-search',
  '--domainname', '-e', '--entrypoint', '--env', '--env-file', '--expose', '--gidmap', '--gpus', '--group-add', '-h',
  '--health-cmd', '--health-interval', '--health-retries', '--health-start-interval', '--health-start-period',
  '--health-timeout', '--hostname', '--ip', '--ip6', '--ipc', '--isolation', '--kernel-memory', '-l', '--label',
  '--label-file', '--link', '--link-local-ip', '--log-driver', '--log-opt', '-m', '--mac-address', '--memory',
  '--memory-reservation', '--memory-swap', '--memory-swappiness', '--mount', '--name', '--net', '--net-alias',
  '--network', '--network-alias', '--oom-score-adj', '--os', '-p', '--pid', '--pids-limit', '--platform', '--pod',
  '--publish', '--pull', '--restart', '--runtime', '--secret', '--security-opt', '--shm-size', '--stop-signal',
  '--stop-timeout', '--storage-opt', '--sysctl', '--tmpfs', '--tz', '-u', '--uidmap', '--ulimit', '--umask', '--user',
  '--userns', '--uts', '-v', '--variant', '--volume', '--volume-driver', '--volumes-from', '-w', '--workdir']);
// The command's binary: docker or podman, or a variable naming a container CLI
// ("$DOCKER", ${CONTAINER_ENGINE}, $(PODMAN) in a Makefile).
const DOCKER_COMMAND = /(?:\b(?:docker|podman)|[\x22\x27]?\$[({]?(\w+)[)}]?[\x22\x27]?)\s+(?:container\s+|image\s+)?(?:run|create|pull)\b/g;
const CONTAINER_CLI_VARIABLE = /docker|podman|container|engine/i;
const OFFLINE_RUNTIME_OVERLAYS = new Set([
  'docker/compose/offline-core.yml',
  'docker/compose/offline-monitoring.yml',
  'docker/compose/offline-tor.yml',
]);

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

// Tracked plus new, unignored files: a new file must not bypass the gate before
// it is committed. A root that is not a git work tree fails closed.
function listImageScanFiles(root) {
  let listed;
  try {
    listed = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`image scan needs a git work tree at ${root}: ${error instanceof Error ? error.message.trim() : String(error)}`);
  }
  return listed.split('\0').filter((file) => file && !IMAGE_SCAN_EXCLUDED.test(file) && existsSync(path.join(root, file))).sort();
}

function imageSourceKind(relativePath) {
  const basename = path.basename(relativePath);
  if (/(?:^|\.)(?:Docker|Container)file(?:\.(?!dockerignore$)[^.]+)?$/.test(basename)) return 'dockerfile';
  if (/\.(?:sh|bash|mk)$|^(?:GNU)?[Mm]akefile$/.test(basename)) return 'shell';
  if (/\.ya?ml$/.test(basename)) return 'yaml';
  return /\.(?:json|jq|[cm]?js|ts)$/.test(basename) ? 'data' : null;
}

function verifyFundsCriticalPackages(root, config, manifests, locks, errors) {
  const before = errors.length;
  for (const policy of config.fundsCriticalPackages ?? []) verifyCriticalPackage(root, policy, manifests, locks, errors);
  if (errors.length > before) {
    errors.push('Fix funds-critical package drift with scripts/bump-funds-critical.sh <package> <version>; see "Bumping a funds-critical package" in docs/reference/ci-cd-strategy.md.');
  }
}

// One entry per command: backslash continuations are joined onto the line that
// starts the command, and full-line comments are dropped.
function logicalLines(contents, kind) {
  const lines = [];
  let pending = '';
  let start = 0;
  contents.split(/\r?\n/).forEach((raw, index) => {
    const text = kind !== 'data' && /^\s*\x23/.test(raw) ? '' : raw;
    if (!pending) start = index + 1;
    if (text.endsWith('\x5c')) {
      pending += `${text.slice(0, -1)} `;
      return;
    }
    lines.push({ text: pending + text, line: start });
    pending = '';
  });
  if (pending) lines.push({ text: pending, line: start });
  return lines;
}

function unquote(token) {
  return token.replace(/^[\x22\x27]|[\x22\x27]$/g, '');
}

function dockerCommandArguments(text) {
  for (const match of text.matchAll(DOCKER_COMMAND)) {
    if (match[1] === undefined || CONTAINER_CLI_VARIABLE.test(match[1])) return text.slice(match.index + match[0].length);
  }
  return null;
}

// The image is the first argument that is neither an option nor an option's
// value. A variable argument ($EXTRA_ARGS, or "$image" itself) is skipped;
// after one, only an unambiguous reference (with a tag, registry or digest)
// counts, so `docker run "$image" true` does not read `true` as the image.
function dockerCommandImage(text) {
  const argumentsText = dockerCommandArguments(text);
  if (argumentsText === null) return null;
  const tokens = argumentsText.match(/\x22[^\x22]*\x22|\x27[^\x27]*\x27|\S+/g) ?? [];
  let afterVariable = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^\x22?\$\{\w+\[[@*]\]\}\x22?$/.test(token)) continue;
    if (/^[\x22\x27]?\$/.test(token)) {
      afterVariable = true;
    } else if (token.startsWith('-')) {
      if (!token.includes('=') && (DOCKER_VALUE_FLAGS.has(token) || /^[0-9]/.test(tokens[index + 1] ?? ''))) index += 1;
    } else {
      const image = unquote(token);
      return !afterVariable || /[:/@]/.test(image) ? image : null;
    }
  }
  return null;
}

function structuredImage(text, kind, stages) {
  if (kind === 'dockerfile') {
    const from = text.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      const stage = stages.has(from[1].toLowerCase());
      if (from[2]) stages.add(from[2].toLowerCase());
      return stage ? null : from[1];
    }
  }
  const keyed = text.match(/^\s*(?:-\s+)?(?:image|container):\s*[\x22\x27]?([^\x22\x27\s\x23]+)/) ?? text.match(/\buses:\s*docker:[/]{2}(\S+)/);
  return keyed ? keyed[1] : dockerCommandImage(text);
}

function isTaggedContext(text, relativePath) {
  if (/\x22image\x22\s*:/.test(text) || /^\s*(?:-\s+)?image:/.test(text)) return true;
  if (/^\s*(?:readonly\s+|local\s+|export\s+)?\w*image\w*=/i.test(text)) return true;
  return relativePath === 'scripts/offline/bundle-common.sh' && /^\s*\x22/.test(text);
}

function imagesInLine(text, kind, relativePath, stages) {
  const found = new Set(text.match(DIGEST_IMAGE_TOKEN) ?? []);
  if (isTaggedContext(text, relativePath)) for (const token of text.match(IMAGE_TOKEN) ?? []) found.add(token);
  if (kind !== 'data') {
    const image = structuredImage(text, kind, stages);
    if (image && !image.includes('$') && image !== 'scratch') found.add(image);
  }
  return [...found].filter((image) => IMAGE_REFERENCE.test(image) && looksLikeImageReference(splitImage(image).reference));
}

function looksLikeImageReference(reference) {
  const tag = reference.slice(reference.lastIndexOf(':') + 1);
  if (/^[0-9]/.test(reference) || ['ro', 'host-gateway'].includes(tag)) return false;
  return !reference.includes('.sock') && !reference.startsWith('localhost');
}

function extractImageUses(root) {
  const uses = [];
  for (const relativePath of listImageScanFiles(root)) {
    const kind = imageSourceKind(relativePath);
    if (!kind) continue;
    const stages = new Set();
    for (const { text, line } of logicalLines(readFileSync(path.join(root, relativePath), 'utf8'), kind)) {
      for (const image of imagesInLine(text, kind, relativePath, stages)) uses.push({ image, file: relativePath, line });
    }
  }
  return uses;
}

function splitImage(image) {
  const marker = image.lastIndexOf('@');
  return marker === -1
    ? { reference: image, digest: '' }
    : { reference: image.slice(0, marker), digest: image.slice(marker + 1) };
}

// Docker Hub spellings name one image: docker.io/library/alpine:3.20 is alpine:3.20.
function canonicalReference(reference) {
  return reference.replace(/^(?:index\.)?docker\.io[/]/, '').replace(/^library[/](?=[^/]+$)/, '');
}

function isUntagged(reference) {
  return !reference.slice(reference.lastIndexOf('/') + 1).includes(':');
}

function isLocalImage(reference, prefixes) {
  return reference.includes('${') || prefixes.some((prefix) => reference.startsWith(prefix));
}

function readLockedImages(config, errors) {
  const locked = new Map();
  for (const entry of config.lockedImages ?? []) {
    if (!entry.reference || !SHA256.test(entry.digest ?? '') || !entry.scope) {
      errors.push(`invalid locked image entry: ${JSON.stringify(entry)}`);
      continue;
    }
    const key = canonicalReference(entry.reference);
    if (locked.has(key)) errors.push(`duplicate locked image reference: ${entry.reference}`);
    locked.set(key, { reference: entry.reference, digest: entry.digest });
  }
  return locked;
}

function checkImageUse(use, reference, digest, locked, seen, errors) {
  if (!digest && isUntagged(reference)) {
    errors.push(`${use.file}:${use.line} external image is untagged and not digest-pinned: ${reference}`);
    return;
  }
  const key = canonicalReference(reference);
  const expected = locked.get(key);
  if (!expected) {
    errors.push(`${use.file}:${use.line} external image is absent from the lock: ${reference}`);
    return;
  }
  seen.add(key);
  // Docker archives restore named tags, not registry RepoDigest aliases. These
  // exact offline-only overlays may use the tag from a locked reference after
  // the signed bundle verifier binds that tag to its expected image ID.
  if (!digest && !OFFLINE_RUNTIME_OVERLAYS.has(use.file)) {
    errors.push(`${use.file}:${use.line} external image is not digest-pinned: ${reference}`);
  } else if (digest && digest !== expected.digest) {
    errors.push(`${use.file}:${use.line} image digest drift for ${reference}: expected ${expected.digest}, got ${digest}`);
  }
}

export function inspectContainerLocks(root) {
  const errors = [];
  const config = readJson(root, 'config/container-image-lock.json');
  if (config.schemaVersion !== 1) errors.push('container image lock schemaVersion must be 1');
  const locked = readLockedImages(config, errors);
  const seen = new Set();
  for (const use of extractImageUses(root)) {
    const { reference, digest } = splitImage(use.image);
    if (!isLocalImage(reference, config.localImagePrefixes ?? [])) checkImageUse(use, reference, digest, locked, seen, errors);
  }
  for (const [key, entry] of locked) {
    if (!seen.has(key)) errors.push(`unused locked image entry: ${entry.reference}`);
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

function verifyToolchainArtifacts(config, errors) {
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
}

function verifyGoRunnerImage(root, config, errors) {
  const dockerfile = readFileSync(path.join(root, 'scripts/ci/images/go-runner.Dockerfile'), 'utf8');
  const parent = `${config.runnerImage.parentReference}@${config.runnerImage.parentDigest}`;
  const nodeArtifact = config.artifacts?.nodeLinuxX64;
  const npmArtifact = config.artifacts?.npm;
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
}

function verifyToolchainSources(root, config, errors) {
  verifyToolchainArtifacts(config, errors);
  verifyGoRunnerImage(root, config, errors);

  const setupAction = readFileSync(path.join(root, '.github/actions/setup-node-toolchain/action.yml'), 'utf8');
  if (!setupAction.includes('scripts/ci/bootstrap-node.sh')) errors.push('shared Node setup must bootstrap the checksum-locked runtime');

  const goMod = readFileSync(path.join(root, 'scripts/verify-addresses/implementations/go.mod'), 'utf8');
  // Go removes a redundant toolchain directive when the language minimum is
  // the same version. Both canonical forms must still select the exact pin.
  const explicitGoToolchain = goMod.match(/^toolchain (\S+)$/m)?.[1];
  const goMinimum = goMod.match(/^go (\S+)$/m)?.[1];
  const selectedGoToolchain = explicitGoToolchain ?? `go${goMinimum}`;
  if (selectedGoToolchain !== `go${config.runtimes.go}`) errors.push(`go.mod toolchain must be go${config.runtimes.go}`);
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
  verifyFundsCriticalPackages(root, config, packageManifests, packageLocks, errors);
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

if (isMainModule(import.meta.url)) main();
