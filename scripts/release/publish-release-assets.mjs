#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  createReadStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  collectManifestAssetNames,
  sha256File,
  validateAssetDirectory,
  validateManifestIdentity,
} from './release-asset-common.mjs';
import { verifyReleaseArtifacts } from './release-artifact-verifier.mjs';

const MAX_GITHUB_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * The provider values that have a safe default, and what it is.
 *
 * These must stay identical to the defaults `publish-release.sh` applies to the
 * same names. The two commands are halves of one publication flow --
 * `release:publish` creates the Release objects, `release:publish-assets`
 * attaches the bytes -- so an operator who can run the first from a clean
 * checkout has to be able to run the second the same way. Only the shell half
 * had them, and cutting v0.8.62 needed three inline `export`s for no reason
 * beyond that gap. `tests/release/publish-release-assets.test.mjs` reads the
 * shell source and fails if the pair drifts apart again.
 */
export const PROVIDER_CONFIG_DEFAULTS = Object.freeze({
  FORGEJO_OWNER: 'nekoguntai-castle',
  FORGEJO_REPO: 'sanctuary',
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_OWNER: 'nekoguntai-castle',
  GITHUB_REPO: 'sanctuary',
});

/** Ordered as `publish-release.sh` lists them, so both report a gap the same way. */
export const PROVIDER_VALUES = Object.freeze([
  'FORGEJO_URL',
  'FORGEJO_OWNER',
  'FORGEJO_REPO',
  'FORGEJO_TOKEN',
  'GITHUB_API_URL',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_RELEASE_TOKEN',
]);

/**
 * The two values that reach an `Authorization` header, and the characters
 * `publish-release.sh`'s `reject_unsafe_tokens` refuses in them. Quote and
 * backslash are legal header bytes, so nothing downstream would catch a token
 * mangled by a stray shell quote -- it would surface as an authentication
 * failure against the wrong string.
 */
