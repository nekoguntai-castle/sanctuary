#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { createEphemeralCleanupSigners } from './cleanup-ephemeral-signers.mjs';
import { publicKeyFingerprint } from './crypto.mjs';
import {
  executePreparedOperatorRecovery, prepareOperatorRecoverySession,
} from './operator-recovery-coordinator.mjs';
import { observeForgejoProviderCorrelation } from './operator-recovery-correlation.mjs';
import { verifyOperatorRecoveryClosed } from './operator-recovery-observer.mjs';
import { validateOperatorRecoveryContract } from './operator-recovery-contract.mjs';
import {
  buildVerifiedOperatorRecoveryCloseout, observeOperatorRecoveryIncident,
  validateOperatorRecoveryIncidentObservation, verifyOperatorRecoveryExecutionPair,
  verifyPersistedOperatorRecoveryCloseout,
} from './operator-recovery-closeout.mjs';
import {
  signOperatorRecoveryArtifact, verifyOperatorRecoveryArtifact,
} from './operator-recovery-evidence.mjs';
import {
  incidentTarget, validateOperatorRecoveryIncident,
} from './operator-recovery-incident.mjs';
import { buildHostRecoveryTrust, validateHostRecoveryTrust } from './operator-recovery-schema.mjs';
import {
  loadExecutedOperatorRecovery, loadOperatorRecoveryIncidentArtifact,
  loadPreparedOperatorRecovery, persistExecutedOperatorRecovery,
  persistOperatorRecoveryIncidentArtifact, persistPreparedOperatorRecovery,
} from './operator-recovery-store.mjs';
import { readExternalFile, readPrivateKeyFile, writeExternalFileAtomic } from './safe-file.mjs';

const COMMANDS = new Set(['provision', 'begin', 'prepare', 'execute', 'recover', 'closeout']);
const MAX_PROVIDER_BODY_BYTES = 5 * 1024 * 1024;

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function privateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved
      || (info.mode & 0o077) !== 0) throw new Error('operator recovery directory must be owner-only');
  return resolved;
}

export function readOperatorRecoveryRequest(filename, maxBytes = 1024 * 1024) {
  const requestPath = path.resolve(filename);
  const before = lstatSync(requestPath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error('operator recovery request must be a bounded regular non-symlink file');
  }
  const descriptor = openSync(requestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('operator recovery request identity changed while opening');
    }
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw new Error('operator recovery request is oversized');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(descriptor);
    const final = lstatSync(requestPath);
    if (opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== total
        || after.size !== total || opened.mtimeMs !== after.mtimeMs
        || opened.ctimeMs !== after.ctimeMs || final.dev !== opened.dev
        || final.ino !== opened.ino || final.size !== total) {
      throw new Error('operator recovery request changed while reading');
    }
    return parseStrictJson(Buffer.concat(chunks, total));
  } finally { closeSync(descriptor); }
}

export function validateOperatorRecoveryRuntimeDirectory(directory, checkoutRoot) {
  const resolved = path.resolve(directory);
  const relative = path.relative(realpathSync(checkoutRoot), resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('operator recovery runtime must be outside the checkout');
  }
  return privateDirectory(resolved);
}

function keyMaterial(keyRoot, checkoutRoot) {
  const readRole = (role) => ({
    privateKey: readPrivateKeyFile(path.join(keyRoot, role, 'private.pem'), { checkoutRoot }),
    publicKey: readExternalFile(path.join(keyRoot, role, 'public.pem'), { checkoutRoot }),
  });
  return { authorizationKeys: readRole('authorization'), evidenceKeys: readRole('evidence') };
}

function writeTrust(trustPath, trust, checkoutRoot) {
  if (existsSync(trustPath)) throw new Error('operator recovery trust already exists');
  writeExternalFileAtomic(path.resolve(trustPath), canonicalJson(trust), { checkoutRoot });
}

function provision(request, checkoutRoot) {
  exact(request, ['keyRoot', 'trustPath', 'trustId', 'validUntil'], 'provision request');
  privateDirectory(path.dirname(request.trustPath));
  const signers = createEphemeralCleanupSigners({ keyRoot: request.keyRoot, checkoutRoot });
  const trust = buildHostRecoveryTrust({
    trustId: request.trustId, validFrom: new Date().toISOString(), validUntil: request.validUntil,
    authorizationFingerprints: [signers.authorization.fingerprint],
    evidenceFingerprints: [signers.evidence.fingerprint],
  });
  writeTrust(request.trustPath, trust, checkoutRoot);
  return { state: 'provisioned', trustDigest: canonicalSha256(trust), trustPath: path.resolve(request.trustPath) };
}

