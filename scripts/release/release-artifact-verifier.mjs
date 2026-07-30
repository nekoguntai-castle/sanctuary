#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateStrictImages } from './release-image-evidence.mjs';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA_RE = /^[a-f0-9]{40}$/;
const TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const SAFE_REF_RE = /^[A-Za-z0-9._/@:+-]+$/;
const ALLOWED_ARTIFACT_TYPES = new Set([
  'checksum-file',
  'container-image',
  'install-script',
  'offline-bundle',
  'release-notes',
  'source-archive',
]);
const SIGNATURE_FORMATS = new Set(['openssl-rsa-sha256', 'gpg', 'cosign', 'sigstore-bundle']);
const REQUIRED_STABLE_TYPES = [
  'checksum-file',
  'offline-bundle',
  'source-archive',
  'install-script',
  'release-notes',
];
const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

export class ReleaseArtifactVerificationError extends Error {
  constructor(errors) {
    super(`release artifact verification failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    this.name = 'ReleaseArtifactVerificationError';
    this.errors = errors;
  }
}

export function verifyReleaseArtifacts(inputOptions = {}) {
  const options = normalizeOptions(inputOptions);
  const errors = [];
  const manifest = readManifest(options.manifestPath, errors);
  if (!manifest) {
    throw new ReleaseArtifactVerificationError(errors);
  }

  validateManifestIdentity(manifest, errors);
  const artifacts = validateArtifactList(manifest, errors);
  const context = { ...options, releaseTag: manifest.release?.tag ?? '' };
  const checksumCoverage = collectChecksumCoverage(artifacts, context, errors);
  const localRefs = [];

  for (const artifact of artifacts) {
    validateArtifact(artifact, context, errors, localRefs);
  }

  validateChecksumCoverage(localRefs, checksumCoverage, errors);
  validateStrictStable(manifest, artifacts, checksumCoverage, context, errors);
  validateStrictImages(artifacts, context.strictImages, errors);

  if (options.verifyImageDigests) {
    verifyPublishedImageDigests(artifacts, errors);
  }

  if (errors.length > 0) {
    throw new ReleaseArtifactVerificationError(errors);
  }

  return {
    artifactsChecked: artifacts.length,
    localFilesChecked: localRefs.length,
    checksumEntries: checksumCoverage.entries.size,
  };
}

function normalizeOptions(options) {
  const manifestPath = path.resolve(options.manifestPath ?? 'release-manifest.json');
  const baseDir = path.resolve(options.baseDir || path.dirname(manifestPath));
  return {
    manifestPath,
    baseDir,
    publicKeyPath: options.publicKeyPath ? path.resolve(options.publicKeyPath) : '',
    strictStable: Boolean(options.strictStable),
    strictImages: Boolean(options.strictImages),
    verifyImageDigests: Boolean(options.verifyImageDigests),
  };
}

function readManifest(manifestPath, errors) {
  if (!existsSync(manifestPath)) {
    errors.push(`manifest not found: ${manifestPath}`);
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    errors.push(`manifest is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateManifestIdentity(manifest, errors) {
  requireNumber(manifest.schema, 1, 'manifest.schema', errors);
  requireString(manifest.release?.tag, 'manifest.release.tag', errors, TAG_RE);
  requireString(manifest.release?.version, 'manifest.release.version', errors, VERSION_RE);
  requireString(manifest.release?.commit, 'manifest.release.commit', errors, COMMIT_SHA_RE);
  requireEnum(manifest.release?.stability, ['stable', 'prerelease'], 'manifest.release.stability', errors);

  if (manifest.release?.tag && manifest.release?.version) {
    requireEqual(manifest.release.version, manifest.release.tag.slice(1), 'manifest release tag/version', errors);
  }
  if (manifest.release?.tag && manifest.release?.stability) {
    requireEqual(manifest.release.stability, isStableTag(manifest.release.tag) ? 'stable' : 'prerelease', 'manifest release stability', errors);
  }
  if (manifest.builder) {
    validateBuilder(manifest.builder, 'manifest.builder', errors);
  }
}

function validateArtifactList(manifest, errors) {
  if (!Array.isArray(manifest.artifacts)) {
    errors.push('manifest.artifacts must be an array');
    return [];
  }
  return manifest.artifacts;
}

function validateArtifact(artifact, context, errors, localRefs) {
  const label = artifactLabel(artifact);
  requireString(artifact.name, `${label}.name`, errors);
  requireEnum(artifact.type, [...ALLOWED_ARTIFACT_TYPES], `${label}.type`, errors);

  if (artifact.builder) {
    validateBuilder(artifact.builder, `${label}.builder`, errors);
  }
  if (artifact.path) {
    localRefs.push(verifyLocalReference(artifact.path, artifact.sha256, `${label}.path`, context, errors));
  }
  validateSignature(artifact.signature, `${label}.signature`, artifact.path, context, errors);
  validateNestedReference(artifact.sbom, `${label}.sbom`, context, errors, localRefs);
  validateNestedReference(artifact.provenance, `${label}.provenance`, context, errors, localRefs);
  validateNestedReference(artifact.attestation, `${label}.attestation`, context, errors, localRefs);

  if (artifact.type === 'container-image') {
    validateContainerImage(artifact, context, errors);
  }
  if (artifact.type === 'offline-bundle') {
    requireString(artifact.platform, `${label}.platform`, errors, /^linux\/(?:amd64|arm64)$/);
  }
}

function validateContainerImage(artifact, context, errors) {
  const label = artifactLabel(artifact);
  requireString(artifact.image, `${label}.image`, errors, SAFE_REF_RE);
  requireString(artifact.tag, `${label}.tag`, errors, TAG_RE);
  requireString(artifact.digest, `${label}.digest`, errors, SHA256_DIGEST_RE);
  if (artifact.tag && context.releaseTag) {
    requireEqual(artifact.tag, context.releaseTag, `${label}.tag`, errors);
  }
  if (artifact.platforms !== undefined) {
    validateContainerPlatforms(artifact.platforms, label, errors);
  }
}

function validateContainerPlatforms(platforms, label, errors) {
  if (!Array.isArray(platforms)) {
    errors.push(`${label}.platforms must be an array when present`);
    return;
  }
  for (const platform of platforms) {
    requireString(platform.platform, `${label}.platforms[].platform`, errors, /^linux\/(?:amd64|arm64)$/);
    requireString(platform.digest, `${label}.platforms[].digest`, errors, SHA256_DIGEST_RE);
  }
}

function validateBuilder(builder, label, errors) {
  requireString(builder.workflow, `${label}.workflow`, errors, /^[A-Za-z0-9._/@:+-]+$/);
  requireString(builder.runId, `${label}.runId`, errors, /^[A-Za-z0-9._-]+$/);
}

function validateNestedReference(ref, label, context, errors, localRefs) {
  if (ref === undefined) {
    return;
  }
  if (!isRecord(ref)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (ref.path) {
    localRefs.push(verifyLocalReference(ref.path, ref.sha256, `${label}.path`, context, errors));
  } else if (ref.uri) {
    requireString(ref.uri, `${label}.uri`, errors, /^https?:\/\/[^\s]+$/);
  } else {
    errors.push(`${label} must include path or uri`);
  }
}

function validateSignature(signature, label, signedPath, context, errors) {
  if (signature === undefined) {
    return;
  }
  if (!isRecord(signature)) {
    errors.push(`${label} must be an object`);
    return;
  }

  requireEnum(signature.format, [...SIGNATURE_FORMATS], `${label}.format`, errors);
  const sigRef = verifyLocalReference(signature.path, signature.sha256, `${label}.path`, context, errors);
  const signedRef = signedPath ? resolveLocalPath(signedPath, `${label}.signedPath`, context, errors) : null;
  if (signature.format === 'openssl-rsa-sha256' && signedRef && sigRef) {
    verifyOpenSslSignature(signedRef.resolved, sigRef.resolved, context.publicKeyPath, label, errors);
  }
}

function verifyLocalReference(relativePath, expectedSha, label, context, errors) {
  const resolved = resolveLocalPath(relativePath, label, context, errors);
  if (!resolved) {
    return null;
  }
  if (!existsSync(resolved.resolved) || !statSync(resolved.resolved).isFile()) {
    errors.push(`${label} file is missing: ${resolved.relative}`);
    return { ...resolved, sha256: expectedSha ?? '' };
  }
  if (expectedSha !== undefined) {
    requireString(expectedSha, `${label}.sha256`, errors, SHA256_RE);
    const actualSha = sha256File(resolved.resolved);
    if (actualSha !== expectedSha) {
      errors.push(`${label} checksum mismatch for ${resolved.relative}: expected ${expectedSha}, got ${actualSha}`);
    }
  }
  return { ...resolved, sha256: expectedSha ?? '' };
}

function resolveLocalPath(relativePath, label, context, errors) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    errors.push(`${label} must be a non-empty relative path`);
    return null;
  }
  if (path.isAbsolute(relativePath)) {
    errors.push(`${label} must be relative, not absolute`);
    return null;
  }

  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) {
    errors.push(`${label} must stay inside the release artifact directory`);
    return null;
  }

  const resolved = path.resolve(context.baseDir, normalized);
  if (!isInsideDirectory(resolved, context.baseDir)) {
    errors.push(`${label} escaped the release artifact directory`);
    return null;
  }
  return { relative: stripDotSlash(normalized), resolved };
}

function collectChecksumCoverage(artifacts, context, errors) {
  const entries = new Map();
  let signedChecksumFiles = 0;

  for (const artifact of artifacts.filter((candidate) => candidate.type === 'checksum-file')) {
    const label = artifactLabel(artifact);
    const ref = artifact.path ? verifyLocalReference(artifact.path, artifact.sha256, `${label}.path`, context, errors) : null;
    if (ref) {
      addChecksumEntries(ref.resolved, entries, errors);
    }
    if (artifact.signature) {
      signedChecksumFiles += 1;
    }
  }

  return { entries, signedChecksumFiles };
}

function addChecksumEntries(filePath, entries, errors) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }
    const match = line.match(/^([a-f0-9]{64})\s+[* ]?(.+)$/);
    if (!match) {
      errors.push(`${path.basename(filePath)}:${index + 1} is not a valid sha256sum line`);
      return;
    }
    entries.set(stripDotSlash(match[2].trim()), match[1]);
  });
}

