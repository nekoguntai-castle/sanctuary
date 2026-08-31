import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { sha256 } from './crypto.mjs';
import { validateOverlay } from './overlay-policy.mjs';

const INSTALL_MODES = new Set(['online', 'offline']);
const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function stableRead(filePath, maxBytes = 2 * 1024 * 1024) {
  const before = lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`definition file must be a regular non-symlink file: ${filePath}`);
  if (before.size > maxBytes) throw new Error(`definition file exceeds byte limit: ${filePath}`);
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`definition file identity changed while opening: ${filePath}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.length
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error(`definition file changed while reading: ${filePath}`);
    }
    return { bytes, identity: `${opened.dev}:${opened.ino}:${opened.size}` };
  } finally {
    closeSync(descriptor);
  }
}

function resolveExistingFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  return realpathSync(filePath);
}

function pathIdentity(filePath) {
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`definition input must be a regular non-symlink file: ${filePath}`);
  return `${info.dev}:${info.ino}`;
}

function directoryIdentity(directory) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`definition input must be a real directory: ${directory}`);
  return `${info.dev}:${info.ino}`;
}

export function resolveDeploymentEnvFile(projectDirectory, {
  envFile,
  runtimeDirectory = path.join(os.homedir(), '.config', 'sanctuary'),
} = {}) {
  if (envFile !== undefined) return resolveExistingFile(path.resolve(projectDirectory, envFile), 'explicit environment file');
  const candidates = [
    path.join(runtimeDirectory, 'sanctuary.env'),
    path.join(projectDirectory, '.env'),
    path.join(projectDirectory, '.env.local'),
  ];
  const candidate = candidates.find((entry) => existsSync(entry));
  if (!candidate) throw new Error(`environment file not found; checked: ${candidates.join(', ')}`);
  return resolveExistingFile(candidate, 'environment file');
}

function selectedComposeFiles(projectDirectory, { installMode, monitoring, tor, customOverlays }) {
  const files = [path.join(projectDirectory, 'docker-compose.yml')];
  if (installMode === 'offline') files.push(path.join(projectDirectory, 'docker/compose/offline-core.yml'));
  if (monitoring) {
    files.push(path.join(projectDirectory, 'docker/compose/monitoring.yml'));
    if (installMode === 'offline') files.push(path.join(projectDirectory, 'docker/compose/offline-monitoring.yml'));
  }
  if (tor) {
    files.push(path.join(projectDirectory, 'docker/compose/tor.yml'));
    if (installMode === 'offline') files.push(path.join(projectDirectory, 'docker/compose/offline-tor.yml'));
  }
  return [...files, ...customOverlays.map((entry) => path.resolve(projectDirectory, entry))];
}

function assertIdentityFields({ ownerId, release, commit, policyDigest, contextFingerprint }) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(ownerId)) throw new Error('ownerId has an invalid format');
  if (typeof release !== 'string' || release.length === 0 || release.length > 128) throw new Error('release has an invalid format');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('commit must be a full lowercase Git commit');
  for (const [name, value] of Object.entries({ policyDigest, contextFingerprint })) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a SHA-256 digest`);
  }
}

function snapshotName(index, sourcePath) {
  const extension = path.extname(sourcePath) || '.yml';
  return `compose/${String(index).padStart(2, '0')}-${sha256(Buffer.from(sourcePath)).slice(0, 16)}${extension}`;
}

export function resolveDeploymentDefinition({
  projectDirectory,
  envFile,
  runtimeDirectory,
  composeProjectName,
  installMode = 'online',
  monitoring = false,
  tor = false,
  mcp = false,
  customOverlays = [],
  customOverlayPolicy = {},
  ownerId,
  release,
  commit,
  policyDigest,
  contextFingerprint,
}) {
  if (!INSTALL_MODES.has(installMode)) throw new Error('installMode must be online or offline');
  if (![monitoring, tor, mcp].every((entry) => typeof entry === 'boolean')) throw new Error('feature selections must be booleans');
  if (!Array.isArray(customOverlays)) throw new Error('customOverlays must be an array');
  assertIdentityFields({ ownerId, release, commit, policyDigest, contextFingerprint });

  const projectRoot = realpathSync(path.resolve(projectDirectory));
  const projectName = composeProjectName ?? path.basename(projectRoot).toLowerCase();
  if (!PROJECT_NAME.test(projectName)) throw new Error('composeProjectName has an invalid format');
  const resolvedEnvFile = resolveDeploymentEnvFile(projectRoot, { envFile, runtimeDirectory });
  const files = selectedComposeFiles(projectRoot, { installMode, monitoring, tor, customOverlays });
  const resolvedFiles = files.map((candidate) => resolveExistingFile(candidate, 'Compose definition'));
  if (new Set(resolvedFiles).size !== resolvedFiles.length) throw new Error('Compose definition files must not contain duplicates');
  const snapshots = resolvedFiles.map((sourcePath, index) => {
    const { bytes, identity } = stableRead(sourcePath);
    const classification = validateOverlay(projectRoot, sourcePath, bytes, {
      ...customOverlayPolicy,
      allowCustom: index >= files.length - customOverlays.length,
    });
    return {
      sourcePath,
      sourceIdentity: identity,
      snapshotPath: snapshotName(index, sourcePath),
      sha256: sha256(bytes),
      kind: classification.kind,
      bytes,
    };
  });
  const profiles = mcp ? ['mcp'] : [];
  for (const profile of profiles) if (!PROFILE_NAME.test(profile)) throw new Error(`invalid Compose profile: ${profile}`);
  const definition = {
    definitionVersion: 1,
    ownerId,
    release,
    commit,
    projectDirectory: projectRoot,
    projectDirectoryIdentity: directoryIdentity(projectRoot),
    composeProjectName: projectName,
    envFile: resolvedEnvFile,
    envFileIdentity: pathIdentity(resolvedEnvFile),
    installMode,
    profiles,
    overlays: snapshots.map(({ sourcePath, sourceIdentity, snapshotPath, sha256: digest, kind }) => ({
      sourcePath, sourceIdentity, snapshotPath, sha256: digest, kind,
    })),
    policyDigest,
    contextFingerprint,
  };
  return { definition: { ...definition, definitionDigest: canonicalSha256(definition) }, snapshots };
}

export function composeArguments(definition, { snapshotRoot, verifyInputs = true } = {}) {
  if (verifyInputs) {
    if (realpathSync(definition.projectDirectory) !== definition.projectDirectory) throw new Error('deployment project directory identity changed');
    if (directoryIdentity(definition.projectDirectory) !== definition.projectDirectoryIdentity) throw new Error('deployment project directory identity changed');
    if (pathIdentity(definition.envFile) !== definition.envFileIdentity) throw new Error('deployment environment file identity changed');
  }
  const overlays = definition.overlays.map((overlay) => (
    snapshotRoot ? path.join(snapshotRoot, overlay.snapshotPath) : overlay.sourcePath
  ));
  const args = ['--project-directory', definition.projectDirectory, '--env-file', definition.envFile, '-p', definition.composeProjectName];
  for (const overlay of overlays) args.push('-f', overlay);
  for (const profile of definition.profiles) args.push('--profile', profile);
  return args;
}

export function diagnoseLegacyDeployment(projectDirectory, options = {}) {
  try {
    const bundle = resolveDeploymentDefinition({ ...options, projectDirectory });
    return { state: 'legacy-unregistered', adoptable: false, definition: bundle.definition };
  } catch (error) {
    return { state: 'ambiguous', adoptable: false, error: error.message };
  }
}