const CREDENTIAL_VALUES = Object.freeze(['FORGEJO_TOKEN', 'GITHUB_RELEASE_TOKEN']);
const UNSAFE_CREDENTIAL_CHARACTERS = /["\\\r\n]/;

export async function publishReleaseAssets(input) {
  const options = normalizeOptions(input);
  bindManifestToAssetDirectory(options);
  if (!options.dryRun && options.receiptPath) prepareReceiptPath(options.receiptPath);
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  validateManifestIdentity(manifest, options.tag, options.commit);
  verifyReleaseArtifacts({
    manifestPath: options.manifestPath,
    baseDir: options.assetDir,
    publicKeyPath: options.publicKey,
    strictStable: true,
  });
  verifySignature(options.manifestPath, `${options.manifestPath}.sig`, options.publicKey);

  const expectedNames = collectManifestAssetNames(manifest);
  const inventory = validateAssetDirectory(options.assetDir, expectedNames);
  const localAssets = [...inventory.names].map((name) => {
    const filePath = path.join(inventory.root, name);
    const size = statSync(filePath).size;
    if (size >= MAX_GITHUB_ASSET_BYTES) throw new Error(`GitHub asset must be smaller than 2 GiB: ${name}`);
    return { name, filePath, size, sha256: sha256File(filePath) };
  });
  localAssets.sort((left, right) => publicationOrder(left.name) - publicationOrder(right.name) || left.name.localeCompare(right.name));

  const providers = await loadProviders(options);
  const preflightAssets = new Map();
  for (const provider of providers) {
    const assets = await preflightProvider(provider, localAssets);
    preflightAssets.set(provider.name, assets);
  }
  const receipt = { schema: 1, release: manifest.release, dryRun: options.dryRun, providers: {} };
  for (const provider of providers) {
    receipt.providers[provider.name] = await reconcileProvider(provider, localAssets, options.dryRun, preflightAssets.get(provider.name));
  }
  if (!options.dryRun && options.receiptPath) {
    writeReceiptAtomically(options.receiptPath, receipt);
  }
  return receipt;
}

function bindManifestToAssetDirectory(options) {
  const expected = path.join(realpathSync(options.assetDir), 'release-manifest.json');
  if (realpathSync(options.manifestPath) !== expected || realpathSync(`${options.manifestPath}.sig`) !== `${expected}.sig`) {
    throw new Error('verified manifest and signature must be the canonical files in the release asset directory');
  }
}

function prepareReceiptPath(receiptPath) {
  const parent = path.dirname(receiptPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  accessSync(parent, constants.W_OK);
}

function writeReceiptAtomically(receiptPath, receipt) {
  const temporary = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, receiptPath);
}

function normalizeOptions(input) {
  const required = ['tag', 'commit', 'assetDir', 'manifestPath', 'publicKey'];
  for (const name of required) if (!input[name]) throw new Error(`${name} is required`);
  const config = resolveProviderConfig({ configPath: input.configPath, config: input.config });
  const normalized = {
    ...input,
    config,
    assetDir: path.resolve(input.assetDir),
    manifestPath: path.resolve(input.manifestPath),
    publicKey: path.resolve(input.publicKey),
    receiptPath: input.receiptPath ? path.resolve(input.receiptPath) : '',
    dryRun: Boolean(input.dryRun),
  };
  if (normalized.receiptPath) {
    const receiptRelative = path.relative(normalized.assetDir, normalized.receiptPath);
    if (receiptRelative === '' || (!receiptRelative.startsWith('..') && !path.isAbsolute(receiptRelative))) {
      throw new Error('publication receipt must be outside the immutable release asset directory');
    }
  }
  return normalized;
}

/**
 * Resolve the eight provider values the way `publish-release.sh` does.
 *
 * Precedence is defaults, then the environment, then the config file, then
 * explicit overrides. The file outranking the environment looks backwards for a
 * CLI, but it is what the shell half does -- it inherits the environment and
 * then `source`s the file over it -- and the two commands publishing under
 * different owners is a worse outcome than either ordering. A file named with
 * `--config` is a deliberate act; a variable still exported in the operator's
 * shell usually is not.
 *
 * A blank never wins, because `${VAR:-default}` falls back when a variable is
 * unset *or* empty. A non-string is refused outright rather than skipped: it
 * would otherwise fall through to a default and publish somewhere the caller
 * never named.
 *
 * Only these eight names are carried forward. The previous spread copied the
 * whole process environment into the options object; nothing ever read the
 * rest, and a release credential should travel no further than the request that
 * needs it.
 */
export function resolveProviderConfig({ configPath = '', config: overrides, env = process.env } = {}) {
  const layers = [PROVIDER_CONFIG_DEFAULTS, env, readConfig(configPath), overrides ?? {}];
  const config = {};
  for (const name of PROVIDER_VALUES) {
    for (const layer of layers) {
      if (!layer || !Object.hasOwn(layer, name)) continue;
      const value = layer[name];
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string') throw new Error(`invalid ${name}: expected a string, received ${typeof value}`);
      config[name] = value;
    }
  }
  const missing = PROVIDER_VALUES.filter((name) => !config[name]);
  if (missing.length > 0) throw new Error(`missing required configuration: ${missing.join(' ')}`);
  for (const name of CREDENTIAL_VALUES) {
    if (UNSAFE_CREDENTIAL_CHARACTERS.test(config[name])) throw new Error(`unsafe value for ${name}`);
  }
  return config;
}

function readConfig(configPath) {
  if (!configPath) return {};
  const values = {};
  for (const rawLine of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`unsupported release config line for ${line.split('=')[0]}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/[\r\n]/.test(value)) throw new Error(`unsafe value for ${match[1]}`);
    values[match[1]] = value;
  }
  return values;
}

async function loadProviders(options) {
  const config = options.config;
  const forgeBase = `${config.FORGEJO_URL.replace(/\/$/, '')}/api/v1/repos/${encodeURIComponent(config.FORGEJO_OWNER)}/${encodeURIComponent(config.FORGEJO_REPO)}`;
  const githubBase = `${config.GITHUB_API_URL.replace(/\/$/, '')}/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(config.GITHUB_REPO)}`;
  const forgeRelease = await apiJson(`${forgeBase}/releases/tags/${encodeURIComponent(options.tag)}`, config.FORGEJO_TOKEN, 'Forgejo');
  const githubRelease = await apiJson(`${githubBase}/releases/tags/${encodeURIComponent(options.tag)}`, config.GITHUB_RELEASE_TOKEN, 'GitHub');
  const forgeCommit = await resolveExactTagCommit('forgejo', forgeBase, options.tag, config.FORGEJO_TOKEN);
  const githubCommit = await resolveExactTagCommit('github', githubBase, options.tag, config.GITHUB_RELEASE_TOKEN);
  if (forgeCommit !== options.commit || githubCommit !== options.commit) {
    throw new Error(`provider tag parity does not match ${options.commit}`);
  }
  validateRemoteRelease(forgeRelease, options, 'Forgejo');
  validateRemoteRelease(githubRelease, options, 'GitHub');
  return [
    { name: 'forgejo', token: config.FORGEJO_TOKEN, apiBase: forgeBase, release: forgeRelease, uploadUrl: `${forgeBase}/releases/${forgeRelease.id}/assets` },
    { name: 'github', token: config.GITHUB_RELEASE_TOKEN, apiBase: githubBase, release: githubRelease, uploadUrl: githubUploadUrl(githubRelease, config) },
  ];
}

async function resolveExactTagCommit(provider, base, tag, token) {
  const route = provider === 'github' ? 'git/ref' : 'git/refs';
  const ref = await apiJson(`${base}/${route}/tags/${encodeURIComponent(tag)}`, token, provider);
  const candidate = Array.isArray(ref) ? ref.find((entry) => entry.ref === `refs/tags/${tag}`) : ref;
  if (!candidate || candidate.ref !== `refs/tags/${tag}`) throw new Error(`${provider} exact tag ref is missing: ${tag}`);
  let object = candidate.object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
    const annotated = await apiJson(`${base}/git/tags/${object.sha}`, token, provider);
    object = annotated.object;
  }
  if (object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha ?? '')) {
    throw new Error(`${provider} tag does not peel to a commit: ${tag}`);
  }
  return object.sha;
}

function validateRemoteRelease(release, options, provider) {
  const expectedPrerelease = options.tag.includes('-');
  if (release.tag_name !== options.tag || Boolean(release.prerelease) !== expectedPrerelease || release.draft === true) {
    throw new Error(`${provider} Release metadata does not match ${options.tag}`);
  }
}

function githubUploadUrl(release, config) {
  const parsed = new URL(release.upload_url.replace(/\{.*$/, ''));
  const expectedHost = new URL(config.GITHUB_API_URL).hostname === 'api.github.com' ? 'uploads.github.com' : new URL(config.GITHUB_API_URL).hostname;
  if (parsed.hostname !== expectedHost) throw new Error(`refusing unexpected GitHub upload host: ${parsed.hostname}`);
  return parsed.toString();
}

async function preflightProvider(provider, localAssets) {
  const remoteAssets = await listAssets(provider);
  rejectDuplicatesAndUnexpected(provider, remoteAssets, localAssets);
  for (const local of localAssets) {
    const remote = remoteAssets.find((asset) => asset.name === local.name);
    if (remote) await requireRemoteMatch(provider, remote, local);
  }
  return remoteAssets;
}

async function reconcileProvider(provider, localAssets, dryRun, initialAssets) {
  let remoteAssets = initialAssets;
  const receipts = [];
  for (const local of localAssets) {
    let remote = remoteAssets.find((asset) => asset.name === local.name);
    if (remote) {
      await requireRemoteMatch(provider, remote, local);
    } else if (!dryRun) {
      await uploadWithReconciliation(provider, local);
      remoteAssets = await listAssets(provider);
      remote = remoteAssets.find((asset) => asset.name === local.name);
      if (!remote) throw new Error(`${provider.name} did not expose uploaded asset ${local.name}`);
      await requireRemoteMatch(provider, remote, local);
    }
    receipts.push({ name: local.name, id: remote?.id ?? null, size: local.size, sha256: local.sha256, status: remote ? 'verified' : 'missing-dry-run' });
  }
  if (!dryRun && receipts.some((item) => item.status !== 'verified')) throw new Error(`${provider.name} publication did not converge`);
  return { releaseId: provider.release.id, assets: receipts };
}

async function listAssets(provider) {
  const assets = [];
  for (let page = 1; ; page += 1) {
    const join = provider.name === 'github' ? '?' : '?';
    const url = `${provider.apiBase}/releases/${provider.release.id}/assets${join}limit=100&per_page=100&page=${page}`;
    const batch = await apiJson(url, provider.token, provider.name);
    if (!Array.isArray(batch)) throw new Error(`${provider.name} returned an invalid asset inventory`);
    assets.push(...batch);
    if (batch.length < 100) return assets;
  }
}

function rejectDuplicatesAndUnexpected(provider, remoteAssets, localAssets) {
  const expected = new Set(localAssets.map((asset) => asset.name));
  const seen = new Set();
  for (const asset of remoteAssets) {
    if (seen.has(asset.name)) throw new Error(`${provider.name} has duplicate asset name: ${asset.name}`);
    seen.add(asset.name);
    if (!expected.has(asset.name)) throw new Error(`${provider.name} has unexpected release asset: ${asset.name}`);
  }
}

async function requireRemoteMatch(provider, remote, local) {
  if (remote.state && remote.state !== 'uploaded') throw new Error(`${provider.name} asset ${local.name} is not fully uploaded`);
  if (Number(remote.size) !== local.size) throw new Error(`${provider.name} asset size differs: ${local.name}`);
  const advertised = typeof remote.digest === 'string' ? remote.digest.replace(/^sha256:/, '') : '';
  const actual = advertised || await downloadSha256(provider, remote);
  if (actual !== local.sha256) throw new Error(`${provider.name} asset checksum differs: ${local.name}`);
}

async function uploadWithReconciliation(provider, local) {
  const url = new URL(provider.uploadUrl);
  url.searchParams.set('name', local.name);
  let response;
  if (provider.name === 'github') {
    response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(provider.token, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(local.size) }),
        body: Readable.toWeb(createReadStream(local.filePath)),
        duplex: 'half',
        signal: AbortSignal.timeout(30 * 60 * 1000),
      }).catch(() => null);
  } else {
    const multipart = forgejoMultipart(local);
    response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(provider.token, multipart.headers),
        body: Readable.toWeb(multipart.body),
        duplex: 'half',
        signal: AbortSignal.timeout(30 * 60 * 1000),
      }).catch(() => null);
  }
  // A transport failure or non-201 can occur after the server commits the
  // upload. The mandatory re-list and hash check below is the only retry path.
  if (response && response.status !== 201) await response.text();
  const remote = (await listAssets(provider)).filter((asset) => asset.name === local.name);
  if (remote.length !== 1) throw new Error(`${provider.name} upload did not converge for ${local.name}; manual inspection required`);
  await requireRemoteMatch(provider, remote[0], local);
}

async function downloadSha256(provider, remote) {
  const url = provider.name === 'github'
    ? `${provider.apiBase}/releases/assets/${remote.id}`
    : forgejoDownloadUrl(provider, remote);
  const response = await fetchAssetDownload(provider, url);
  if (!response.ok) throw new Error(`${provider.name} asset download failed with HTTP ${response.status}`);
  const hash = createHash('sha256');
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchAssetDownload(provider, initialUrl) {
  const trustedOrigin = new URL(provider.apiBase).origin;
  let current = new URL(initialUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const trusted = current.origin === trustedOrigin;
    const headers = trusted ? authHeaders(provider.token, { Accept: 'application/octet-stream' }) : { Accept: 'application/octet-stream' };
    const response = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error(`${provider.name} asset redirect lacked a location`);
    if (redirects === 5) throw new Error(`${provider.name} asset download exceeded redirect limit`);
    current = validateAssetRedirect(provider, new URL(location, current));
  }
  throw new Error(`${provider.name} asset download exceeded redirect limit`);
}

function validateAssetRedirect(provider, redirect) {
  if (provider.name === 'github' && !/(^|\.)githubusercontent\.com$|(^|\.)github\.com$/.test(redirect.hostname)) {
    throw new Error(`refusing unexpected GitHub asset redirect host: ${redirect.hostname}`);
  }
  if (provider.name === 'forgejo' && redirect.origin !== new URL(provider.apiBase).origin) {
    throw new Error(`refusing unexpected Forgejo asset redirect origin: ${redirect.origin}`);
  }
  return redirect;
}

function forgejoDownloadUrl(provider, remote) {
  if (typeof remote.browser_download_url !== 'string' || !remote.browser_download_url) {
    throw new Error(`forgejo asset ${remote.name} lacked a download URL`);
  }
  const download = new URL(remote.browser_download_url);
  const expected = new URL(provider.apiBase);
  if (download.origin !== expected.origin) {
    throw new Error(`refusing unexpected Forgejo asset download origin: ${download.origin}`);
  }
  return download.href;
}

async function apiJson(url, token, provider) {
  const response = await fetch(url, { headers: authHeaders(token), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${provider} API request failed with HTTP ${response.status}`);
  return response.json();
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'sanctuary-release-operator', ...extra };
}

