import { canonicalSha256 } from './canonical-json.mjs';
import { URL } from 'node:url';

const DIGEST = /^[a-f0-9]{64}$/;
export const DOCKER_DAEMON_AUTHORITY_POLICY = 'sanctuary.docker-daemon-authority.v2';

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

function sortedUnique(values, label) {
  if (!Array.isArray(values) || values.length > 10_000
      || values.some((value) => typeof value !== 'string' || value.length === 0
        || value.length > 1024 || value.includes('\0'))) {
    throw new TypeError(`${label} must be a bounded string array`);
  }
  return [...new Set(values)].sort();
}

function nonemptyOutput(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} returned no authority evidence`);
  return value;
}

// Docker-compatible runner proxies may synthesize ID per request; the pinned
// local endpoint, context, version, and stable daemon configuration bind authority.
const VOLATILE_DAEMON_FIELDS = new Set([
  'systemtime', 'containers', 'containersrunning', 'containerspaused',
  'containersstopped', 'images', 'driverstatus', 'uptime', 'uptimens',
  'nfd', 'ngoroutines', 'neventslistener', 'systemstatus', 'warnings',
]);

function volatileDaemonField(currentPath, key, omitDockerRequestId) {
  const normalized = key.toLowerCase().replaceAll('_', '');
  return VOLATILE_DAEMON_FIELDS.has(normalized)
    || (omitDockerRequestId && currentPath === '' && key === 'ID');
}

function canonicalAuthority(output, label, {
  omitVolatile = false, omitDockerRequestId = false, unorderedArrayPaths = new Set(),
} = {}) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error(`${label} returned malformed JSON`); }
  const normalize = (value, currentPath = '') => {
    if (Array.isArray(value)) {
      const normalized = value.map((child) => normalize(child, `${currentPath}[]`));
      return unorderedArrayPaths.has(currentPath) ? normalized.sort((left, right) => (
        canonicalSha256(left).localeCompare(canonicalSha256(right))
      )) : normalized;
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !omitVolatile
        || !volatileDaemonField(currentPath, key, omitDockerRequestId))
      .map(([key, child]) => [key, normalize(child, currentPath ? `${currentPath}.${key}` : key)]));
  };
  return normalize(parsed);
}

const DAEMON_SET_ARRAYS = new Set([
  'Client.Components', 'Components', 'Server.Components',
  'Plugins.Authorization', 'Plugins.Log', 'Plugins.Network', 'Plugins.Volume',
  'SecurityOptions',
  'client.components', 'components', 'server.components',
  'plugins.authorization', 'plugins.log', 'plugins.network', 'plugins.volume',
  'securityOptions',
]);

function normalizeBoundSelectors(selectors) {
  const classes = [
    'compose_container', 'compose_network', 'compose_volume', 'oci_image', 'buildkit_cache',
  ];
  exactObject(selectors, classes, 'normalized Docker selectors');
  return Object.fromEntries(classes.map((resourceClass) => {
    const values = selectors[resourceClass];
    if (!Array.isArray(values) || values.length > 10_000
        || values.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) {
      throw new TypeError(`${resourceClass} selectors are invalid`);
    }
    return [resourceClass, [...values].sort((left, right) => (
      canonicalSha256(left).localeCompare(canonicalSha256(right))
    ))];
  }));
}

function podmanConnection(contextOutput) {
  const parsed = canonicalAuthority(contextOutput, 'podman connection authority', {
    unorderedArrayPaths: new Set(['']),
  });
  if (!Array.isArray(parsed)) throw new Error('podman connection authority must be an array');
  const defaults = parsed.filter((entry) => entry?.Default === true || entry?.default === true);
  const selected = defaults.length === 1 ? defaults[0] : (defaults.length === 0 && parsed.length === 1 ? parsed[0] : null);
  const name = selected?.Name ?? selected?.name;
  if (!selected || typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw new Error('podman default connection authority is ambiguous');
  }
  return { name, selected, parsed };
}

function localSocketUri(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
      || value.includes('\0') || /\s/.test(value)) {
    throw new Error(`${label} endpoint is invalid`);
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} endpoint is invalid`); }
  if (parsed.protocol !== 'unix:' || !parsed.pathname.startsWith('/')
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} remote or parameterized endpoints are unsupported`);
  }
  return value;
}

function dockerEndpoint(contextAuthority) {
  const endpoint = contextAuthority?.Endpoints?.docker;
  const tlsMaterial = contextAuthority?.TLSMaterial;
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)
      || !tlsMaterial || typeof tlsMaterial !== 'object' || Array.isArray(tlsMaterial)
      || Object.keys(tlsMaterial).length !== 0
      || ![undefined, false].includes(endpoint.SkipTLSVerify)) {
    throw new Error('docker TLS or remote context authority is unsupported');
  }
  return localSocketUri(endpoint.Host, 'docker');
}

function podmanEndpoint(selected) {
  const identity = selected?.Identity ?? selected?.identity;
  if (identity !== undefined && identity !== null && identity !== '') {
    throw new Error('podman identity-bearing connection authority is unsupported');
  }
  return localSocketUri(selected?.URI ?? selected?.uri, 'podman');
}

function endpointArgs(engine, endpoint) {
  return Object.freeze([engine === 'docker' ? '--host' : '--url', endpoint]);
}

function codeUnitCompare(left, right) {
  return left === right ? 0 : (left < right ? -1 : 1);
}

function diagnosticFieldName(prefix, key) {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(key)
    ? `${prefix}.${key}` : `${prefix}.[sha256:${canonicalSha256(key)}]`;
}

function authorityFieldDigests(prefix, value) {
  const fields = Object.entries(value).map(([key, child]) => [
    diagnosticFieldName(prefix, key), canonicalSha256(child),
  ]).sort(([left], [right]) => codeUnitCompare(left, right)).slice(0, 128);
  return Object.freeze(Object.fromEntries(fields));
}

export function observeResolvedDockerDaemonEvidence({ engine = 'docker', runCommand, engineGlobalArgs }) {
  if (!['docker', 'podman'].includes(engine)) throw new TypeError('execution engine must be docker or podman');
  if (typeof runCommand !== 'function') throw new TypeError('runCommand is required');
  if (!Array.isArray(engineGlobalArgs) || engineGlobalArgs.length !== 2
      || engineGlobalArgs[0] !== (engine === 'docker' ? '--host' : '--url')) {
    throw new TypeError('engineGlobalArgs must contain one immutable local endpoint');
  }
  localSocketUri(engineGlobalArgs[1], engine);
  const query = (args, operation) => nonemptyOutput(
    runCommand(engine, [...engineGlobalArgs, ...args], { operation }), operation,
  );
  const version = query(
    engine === 'docker' ? ['version', '--format', '{{json .}}'] : ['version', '--format', 'json'],
    `${engine} version authority`,
  );
  const info = query(
    engine === 'docker' ? ['info', '--format', '{{json .}}'] : ['info', '--format', 'json'],
    `${engine} daemon authority`,
  );
  const normalizedVersion = canonicalAuthority(version, `${engine} version authority`, {
    unorderedArrayPaths: DAEMON_SET_ARRAYS,
  });
  const normalizedInfo = canonicalAuthority(info, `${engine} daemon authority`, {
    omitVolatile: true, omitDockerRequestId: engine === 'docker',
    unorderedArrayPaths: DAEMON_SET_ARRAYS,
  });
  const fingerprint = canonicalSha256({
    policy: DOCKER_DAEMON_AUTHORITY_POLICY, engine, endpoint: engineGlobalArgs,
    versionDigest: canonicalSha256(normalizedVersion),
    daemonInfoDigest: canonicalSha256(normalizedInfo),
  });
  const fields = Object.freeze({
    ...authorityFieldDigests('version', normalizedVersion),
    ...authorityFieldDigests('info', normalizedInfo),
  });
  return Object.freeze({ policy: DOCKER_DAEMON_AUTHORITY_POLICY, fingerprint, fields });
}

export function observeResolvedDockerDaemon(options) {
  return observeResolvedDockerDaemonEvidence(options).fingerprint;
}

export function dockerDaemonDriftOperation(authority, current) {
  if (!authority.daemonEvidence?.fields) return 'Docker daemon/context authority';
  const fields = [...new Set([
    ...Object.keys(authority.daemonEvidence.fields), ...Object.keys(current.fields),
  ])].filter((field) => authority.daemonEvidence.fields[field] !== current.fields[field])
    .sort(codeUnitCompare).slice(0, 8);
  return fields.length > 0 ? `Docker daemon/context authority (${fields.join(', ')})`
    : 'Docker daemon/context authority';
}

export function resolveDockerDaemonContext({ engine = 'docker', runCommand }) {
  if (!['docker', 'podman'].includes(engine)) throw new TypeError('execution engine must be docker or podman');
  if (typeof runCommand !== 'function') throw new TypeError('runCommand is required');
  const queryBare = (args, operation) => nonemptyOutput(
    runCommand(engine, args, { operation }), operation,
  );
  let engineGlobalArgs;
  let contextAuthority;
  if (engine === 'docker') {
    const name = queryBare(['context', 'show'], 'docker context authority').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new Error('docker context name is invalid');
    contextAuthority = canonicalAuthority(
      queryBare(['context', 'inspect', name, '--format', '{{json .}}'], 'docker context inspect authority'),
      'docker context authority',
    );
    engineGlobalArgs = endpointArgs(engine, dockerEndpoint(contextAuthority));
  } else {
    const connections = queryBare(
      ['system', 'connection', 'list', '--format', 'json'], 'podman connection authority',
    );
    const selected = podmanConnection(connections);
    contextAuthority = selected.parsed;
    engineGlobalArgs = endpointArgs(engine, podmanEndpoint(selected.selected));
  }
  const daemonEvidence = observeResolvedDockerDaemonEvidence({ engine, runCommand, engineGlobalArgs });
  const daemonFingerprint = daemonEvidence.fingerprint;
  const fingerprint = canonicalSha256({
    engine,
    daemonFingerprint,
    contextDigest: canonicalSha256(contextAuthority),
  });
  return Object.freeze({
    engine, fingerprint, daemonFingerprint,
    daemonAuthorityPolicy: DOCKER_DAEMON_AUTHORITY_POLICY,
    daemonEvidence, engineGlobalArgs,
  });
}

export function observeDockerDaemonContext(options) {
  return resolveDockerDaemonContext(options).fingerprint;
}

export function buildCleanupExecutionContext({
  engine, daemonContextFingerprint, selectors, protectedProjects = [],
  dataVolumeNames = [], sharedImmutableIdentities = [], registrations = [],
  hostAuthorityDigest = null,
}) {
  if (!['docker', 'podman'].includes(engine)) throw new TypeError('execution engine must be docker or podman');
  if (!DIGEST.test(daemonContextFingerprint ?? '')) throw new TypeError('daemonContextFingerprint must be a digest');
  if (!Array.isArray(registrations) || registrations.length > 10_000) {
    throw new TypeError('registrations must be a bounded array');
  }
  const normalizedSelectors = normalizeBoundSelectors(selectors);
  const context = {
    engine,
    daemonContextFingerprint,
    selectorsDigest: canonicalSha256(normalizedSelectors),
    protectedProjects: sortedUnique(protectedProjects, 'protectedProjects'),
    dataVolumeNames: sortedUnique(dataVolumeNames, 'dataVolumeNames'),
    sharedImmutableIdentities: sortedUnique(sharedImmutableIdentities, 'sharedImmutableIdentities'),
    registrationSnapshotDigest: canonicalSha256([...registrations].sort((left, right) => (
      canonicalSha256(left).localeCompare(canonicalSha256(right))
    ))),
  };
  if (hostAuthorityDigest !== null) {
    if (!DIGEST.test(hostAuthorityDigest)) throw new TypeError('hostAuthorityDigest must be a digest');
    context.hostAuthorityDigest = hostAuthorityDigest;
  }
  const keys = [
    'engine', 'daemonContextFingerprint', 'selectorsDigest', 'protectedProjects',
    'dataVolumeNames', 'sharedImmutableIdentities', 'registrationSnapshotDigest',
  ];
  if (hostAuthorityDigest !== null) keys.push('hostAuthorityDigest');
  exactObject(context, keys, 'cleanup execution context');
  return Object.freeze({ context: Object.freeze(context), fingerprint: canonicalSha256(context) });
}

export function buildHostCleanupExecutionContext({ registrations = [], hostAuthorityDigest = null } = {}) {
  if (!Array.isArray(registrations) || registrations.length > 10_000) {
    throw new TypeError('registrations must be a bounded array');
  }
  if (hostAuthorityDigest !== null && !DIGEST.test(hostAuthorityDigest)) {
    throw new TypeError('hostAuthorityDigest must be a digest or null');
  }
  if (registrations.length > 0 && hostAuthorityDigest === null) {
    throw new TypeError('registered host cleanup requires helper authority');
  }
  const context = {
    engine: 'host',
    registrationSnapshotDigest: canonicalSha256([...registrations].sort((left, right) => (
      canonicalSha256(left).localeCompare(canonicalSha256(right))
    ))),
    hostAuthorityDigest,
  };
  exactObject(context, [
    'engine', 'registrationSnapshotDigest', 'hostAuthorityDigest',
  ], 'host cleanup execution context');
  return Object.freeze({ context: Object.freeze(context), fingerprint: canonicalSha256(context) });
}