function validateChecksumCoverage(localRefs, checksumCoverage, errors) {
  for (const ref of localRefs.filter(Boolean)) {
    if (isChecksumOrSignature(ref.relative)) {
      continue;
    }
    const coveredSha = checksumCoverage.entries.get(ref.relative);
    if (!coveredSha) {
      errors.push(`${ref.relative} is not covered by a signed checksum file`);
    } else if (ref.sha256 && coveredSha !== ref.sha256) {
      errors.push(`${ref.relative} checksum file entry ${coveredSha} does not match manifest sha256 ${ref.sha256}`);
    }
  }
}

function validateStrictStable(manifest, artifacts, checksumCoverage, context, errors) {
  if (!context.strictStable || !isStableTag(manifest.release?.tag ?? '')) {
    return;
  }

  for (const requiredType of REQUIRED_STABLE_TYPES) {
    requireArtifactType(artifacts, requiredType, errors);
  }
  if (checksumCoverage.signedChecksumFiles < 1) {
    errors.push('stable releases require at least one signed checksum-file artifact');
  }
  if (!hasVerifiableChecksumSignature(artifacts)) {
    errors.push('stable releases require an openssl-rsa-sha256 signature on a checksum-file artifact');
  }
  if (!manifest.builder) {
    errors.push('stable releases require manifest.builder workflow/runId evidence');
  }
  requireNamedContainer(artifacts, 'frontend', errors);
  requireNamedContainer(artifacts, 'backend', errors);
  for (const artifact of artifacts) {
    validateStrictStableArtifact(artifact, errors);
  }
}