function forgejoMultipart(local) {
  const boundary = `sanctuary-release-${createHash('sha256').update(`${local.name}:${local.sha256}`).digest('hex').slice(0, 24)}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${local.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  async function* parts() {
    yield prefix;
    yield* createReadStream(local.filePath);
    yield suffix;
  }
  return {
    body: Readable.from(parts()),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(prefix.length + local.size + suffix.length) },
  };
}

function publicationOrder(name) {
  if (name === 'release-manifest.json') return 30;
  if (name === 'release-manifest.json.sig') return 20;
  if (name === 'SHA256SUMS' || name === 'SHA256SUMS.sig') return 10;
  return 0;
}

function verifySignature(input, signature, publicKey) {
  const result = spawnSync('openssl', ['dgst', '-sha256', '-verify', publicKey, '-signature', signature, input], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`release manifest signature verification failed: ${(result.stderr || result.stdout).trim()}`);
}

function parseArgs(argv) {
  const options = { dryRun: false };
  const names = { '--tag': 'tag', '--commit': 'commit', '--asset-dir': 'assetDir', '--manifest': 'manifestPath', '--public-key': 'publicKey', '--config': 'configPath', '--receipt': 'receiptPath' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') { options.dryRun = true; continue; }
    const name = names[argv[i]];
    if (!name || !argv[i + 1]) throw new Error(`unknown or incomplete argument: ${argv[i]}`);
    options[name] = argv[++i];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await publishReleaseAssets(parseArgs(process.argv.slice(2)));
    console.log(`${receipt.dryRun ? 'Preflighted' : 'Published and verified'} release assets on Forgejo and GitHub.`);
  } catch (error) {
    failClosed(`release asset publication failed: ${error.message}`);
  }
}

function failClosed(message) {
  console.error(message);
  process.exit(1);
}
