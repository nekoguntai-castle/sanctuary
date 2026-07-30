const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const REQUIRED_ROLES = ['frontend', 'backend'];
const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

export function validateStrictImages(artifacts, enabled, errors) {
  if (!enabled) {
    return;
  }

  const containerArtifacts = artifacts.filter((artifact) => artifact.type === 'container-image');
  for (const role of REQUIRED_ROLES) {
    validateRoleEvidence(containerArtifacts, role, errors);
  }
}

function validateRoleEvidence(containerArtifacts, role, errors) {
  const matches = containerArtifacts.filter((artifact) => containerHasRole(artifact, role));
  if (matches.length === 0) {
    errors.push(`strict image verification requires one ${role} container-image artifact`);
    return;
  }
  if (matches.length > 1) {
    errors.push(`strict image verification requires exactly one ${role} container-image artifact; found ${matches.length}`);
    return;
  }
  validateImageEvidence(matches[0], errors);
}

function validateImageEvidence(artifact, errors) {
  const label = artifactLabel(artifact);
  if (!SHA256_DIGEST_RE.test(artifact.digest ?? '')) {
    errors.push(`${label}.digest must contain a sha256 manifest digest`);
  }
  if (!Array.isArray(artifact.platforms)) {
    errors.push(`${label}.platforms must contain linux/amd64 and linux/arm64 digest evidence`);
    return;
  }

  for (const requiredPlatform of REQUIRED_PLATFORMS) {
    validatePlatformEvidence(artifact.platforms, requiredPlatform, label, errors);
  }
}

function validatePlatformEvidence(platforms, requiredPlatform, label, errors) {
  const matches = platforms.filter((entry) => entry?.platform === requiredPlatform);
  if (matches.length === 0) {
    errors.push(`${label} requires ${requiredPlatform} image digest evidence`);
  } else if (matches.length > 1) {
    errors.push(`${label} has duplicate ${requiredPlatform} image digest evidence`);
  } else if (!SHA256_DIGEST_RE.test(matches[0].digest ?? '')) {
    errors.push(`${label} requires a valid ${requiredPlatform} image digest`);
  }
}

function containerHasRole(artifact, role) {
  return [artifact.name, artifact.image].some((value) => {
    if (typeof value !== 'string') {
      return false;
    }
    return value.toLowerCase().split(/[^a-z0-9]+/).includes(role);
  });
}

function artifactLabel(artifact) {
  return `artifact[${artifact?.name ?? artifact?.type ?? 'unknown'}]`;
}