function validateStrictStableArtifact(artifact, errors) {
  const label = artifactLabel(artifact);
  if (artifact.type === 'container-image') {
    requireContainerEvidence(artifact, label, errors);
  }
  if (artifact.type === 'offline-bundle') {
    requireLocalEvidence(artifact.sbom, `${label}.sbom`, errors);
    requireLocalEvidence(artifact.provenance, `${label}.provenance`, errors);
  }
}

function requireContainerEvidence(artifact, label, errors) {
  requireLocalEvidence(artifact.sbom, `${label}.sbom`, errors);
  if (!artifact.provenance && !artifact.attestation) {
    errors.push(`${label} requires provenance or attestation evidence`);
  }
  if (artifact.provenance) {
    requireLocalEvidence(artifact.provenance, `${label}.provenance`, errors);
  }
  if (artifact.attestation) {
    requireLocalEvidence(artifact.attestation, `${label}.attestation`, errors);
  }
  for (const platform of REQUIRED_PLATFORMS) {
    if (!artifact.platforms?.some((entry) => entry.platform === platform && SHA256_DIGEST_RE.test(entry.digest ?? ''))) {
      errors.push(`${label} requires ${platform} image digest evidence`);
    }
  }
}

function requireLocalEvidence(ref, label, errors) {
  if (!isRecord(ref) || !ref.path || !ref.sha256) {
    errors.push(`${label} must be a local path with sha256`);
  }
}

