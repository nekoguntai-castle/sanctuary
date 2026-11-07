const EXPANDED_DEFAULT_CAPDROP = [
  'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'NET_BIND_SERVICE',
  'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_CHROOT'
];

export function requestBrowserEngineApi(socketPath, method, endpoint, payload, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: endpoint, method, headers: payload ? { 'content-type': 'application/json' } : {} }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`engine API ${method} ${endpoint} returned ${response.statusCode}: ${body.slice(0, 1000)}`));
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (error) { reject(new Error('engine API returned invalid JSON', { cause: error })); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`engine API ${method} ${endpoint} timed out`)));
    request.on('error', reject);
    request.end(payload ? JSON.stringify(payload) : undefined);
  });
}

function browserCommandError(reason) {
  return reason instanceof Error ? reason : new Error('docker command cancelled', { cause: reason });
}

export function runBrowserEngineCli(socket, args, { timeoutMs = args[0] === 'cp' ? 120_000 : 30_000, signal, maxBuffer = 16 * 1024 * 1024 } = {}) {
  if (signal?.aborted) return Promise.reject(browserCommandError(signal.reason));
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['--host', `unix://${socket}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure; let forceKill; let closeDeadline;
    const stop = error => {
      if (failure) return;
      failure = browserCommandError(error);
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        child.kill('SIGKILL');
        // SIGKILL cannot guarantee immediate kernel exit; never report cleanup success without close.
        closeDeadline = setTimeout(() => {
          clearTimeout(timeout); signal?.removeEventListener('abort', abort);
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          reject(new Error('docker child termination was not confirmed', { cause: failure }));
        }, 2_000);
      }, 2_000);
    };
    const timeout = setTimeout(() => stop(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`)), timeoutMs);
    const abort = () => stop(signal.reason ?? new Error('docker command cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (current, value) => {
      if (failure) return current;
      if (Buffer.byteLength(current + value, 'utf8') > maxBuffer) {
        stop(new Error(`docker ${args[0]} output exceeded ${maxBuffer} bytes`));
        return current;
      }
      return current + value;
    };
    child.stdout.setEncoding('utf8').on('data', value => { stdout = collect(stdout, value); });
    child.stderr.setEncoding('utf8').on('data', value => { stderr = collect(stderr, value); });
    // Spawn failures also emit close. Other errors must not bypass termination/close ownership.
    child.once('error', stop);
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(forceKill); clearTimeout(closeDeadline);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`docker ${args[0]} exited ${code}: ${stderr.slice(-2000)}`));
      else resolve({ stdout, stderr });
    });
  });
}

export const BROWSER_CONTAINER_RESOURCES = Object.freeze({
  Memory: 4_294_967_296,
  NanoCpus: 4_000_000_000,
  PidsLimit: 512,
  ShmSize: 536_870_912
});

const EXPECTED_TMPFS = Object.freeze({ '/tmp': 'rw,nosuid,nodev,size=536870912,mode=1777' });
const REQUIRED_TMPFS_TOKENS = ['rw', 'nosuid', 'nodev', 'size=536870912', 'mode=1777'];
const ALLOWED_TMPFS_NORMALIZATION_TOKENS = new Set(['rprivate', 'tmpcopyup']);

export function normalizeImageId(value) {
  if (typeof value !== 'string') return null;
  const match = /^(?:sha256:)?([a-f0-9]{64})$/i.exec(value);
  return match?.[1].toLowerCase() ?? null;
}

function validatePayloadInput({ image, user, command, env, labels, profile, networkMode, resources, allowImageId, readonlyRootfs, tmpfs }) {
  validateImage(image, allowImageId);
  validateUser(user);
  validateProfile(profile);
  validateNetworkMode(networkMode);
  validateCommandAndEnvironment(command, env, labels);
  validateResources(resources);
  validateReadonlyRootfs(readonlyRootfs, tmpfs);
}

function validateImage(image, allowImageId) {
  const immutableTag = /^.+@sha256:[a-f0-9]{64}$/.test(image ?? '');
  const immutableLocalId = allowImageId && /^sha256:[a-f0-9]{64}$/.test(image ?? '');
  if (!immutableTag && !immutableLocalId) throw new Error('child image must be immutable and digest-pinned');
}

function validateUser(user) {
  if (!/^[1-9]\d*:[1-9]\d*$/.test(user ?? '')) throw new Error('child user must be a non-root numeric UID:GID');
}

function validateProfile(profile) {
  if (!/^\/etc\/forgejo-runner\/browser-seccomp\/[a-f0-9]{64}\.json$/.test(profile ?? '')) throw new Error('seccomp policy must use a managed hash-named host path');
}

function validateNetworkMode(networkMode) {
  if (networkMode !== 'none' && !/^container:[a-f0-9]{12,64}$/i.test(networkMode ?? '')) throw new Error('child network must be none or share an owned container network namespace');
}

function validateCommandAndEnvironment(command, env, labels) {
  const commandIsValid = Array.isArray(command) && command.length > 0 && command.every(value => typeof value === 'string');
  const environmentIsValid = Array.isArray(env) && env.every(value => typeof value === 'string');
  const labelsAreValid = labels && typeof labels === 'object' && !Array.isArray(labels) && Object.values(labels).every(value => typeof value === 'string');
  if (!commandIsValid || !environmentIsValid || !labelsAreValid) throw new Error('child command, environment, or labels are malformed');
}