function credentialToken(providerInstance) {
  const explicit = process.env.SANCTUARY_FORGE_TOKEN || process.env.FORGEJO_TOKEN;
  if (explicit) return explicit;
  const url = new URL(providerInstance);
  const filled = spawnSync('git', ['credential', 'fill'], {
    input: `protocol=${url.protocol.slice(0, -1)}\nhost=${url.host}\n\n`,
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5_000,
  });
  if (filled.status !== 0) throw new Error('Forgejo credential is unavailable');
  const token = filled.stdout.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('Forgejo credential is unavailable');
  return token;
}

async function providerJson(url, token, signal) {
  let response;
  try { response = await fetch(url, { headers: { Authorization: `token ${token}` }, signal }); }
  catch { throw new Error('Forgejo provider request is unavailable'); }
  return readBoundedForgejoJsonResponse(response);
}

export async function readBoundedForgejoJsonResponse(response) {
  if (!response.ok) throw new Error('Forgejo provider request was refused');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BODY_BYTES) {
    throw new Error('Forgejo provider response is oversized');
  }
  if (!response.body) throw new Error('Forgejo provider response is unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PROVIDER_BODY_BYTES) {
      await reader.cancel();
      throw new Error('Forgejo provider response is oversized');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8');
  try { return JSON.parse(text); } catch { throw new Error('Forgejo provider response is malformed'); }
}

export function paginateForgejoResponse(value, itemsKey, cursor, pageSize, state, stateKey) {
  const items = value?.[itemsKey];
  const total = value?.total_count;
  if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < items.length) {
    throw new Error('Forgejo provider pagination is malformed');
  }
  const page = cursor === null ? 1 : Number(cursor);
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Forgejo provider cursor is malformed');
  const prior = state.get(stateKey) ?? { nextPage: 1, seen: 0, total };
  if (page !== prior.nextPage || total !== prior.total) {
    throw new Error('Forgejo provider pagination changed during observation');
  }
  const seen = prior.seen + items.length;
  if (seen > total || (seen < total && items.length === 0)) {
    throw new Error('Forgejo provider pagination is incomplete');
  }
  const complete = seen === total;
  state.set(stateKey, { nextPage: page + 1, seen, total });
  return { items, nextCursor: complete ? null : String(page + 1), complete };
}

export function forgejoJobsResult(value, cursor) {
  if (cursor !== null || !Array.isArray(value)) {
    throw new Error('Forgejo jobs response is malformed');
  }
  return { items: value, nextCursor: null, complete: true };
}

export function forgejoRunsPaginationKey(commit, workflowId, jobName) {
  return `runs:${commit}:${workflowId}:${jobName}`;
}

function providerCallbacks(provider) {
  const token = credentialToken(provider.providerInstance);
  const pagination = new Map();
  const base = `${provider.providerInstance.replace(/\/$/, '')}/api/v1/repos/${encodeURIComponent(provider.repository.split('/')[0])}/${encodeURIComponent(provider.repository.split('/')[1])}`;
  const query = (pathname, values, signal) => {
    const url = new URL(`${base}/${pathname}`);
    Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return providerJson(url, token, signal);
  };
  return {
    fetchRunsPage: async ({ commit, workflowId, jobName, cursor, pageSize, signal }) => paginateForgejoResponse(
      await query('actions/runs', {
        head_sha: commit, workflow_id: workflowId, page: cursor ?? 1, limit: pageSize,
      }, signal), 'workflow_runs', cursor, pageSize, pagination,
      forgejoRunsPaginationKey(commit, workflowId, jobName),
    ),
    fetchRunDetail: ({ runId, signal }) => providerJson(`${base}/actions/runs/${runId}`, token, signal),
    fetchJobsPage: async ({ runId, cursor, signal }) => forgejoJobsResult(
      await query(`actions/runs/${runId}/jobs`, {}, signal), cursor,
    ),
  };
}