function requireArtifactType(artifacts, type, errors) {
  if (!artifacts.some((artifact) => artifact.type === type)) {
    errors.push(`stable releases require a ${type} artifact`);
  }
}

function hasVerifiableChecksumSignature(artifacts) {
  return artifacts.some((artifact) => artifact.type === 'checksum-file'
    && artifact.signature?.format === 'openssl-rsa-sha256');
}

function requireNamedContainer(artifacts, role, errors) {
  const hasContainer = artifacts.some((artifact) => artifact.type === 'container-image'
    && [artifact.name, artifact.image].some((value) => typeof value === 'string' && value.includes(role)));
  if (!hasContainer) {
    errors.push(`stable releases require a ${role} container-image artifact`);
  }
}

function verifyPublishedImageDigests(artifacts, errors) {
  for (const artifact of artifacts.filter((candidate) => candidate.type === 'container-image')) {
    const imageRef = `${artifact.image}:${artifact.tag}`;
    const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', imageRef, '--format', '{{json .Manifest.Digest}}'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      errors.push(`could not inspect published image ${imageRef}: ${result.stderr.trim() || result.stdout.trim()}`);
      continue;
    }
    const actual = result.stdout.trim().replace(/^"|"$/g, '');
    if (actual !== artifact.digest) {
      errors.push(`${imageRef} digest mismatch: expected ${artifact.digest}, got ${actual}`);
    }
  }
}

function verifyOpenSslSignature(signedPath, signaturePath, publicKeyPath, label, errors) {
  if (!publicKeyPath) {
    errors.push(`${label} uses openssl-rsa-sha256 but --public-key was not provided`);
    return;
  }
  if (!existsSync(publicKeyPath)) {
    errors.push(`${label} public key file is missing: ${publicKeyPath}`);
    return;
  }

  const result = spawnSync('openssl', ['dgst', '-sha256', '-verify', publicKeyPath, '-signature', signaturePath, signedPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    errors.push(`${label} signature verification failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

function requireString(value, label, errors, pattern = null) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`);
    return;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${label} has invalid value: ${value}`);
  }
}

function requireEnum(value, allowed, label, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${label} must be one of: ${allowed.join(', ')}`);
  }
}

function requireNumber(value, expected, label, errors) {
  if (value !== expected) {
    errors.push(`${label} must be ${expected}`);
  }
}

function requireEqual(actual, expected, label, errors) {
  if (actual !== expected) {
    errors.push(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function artifactLabel(artifact) {
  return `artifact[${artifact?.name ?? artifact?.type ?? 'unknown'}]`;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function isStableTag(tag) {
  return TAG_RE.test(tag) && !tag.includes('-');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInsideDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function stripDotSlash(value) {
  return value.replace(/^\.\//, '');
}

function isChecksumOrSignature(relativePath) {
  return relativePath === 'SHA256SUMS'
    || relativePath.endsWith('.sig')
    || relativePath.endsWith('.asc')
    || relativePath.endsWith('.minisig');
}
