import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { cleanupTrustPath, validateCleanupTrust } from './cleanup-trust.mjs';
import { PROTECTED_COMPOSE_PROJECTS } from './contracts.mjs';
import { sha256 } from './crypto.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';
import {
  ciAuthorityProvider, ciAuthorityRunAttempt, ciAuthorityRunId, ciAuthorityTempDir, ciTempDir,
} from '../ci/provider-context.mjs';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_CI_TRUST_MS = 24 * 60 * 60 * 1000;

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPrivateTree(directory, label) {
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-only and non-symlink`);
  }
  return resolved;
}

function cleanupProvider(environment) {
  const provider = ciAuthorityProvider(environment);
  const local = environment.SANCTUARY_LOCAL_CLEANUP_AUTHORITY === '1'
    && provider === 'local';
  if (provider === 'forgejo' || provider === 'github') return provider;
  return local ? 'local' : null;
}

function providerRunIdentity(provider, environment) {
  return provider === 'local'
    ? { runId: environment.SANCTUARY_LOCAL_CLEANUP_RUN_ID, runAttempt: '1' }
    : { runId: ciAuthorityRunId(environment), runAttempt: ciAuthorityRunAttempt(environment) };
}

function providerTempDirectory(provider, environment) {
  return provider === 'local' ? ciTempDir(environment) : ciAuthorityTempDir(environment);
}

function assertProviderContext(provider, runId, runAttempt, tempDirectory) {
  if (!provider || !ID.test(runId ?? '') || !ID.test(runAttempt ?? '')
      || typeof tempDirectory !== 'string' || tempDirectory === '') {
    throw new Error('ephemeral cleanup trust requires an exact provider or local-ephemeral context');
  }
}

export function ciCleanupProviderContext(environment = process.env) {
  const provider = cleanupProvider(environment);
  const { runId, runAttempt } = providerRunIdentity(provider, environment);
  assertProviderContext(provider, runId, runAttempt, providerTempDirectory(provider, environment));
  const identityDigest = canonicalSha256({ provider, runId, runAttempt });
  return Object.freeze({ provider, runId, runAttempt, identityDigest });
}

function containsRunScope(value, runId, runAttempt) {
  const token = `${runId}-${runAttempt}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[._:-])${token}(?=$|[._:-])`).test(value);
}

function checkoutCommit(checkoutRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkoutRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function assertCheckoutBinding(checkoutRoot, deploymentManifest) {
  const policyPath = path.join(checkoutRoot, 'config/resource-ownership-contract.json');
  if (sha256(readFileSync(policyPath)) !== deploymentManifest.policyDigest) {
    throw new Error('CI cleanup deployment policy does not match the checkout');
  }
  if (checkoutCommit(checkoutRoot) !== deploymentManifest.commit) {
    throw new Error('CI cleanup deployment commit does not match the checkout');
  }
}

function validateTrustValues(options) {
  const {
    deploymentManifest, operationRunId,
    authorizationFingerprint, evidenceFingerprint, coordinatorStateDigest,
  } = options;
  validateArtifact(deploymentManifest);
  if (deploymentManifest.artifactType !== 'deployment_manifest'
      || !ID.test(operationRunId ?? '')
      || !DIGEST.test(authorizationFingerprint ?? '')
      || !DIGEST.test(evidenceFingerprint ?? '')
      || authorizationFingerprint === evidenceFingerprint
      || !DIGEST.test(coordinatorStateDigest ?? '')) {
    throw new Error('CI cleanup trust inputs are invalid');
  }
}

function resolveTrustPaths(options, provider) {
  const { runtimeDirectory, checkoutRoot, keyRoot } = options;
  const runnerTemp = realpathSync(providerTempDirectory(provider, process.env));
  const runtime = assertPrivateTree(runtimeDirectory, 'cleanup runtime');
  const keys = assertPrivateTree(keyRoot, 'cleanup key root');
  if (!isWithin(runtime, runnerTemp) || !isWithin(keys, runtime)
      || isWithin(runtime, realpathSync(checkoutRoot))) {
    throw new Error('CI cleanup runtime and keys must be beneath runner temp and outside checkout');
  }
  return runtime;
}

function assertRunScopedIdentities(options, context) {
  const { deploymentManifest, operationRunId } = options;
  if (![deploymentManifest.deploymentId, deploymentManifest.composeProjectName, operationRunId]
    .every((value) => containsRunScope(value, context.runId, context.runAttempt))) {
    throw new Error('CI cleanup identities do not bind the provider run and attempt');
  }
}

function assertDeletableDeployment(options) {
  const { deploymentManifest, checkoutRoot } = options;
  if (PROTECTED_COMPOSE_PROJECTS.includes(deploymentManifest.composeProjectName)) {
    throw new Error('CI cleanup trust refuses protected projects');
  }
  assertCheckoutBinding(path.resolve(checkoutRoot), deploymentManifest);
}

function assertStoredProviderAuthority(runtime, deploymentManifest, context) {
  const store = new DeploymentStore({
    runtimeDirectory: runtime, deploymentId: deploymentManifest.deploymentId,
  });
  const identity = store.readIdentity();
  const stored = store.readManifest(deploymentManifest.generation, { verifySnapshots: true });
  if (identity.identityVersion !== 2 || identity.deploymentScope !== 'ci_ephemeral'
      || identity.ciRunIdentityDigest !== context.identityDigest
      || identity.composeProjectName !== deploymentManifest.composeProjectName
      || stored.manifestDigest !== canonicalSha256(deploymentManifest)) {
    throw new Error('CI cleanup deployment store does not bind the provider authority');
  }
}

function validateInputs(options, context) {
  validateTrustValues(options);
  const runtime = resolveTrustPaths(options, context.provider);
  assertRunScopedIdentities(options, context);
  assertDeletableDeployment(options);
  assertStoredProviderAuthority(runtime, options.deploymentManifest, context);
  return { runtime };
}

export function installEphemeralCiCleanupTrust(options) {
  const context = ciCleanupProviderContext();
  const { runtime } = validateInputs(options, context);
  const duration = options.validForMs ?? 6 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(duration) || duration < 60_000 || duration > MAX_CI_TRUST_MS) {
    throw new Error('CI cleanup trust validity must be from one minute through 24 hours');
  }
  const filePath = cleanupTrustPath(runtime, options.deploymentManifest.deploymentId);
  if (existsSync(filePath)) {
    const bytes = readExternalFile(filePath, { checkoutRoot: options.checkoutRoot, maxBytes: 16 * 1024 });
    const trust = parseStrictJson(bytes);
    if (!canonicalJson(trust).equals(bytes)) throw new Error('existing CI cleanup trust is not canonical');
    validateCleanupTrust(trust, { deploymentId: options.deploymentManifest.deploymentId, now: options.now ?? new Date() });
    const expected = {
      authorizationFingerprints: [options.authorizationFingerprint],
      evidenceFingerprints: [options.evidenceFingerprint],
      authority: {
        authorityKind: context.provider === 'local' ? 'local_ephemeral' : 'ci_ephemeral', ...context,
        deploymentManifestDigest: canonicalSha256(options.deploymentManifest),
        operationRunId: options.operationRunId,
        coordinatorStateDigest: options.coordinatorStateDigest,
        composeProjectName: options.deploymentManifest.composeProjectName,
      },
    };
    for (const [key, value] of Object.entries(expected)) {
      if (!canonicalJson(trust[key]).equals(canonicalJson(value))) {
        throw new Error('existing CI cleanup trust does not match coordinator authority');
      }
    }
    return Object.freeze({ filePath, trust });
  }
  const validFrom = options.now ?? new Date();
  const trust = {
    trustVersion: 2, deploymentId: options.deploymentManifest.deploymentId,
    validFrom: validFrom.toISOString(),
    validUntil: new Date(validFrom.getTime() + duration).toISOString(),
    authorizationFingerprints: [options.authorizationFingerprint],
    evidenceFingerprints: [options.evidenceFingerprint],
    authority: {
      authorityKind: context.provider === 'local' ? 'local_ephemeral' : 'ci_ephemeral', ...context,
      deploymentManifestDigest: canonicalSha256(options.deploymentManifest),
      operationRunId: options.operationRunId,
      coordinatorStateDigest: options.coordinatorStateDigest,
      composeProjectName: options.deploymentManifest.composeProjectName,
    },
  };
  validateCleanupTrust(trust, { deploymentId: trust.deploymentId, now: validFrom });
  writeExternalFileAtomic(filePath, canonicalJson(trust), { checkoutRoot: options.checkoutRoot });
  return Object.freeze({ filePath, trust });
}