function readTrust(request, checkoutRoot, recover = false) {
  const trust = parseStrictJson(readExternalFile(path.resolve(request.trustPath), { checkoutRoot }));
  validateHostRecoveryTrust(trust, recover ? {} : { now: new Date() });
  return trust;
}

function correlationOptions(provider, now) {
  exact(provider, ['providerInstance', 'repository', 'queries', 'taskSnapshot'], 'provider request');
  return {
    providerInstance: provider.providerInstance, repository: provider.repository,
    queries: provider.queries, taskSnapshot: provider.taskSnapshot,
    ...providerCallbacks(provider), now,
  };
}

function recoveryContract(request) {
  const contract = validateOperatorRecoveryContract(
    parseStrictJson(readFileSync(path.resolve(request.recoveryContractPath))),
  );
  const incident = readIncident(request);
  incidentTarget(incident, {
    target: request.target, expectedCounts: request.expectedCounts,
    sourceCommit: request.sourceCommit, sourceExecutionId: request.sourceExecutionId,
  });
  return contract;
}

function readIncident(request) {
  return validateOperatorRecoveryIncident(
    parseStrictJson(readFileSync(path.resolve(request.incidentContractPath))),
  );
}

function signedIncidentObservation(incident, evidenceKeys) {
  const observation = observeOperatorRecoveryIncident({ incident });
  const fingerprint = publicKeyFingerprint(evidenceKeys.publicKey);
  return signOperatorRecoveryArtifact(observation, {
    privateKey: evidenceKeys.privateKey, publicKey: evidenceKeys.publicKey,
    expectedFingerprint: fingerprint,
    validate: (value) => validateOperatorRecoveryIncidentObservation(value, { incident }),
  });
}

function assertTrustedEvidenceKeys(trust, evidenceKeys) {
  const fingerprint = publicKeyFingerprint(evidenceKeys.publicKey);
  if (!trust.evidenceFingerprints.includes(fingerprint)
      || publicKeyFingerprint(evidenceKeys.privateKey) !== fingerprint) {
    throw new Error('operator recovery incident evidence key is not trusted');
  }
}

function verifiedBefore(request, checkoutRoot, incident, evidenceKeys) {
  return verifyOperatorRecoveryArtifact(loadOperatorRecoveryIncidentArtifact(
    request.incidentEvidenceDirectory, 'sentinel-before.json', checkoutRoot,
  ), {
    publicKey: evidenceKeys.publicKey,
    acceptedFingerprints: [publicKeyFingerprint(evidenceKeys.publicKey)],
    validate: (value) => validateOperatorRecoveryIncidentObservation(value, { incident }),
  });
}

function beginIncident(request, checkoutRoot) {
  exact(request, [
    'incidentEvidenceDirectory', 'keyRoot', 'trustPath', 'incidentContractPath',
  ], 'operator recovery begin request');
  privateDirectory(request.incidentEvidenceDirectory);
  const incident = readIncident(request);
  const trust = readTrust(request, checkoutRoot);
  const keys = keyMaterial(request.keyRoot, checkoutRoot);
  assertTrustedEvidenceKeys(trust, keys.evidenceKeys);
  const envelope = signedIncidentObservation(incident, keys.evidenceKeys);
  persistOperatorRecoveryIncidentArtifact(
    request.incidentEvidenceDirectory, 'sentinel-before.json', envelope, checkoutRoot,
  );
  return {
    state: 'incident_started', incidentId: incident.incidentId,
    sentinelDigest: envelope.artifact.sentinelCoreDigest,
    evidenceDirectory: path.resolve(request.incidentEvidenceDirectory),
  };
}