function validateResources(resources) {
  for (const [key, value] of Object.entries(resources)) {
    if (!['Memory', 'NanoCpus', 'PidsLimit', 'ShmSize'].includes(key) || !Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid child resource limit: ${key}`);
  }
}

function validateReadonlyRootfs(readonlyRootfs, tmpfs) {
  if (readonlyRootfs && JSON.stringify(tmpfs) !== JSON.stringify(EXPECTED_TMPFS)) throw new Error('readonly browser rootfs requires only the reviewed writable /tmp tmpfs');
  if (!readonlyRootfs && tmpfs !== undefined) throw new Error('tmpfs requires an explicitly readonly browser rootfs');
}

export function createSeccompBrowserPayload(input) {
  const { image, user, command, env = [], labels = {}, profile, networkMode, resources = BROWSER_CONTAINER_RESOURCES, readonlyRootfs = false } = input;
  validatePayloadInput({ ...input, env, labels, resources, readonlyRootfs });
  return {
    Image: image,
    User: user,
    Env: [...env],
    Cmd: [...command],
    Labels: { ...labels },
    HostConfig: {
      NetworkMode: networkMode,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges', `seccomp=${profile}`],
      ...(readonlyRootfs ? { ReadonlyRootfs: true, Tmpfs: EXPECTED_TMPFS } : {}),
      ...resources
    }
  };
}

function capabilityDropIsComplete(capDrop) {
  const expanded = capDrop.length === EXPANDED_DEFAULT_CAPDROP.length &&
    [...capDrop].sort().every((capability, index) => capability === [...EXPANDED_DEFAULT_CAPDROP].sort()[index]);
  return (capDrop.length === 1 && capDrop[0] === 'ALL') || expanded;
}

function containerMountsMatch(inspect, readonlyRootfs) {
  const mounts = inspect?.Mounts ?? [];
  if (!readonlyRootfs) return mounts.length === 0;
  return mounts.length === 0 || (mounts.length === 1 && mounts[0]?.Type === 'tmpfs' && mounts[0]?.Destination === '/tmp' && mounts[0]?.RW === true);
}

function tmpfsOptionsMatch(value) {
  if (typeof value !== 'string') return false;
  const tokens = value.split(',');
  const tokenSet = new Set(tokens);
  if (tokens.length !== tokenSet.size || REQUIRED_TMPFS_TOKENS.some(token => !tokenSet.has(token))) return false;
  return tokens.every(token => REQUIRED_TMPFS_TOKENS.includes(token) || ALLOWED_TMPFS_NORMALIZATION_TOKENS.has(token));
}

function hostTmpfsMatches(host, readonlyRootfs) {
  if (!readonlyRootfs) return host?.Tmpfs === undefined || host?.Tmpfs === null || Object.keys(host.Tmpfs).length === 0;
  const tmpfs = host?.Tmpfs;
  return tmpfs && typeof tmpfs === 'object' && !Array.isArray(tmpfs) && Object.keys(tmpfs).length === 1 && tmpfsOptionsMatch(tmpfs['/tmp']);
}

function hostIsolationMatches(host, networkMode) {
  return hostNetworkMatches(host, networkMode) && hostCapabilitiesAreRestricted(host) && hostNamespacesArePrivate(host) && hostMountsAreAbsent(host);
}

function hostNetworkMatches(host, networkMode) {
  return host?.NetworkMode === networkMode;
}

function hostCapabilitiesAreRestricted(host) {
  return !host?.CapAdd?.length && host?.Privileged !== true;
}

function hostNamespacesArePrivate(host) {
  return host?.PidMode !== 'host' && host?.IpcMode !== 'host';
}

function hostMountsAreAbsent(host) {
  return !host?.Binds?.length && !host?.Mounts?.length;
}

function hostSecurityMatches(host, profile) {
  const options = host?.SecurityOpt ?? [];
  return options.length === 2 && options.includes('no-new-privileges') && options.includes(`seccomp=${profile}`);
}

function hostFilesystemMatches(host, readonlyRootfs) {
  return (host?.ReadonlyRootfs === true) === readonlyRootfs &&
    hostTmpfsMatches(host, readonlyRootfs);
}

function hostResourcesMatch(host, resources) {
  return Object.entries(resources).every(([key, value]) => host?.[key] === value);
}

function identityMatches(inspect, imageId, user) {
  const actualImage = normalizeImageId(inspect?.Image);
  const expectedImage = normalizeImageId(imageId);
  return Boolean(actualImage && expectedImage && actualImage === expectedImage && inspect?.Config?.User === user);
}

export function assertSeccompBrowserContainer(inspect, { imageId, user, profile, networkMode, resources = BROWSER_CONTAINER_RESOURCES, readonlyRootfs = false, tmpfs }) {
  const host = inspect?.HostConfig;
  const capDrop = Array.isArray(host?.CapDrop) ? host.CapDrop : [];
  validateReadonlyRootfs(readonlyRootfs, tmpfs);
  const error = () => new Error(`browser container inspect violates the no-mount seccomp policy (image=${inspect?.Image ?? '<missing>'}, expectedImage=${imageId ?? '<missing>'}, user=${inspect?.Config?.User}, network=${host?.NetworkMode})`);
  if (!identityMatches(inspect, imageId, user)) throw error();
  if (!hostIsolationMatches(host, networkMode)) throw error();
  if (!capabilityDropIsComplete(capDrop)) throw error();
  if (!hostSecurityMatches(host, profile)) throw error();
  if (!hostFilesystemMatches(host, readonlyRootfs)) throw error();
  if (!containerMountsMatch(inspect, readonlyRootfs)) throw error();
  if (!hostResourcesMatch(host, resources)) throw error();
}
import { spawn } from 'node:child_process';
import http from 'node:http';