async function runRecovery(request, checkoutRoot, command) {
  exact(request, [
    'runtimeDirectory', 'evidenceDirectory', 'keyRoot', 'trustPath', 'target',
    'expectedCounts', 'sourceCommit', 'sourceExecutionId', 'recoveryContractPath',
    'incidentContractPath', 'incidentEvidenceDirectory', 'provider', 'ttlMs',
  ], 'operator recovery request');
  validateOperatorRecoveryRuntimeDirectory(request.runtimeDirectory, checkoutRoot);
  privateDirectory(request.evidenceDirectory);
  const contract = recoveryContract(request);
  const recover = command === 'recover';
  const trust = readTrust(request, checkoutRoot, recover);
  const keys = keyMaterial(request.keyRoot, checkoutRoot);
  const incident = readIncident(request);
  const before = verifiedBefore(request, checkoutRoot, incident, keys.evidenceKeys);
  const current = observeOperatorRecoveryIncident({ incident });
  if (current.sentinelCoreDigest !== before.sentinelCoreDigest) {
    throw new Error('operator recovery exclusion sentinels changed before execution');
  }
  if (command === 'prepare') {
    const providerOptions = correlationOptions(request.provider, () => new Date());
    const prepared = await prepareOperatorRecoverySession({
      trust, ...keys, target: request.target, expectedCounts: request.expectedCounts,
      policyDigest: canonicalSha256(contract), sourceCommit: request.sourceCommit,
      sourceExecutionId: request.sourceExecutionId,
      observeCorrelation: () => observeForgejoProviderCorrelation(providerOptions),
      ttlMs: request.ttlMs,
    });
    persistPreparedOperatorRecovery(request.evidenceDirectory, prepared, checkoutRoot);
    return {
      state: 'prepared', project: prepared.scopeEnvelope.artifact.project,
      scopeDigest: prepared.scopeEnvelope.artifactDigest,
      approvalDigest: prepared.approvalEnvelope.artifactDigest,
      actionCount: prepared.approvalEnvelope.artifact.actions.length,
      evidenceDirectory: path.resolve(request.evidenceDirectory),
    };
  }
  const bundlePath = path.join(path.resolve(request.evidenceDirectory), 'execution-bundle.json');
  if (recover && existsSync(bundlePath)) {
    const pair = loadExecutedOperatorRecovery(request.evidenceDirectory, checkoutRoot);
    const verified = verifyOperatorRecoveryExecutionPair({
      pair, incident, trust, authorizationPublicKey: keys.authorizationKeys.publicKey,
      evidencePublicKey: keys.evidenceKeys.publicKey,
    });
    return {
      state: verified.receipt.state, receiptDigest: pair.receiptEnvelope.artifactDigest,
      journalDigest: verified.receipt.journalDigest,
      evidenceDirectory: path.resolve(request.evidenceDirectory),
    };
  }
  const providerOptions = correlationOptions(request.provider, () => new Date());
  const prepared = loadPreparedOperatorRecovery(request.evidenceDirectory, checkoutRoot);
  const executed = await executePreparedOperatorRecovery({
    prepared, trust, ...keys, correlationOptions: providerOptions,
    runtimeDirectory: request.runtimeDirectory, recover,
  });
  persistExecutedOperatorRecovery(request.evidenceDirectory, executed, checkoutRoot);
  return {
    state: executed.receipt.state,
    receiptDigest: executed.receiptEnvelope.artifactDigest,
    journalDigest: executed.journalDigest,
    evidenceDirectory: path.resolve(request.evidenceDirectory),
  };
}

async function closeoutIncident(request, checkoutRoot) {
  exact(request, [
    'incidentEvidenceDirectory', 'stackEvidenceDirectories', 'keyRoot', 'trustPath',
    'incidentContractPath',
  ], 'operator recovery closeout request');
  if (!Array.isArray(request.stackEvidenceDirectories)
      || request.stackEvidenceDirectories.length !== 4
      || new Set(request.stackEvidenceDirectories.map((directory) => path.resolve(directory))).size !== 4) {
    throw new Error('operator recovery closeout requires exactly four unique evidence directories');
  }
  const incident = readIncident(request);
  const trust = readTrust(request, checkoutRoot);
  const keys = keyMaterial(request.keyRoot, checkoutRoot);
  assertTrustedEvidenceKeys(trust, keys.evidenceKeys);
  const beforeObservationEnvelope = loadOperatorRecoveryIncidentArtifact(
    request.incidentEvidenceDirectory, 'sentinel-before.json', checkoutRoot,
  );
  const pairs = request.stackEvidenceDirectories.map((directory) => (
    loadExecutedOperatorRecovery(directory, checkoutRoot)
  ));
  const closeoutPath = path.join(path.resolve(request.incidentEvidenceDirectory), 'closeout.json');
  const afterPath = path.join(path.resolve(request.incidentEvidenceDirectory), 'sentinel-after.json');
  if (existsSync(closeoutPath)) {
    const afterObservationEnvelope = loadOperatorRecoveryIncidentArtifact(
      request.incidentEvidenceDirectory, 'sentinel-after.json', checkoutRoot,
    );
    const closeoutEnvelope = loadOperatorRecoveryIncidentArtifact(
      request.incidentEvidenceDirectory, 'closeout.json', checkoutRoot,
    );
    const verified = verifyPersistedOperatorRecoveryCloseout({
      closeoutEnvelope, incident, trust,
      authorizationPublicKey: keys.authorizationKeys.publicKey,
      evidenceKeys: keys.evidenceKeys, pairs, beforeObservationEnvelope, afterObservationEnvelope,
    });
    return {
      state: 'closed', incidentId: verified.incidentId,
      closeoutDigest: closeoutEnvelope.artifactDigest,
      evidenceDirectory: path.resolve(request.incidentEvidenceDirectory),
    };
  }
  const freshAfterObservationEnvelope = signedIncidentObservation(incident, keys.evidenceKeys);
  let afterObservationEnvelope = freshAfterObservationEnvelope;
  if (existsSync(afterPath)) {
    afterObservationEnvelope = loadOperatorRecoveryIncidentArtifact(
      request.incidentEvidenceDirectory, 'sentinel-after.json', checkoutRoot,
    );
    const prior = verifyOperatorRecoveryArtifact(afterObservationEnvelope, {
      publicKey: keys.evidenceKeys.publicKey,
      acceptedFingerprints: trust.evidenceFingerprints,
      validate: (value) => validateOperatorRecoveryIncidentObservation(value, { incident }),
    });
    if (prior.daemonContextFingerprint !== freshAfterObservationEnvelope.artifact.daemonContextFingerprint
        || prior.sentinelCoreDigest !== freshAfterObservationEnvelope.artifact.sentinelCoreDigest
        || prior.outOfScopeObservationDigest
          !== freshAfterObservationEnvelope.artifact.outOfScopeObservationDigest) {
      throw new Error('persisted operator recovery after-observation no longer matches the host');
    }
  }
  for (const target of incident.targets) {
    const closed = await verifyOperatorRecoveryClosed({
      target: { project: target.project, deploymentId: target.deploymentId, ownerId: target.ownerId },
      daemonContextFingerprint: afterObservationEnvelope.artifact.daemonContextFingerprint,
    });
    if (closed.closed !== true) throw new Error(`operator recovery target is not closed: ${target.project}`);
  }
  const closeout = buildVerifiedOperatorRecoveryCloseout({
    incident, trust, authorizationPublicKey: keys.authorizationKeys.publicKey,
    evidenceKeys: keys.evidenceKeys, pairs, beforeObservationEnvelope,
    afterObservationEnvelope, finalizedAt: new Date().toISOString(),
  });
  persistOperatorRecoveryIncidentArtifact(
    request.incidentEvidenceDirectory, 'sentinel-after.json', afterObservationEnvelope, checkoutRoot,
  );
  persistOperatorRecoveryIncidentArtifact(
    request.incidentEvidenceDirectory, 'closeout.json', closeout, checkoutRoot,
  );
  return {
    state: 'closed', incidentId: incident.incidentId,
    closeoutDigest: closeout.artifactDigest,
    evidenceDirectory: path.resolve(request.incidentEvidenceDirectory),
  };
}

export async function runOperatorRecoveryCli(argv = process.argv.slice(2), checkoutRoot = process.cwd()) {
  const [command, requestPath, ...extra] = argv;
  if (!COMMANDS.has(command) || !requestPath || extra.length > 0) {
    throw new Error('usage: operator-recovery-cli.mjs <provision|begin|prepare|execute|recover|closeout> <request.json>');
  }
  const request = readOperatorRecoveryRequest(requestPath);
  if (command === 'provision') return provision(request, checkoutRoot);
  if (command === 'begin') return beginIncident(request, checkoutRoot);
  if (command === 'closeout') return closeoutIncident(request, checkoutRoot);
  return runRecovery(request, checkoutRoot, command);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOperatorRecoveryCli().then((result) => process.stdout.write(canonicalJson(result)))
    .catch((error) => { process.stderr.write(`operator recovery refused: ${error.message}\n`); process.exitCode = 1; });
}
