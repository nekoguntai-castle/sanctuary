import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PROVIDER_CONFIG_DEFAULTS,
  PROVIDER_VALUES,
  publishReleaseAssets,
  resolveProviderConfig,
} from '../../scripts/release/publish-release-assets.mjs';

const TAG = 'v1.2.3';
const COMMIT = 'a'.repeat(40);
const root = mkdtempSync(path.join(tmpdir(), 'sanctuary-publish-assets-test-'));
const fixture = createFixture(root);
const state = { forgejo: [], github: [], uploads: [], nextId: 10 };
const server = createServer((request, response) => void handle(request, response));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const config = {
  FORGEJO_URL: base, FORGEJO_OWNER: 'o', FORGEJO_REPO: 'r', FORGEJO_TOKEN: 'forge-secret',
  GITHUB_API_URL: base, GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_RELEASE_TOKEN: 'github-secret',
};

try {
  const options = {
    tag: TAG, commit: COMMIT, assetDir: fixture.dir, manifestPath: fixture.manifestPath,
    publicKey: fixture.publicKeyPath, config, receiptPath: path.join(root, 'receipts/publication.json'),
  };
  const outsideManifest = path.join(root, 'release-manifest.json');
  copyFileSync(fixture.manifestPath, outsideManifest);
  copyFileSync(`${fixture.manifestPath}.sig`, `${outsideManifest}.sig`);
  await assert.rejects(() => publishReleaseAssets({ ...options, manifestPath: outsideManifest, dryRun: true }), /canonical files/);

  state.github.push({ id: 9, name: 'unexpected.bin', size: 1, bytes: Buffer.from('x'), state: 'uploaded' });
  await assert.rejects(() => publishReleaseAssets(options), /unexpected release asset/);
  assert.equal(state.uploads.length, 0, 'both providers must preflight before Forgejo mutation');
  state.github.length = 0;

  state.forgejo.push({
    id: 8, name: 'install.sh', size: readFileSync(path.join(fixture.dir, 'install.sh')).length,
    bytes: readFileSync(path.join(fixture.dir, 'install.sh')), state: 'uploaded',
    browser_download_url: 'https://example.com/install.sh',
  });
  await assert.rejects(() => publishReleaseAssets({ ...options, dryRun: true }), /unexpected Forgejo asset download origin/);
  state.forgejo.length = 0;

  state.forgejo.push({
    id: 8, name: 'install.sh', size: readFileSync(path.join(fixture.dir, 'install.sh')).length,
    bytes: readFileSync(path.join(fixture.dir, 'install.sh')), state: 'uploaded',
    browser_download_url: `${base}/forgejo-redirect`,
  });
  await assert.rejects(() => publishReleaseAssets({ ...options, dryRun: true }), /unexpected Forgejo asset redirect origin/);
  state.forgejo.length = 0;

  state.forgejo.push({
    id: 8, name: 'install.sh', size: readFileSync(path.join(fixture.dir, 'install.sh')).length,
    bytes: readFileSync(path.join(fixture.dir, 'install.sh')), state: 'uploaded',
    browser_download_url: `${base}/forgejo-relative`,
  });
  const relative = await publishReleaseAssets({ ...options, dryRun: true });
  assert.equal(relative.providers.forgejo.assets.find((asset) => asset.name === 'install.sh').status, 'verified');
  state.forgejo.length = 0;

  state.forgejo.push({
    id: 8, name: 'install.sh', size: readFileSync(path.join(fixture.dir, 'install.sh')).length,
    bytes: readFileSync(path.join(fixture.dir, 'install.sh')), state: 'uploaded',
    browser_download_url: `${base}/forgejo-second-hop`,
  });
  await assert.rejects(() => publishReleaseAssets({ ...options, dryRun: true }), /unexpected Forgejo asset redirect origin/);
  state.forgejo.length = 0;

  const dry = await publishReleaseAssets({ ...options, dryRun: true });
  assert.equal(state.uploads.length, 0);
  assert(dry.providers.forgejo.assets.every((item) => item.status === 'missing-dry-run'));

  await publishReleaseAssets(options);
  const expectedNames = new Set(Object.values(state).filter(Array.isArray).flatMap((items) => items.map((item) => item.name)).filter(Boolean));
  assert(expectedNames.has('release-manifest.json'));
  for (const provider of ['forgejo', 'github']) {
    const uploads = state.uploads.filter((entry) => entry.provider === provider).map((entry) => entry.name);
    assert.equal(uploads.at(-1), 'release-manifest.json');
  }
  const uploadCount = state.uploads.length;
  await publishReleaseAssets(options);
  assert.equal(state.uploads.length, uploadCount, 'matching rerun must not upload');

  state.github.find((asset) => asset.name === 'install.sh').bytes = Buffer.from('different');
  state.github.find((asset) => asset.name === 'install.sh').size = 9;
  await assert.rejects(() => publishReleaseAssets(options), /asset size differs|checksum differs/);
  // Provider-config resolution. This half of the publication flow has to accept
  // the same bare environment the shell half already does: cutting v0.8.62
  // needed three inline exports purely because these defaults lived in only one
  // of the two commands.
  const credentials = { FORGEJO_URL: base, FORGEJO_TOKEN: 'forge-secret', GITHUB_RELEASE_TOKEN: 'github-secret' };
  const resolved = resolveProviderConfig({ config: credentials, env: {} });
  for (const [name, value] of Object.entries(PROVIDER_CONFIG_DEFAULTS)) {
    assert.equal(resolved[name], value, `${name} must fall back to its default`);
  }

  // The shell half declares the same defaults in bash, and nothing but this
  // assertion ties the two together. Extract them from the shell source and
  // compare both directions -- a one-way `includes` check would stay green if
  // the shell grew a default this object lacks, which is the likelier drift.
  // The backreference keeps it to genuine `NAME="${NAME:-value}"` self-defaults,
  // so unrelated indirections like SANCTUARY_CREATE_RELEASE_SCRIPT are ignored.
  const repoRoot = new URL('../../', import.meta.url);
  const providerDefaultsIn = (relativePath) => Object.fromEntries(
    [...readFileSync(new URL(relativePath, repoRoot), 'utf8').matchAll(/^\s*([A-Z][A-Z0-9_]*)="\$\{\1:-(.*)\}"$/gm)]
      .filter(([, name, value]) => value !== '' && PROVIDER_VALUES.includes(name))
      .map(([, name, value]) => [name, value]),
  );
  const shellSource = readFileSync(new URL('scripts/release/publish-release.sh', repoRoot), 'utf8');
  assert.deepEqual(providerDefaultsIn('scripts/release/publish-release.sh'), { ...PROVIDER_CONFIG_DEFAULTS }, 'publish-release.sh and PROVIDER_CONFIG_DEFAULTS must declare identical defaults');

  // Any other release script that defaults one of these names has to agree.
  // create-forge-release.sh is a third declaration site for GITHUB_API_URL, and
  // discovering the scripts rather than listing them means a fourth is covered
  // the day it appears. Declaring none of them is fine; declaring one with a
  // different value is the drift this catches.
  const otherShellScripts = [
    ...readdirSync(new URL('scripts/release/', repoRoot))
      .filter((entry) => entry.endsWith('.sh') && entry !== 'publish-release.sh')
      .map((entry) => `scripts/release/${entry}`),
    'scripts/create-forge-release.sh',
  ];
  let checkedElsewhere = 0;
  for (const relativePath of otherShellScripts) {
    for (const [name, value] of Object.entries(providerDefaultsIn(relativePath))) {
      assert.equal(value, PROVIDER_CONFIG_DEFAULTS[name], `${relativePath} defaults ${name} to a value PROVIDER_CONFIG_DEFAULTS does not declare`);
      checkedElsewhere += 1;
    }
  }
  assert(checkedElsewhere > 0, 'expected at least one provider default outside publish-release.sh (create-forge-release.sh declares GITHUB_API_URL) -- zero means the pattern stopped matching');

  // The order the two halves report a gap in must match too.
  const shellRequired = shellSource
    .match(/^\s*require_values\s+((?:.*\\\n)*.*)$/m)[1]
    .replace(/\\\n/g, ' ')
    .trim()
    .split(/\s+/);
  assert.deepEqual(shellRequired, [...PROVIDER_VALUES], 'require_values must list the same names in the same order');

  // A blank must not beat a default, matching bash ${VAR:-} semantics.
  assert.equal(resolveProviderConfig({ config: { ...credentials, GITHUB_OWNER: '' }, env: {} }).GITHUB_OWNER, PROVIDER_CONFIG_DEFAULTS.GITHUB_OWNER);
  assert.equal(resolveProviderConfig({ config: credentials, env: { GITHUB_REPO: '' } }).GITHUB_REPO, PROVIDER_CONFIG_DEFAULTS.GITHUB_REPO);

  // Precedence: env beats the default, an explicitly named config file beats a
  // variable left over in the shell, and an explicit override beats both.
  assert.equal(resolveProviderConfig({ config: credentials, env: { GITHUB_OWNER: 'from-env' } }).GITHUB_OWNER, 'from-env');
  const configFile = path.join(root, 'provider.env');
  writeFileSync(configFile, 'GITHUB_OWNER=from-file\n');
  assert.equal(resolveProviderConfig({ configPath: configFile, config: credentials, env: { GITHUB_OWNER: 'from-env' } }).GITHUB_OWNER, 'from-file');
  assert.equal(resolveProviderConfig({ config: { ...credentials, GITHUB_OWNER: 'from-override' }, env: { GITHUB_OWNER: 'from-env' } }).GITHUB_OWNER, 'from-override');

  // Credentials and the Forgejo endpoint have no default and must fail closed,
  // whether they are absent or merely blank.
  assert.throws(() => resolveProviderConfig({ config: {}, env: {} }), /missing required configuration: FORGEJO_URL FORGEJO_TOKEN GITHUB_RELEASE_TOKEN/);
  assert.throws(() => resolveProviderConfig({ config: { ...credentials, FORGEJO_TOKEN: '' }, env: {} }), /missing required configuration: FORGEJO_TOKEN/);

  // A non-string must be refused, not quietly swapped for the default -- that
  // would publish to this project's own coordinates instead of the caller's.
  assert.throws(() => resolveProviderConfig({ config: { ...credentials, GITHUB_OWNER: 12345 }, env: {} }), /invalid GITHUB_OWNER: expected a string, received number/);

  // Token characters the shell half rejects must not reach an Authorization header.
  for (const bad of ['tok"en', 'tok\\en', 'tok\nen']) {
    assert.throws(() => resolveProviderConfig({ config: { ...credentials, GITHUB_RELEASE_TOKEN: bad }, env: {} }), /unsafe value for GITHUB_RELEASE_TOKEN/);
  }

  // Nothing beyond the eight provider names travels in the resolved config.
  assert.deepEqual(
    Object.keys(resolveProviderConfig({ config: credentials, env: { UNRELATED_SECRET: 'x' } })).sort(),
    ['FORGEJO_OWNER', 'FORGEJO_REPO', 'FORGEJO_TOKEN', 'FORGEJO_URL', 'GITHUB_API_URL', 'GITHUB_OWNER', 'GITHUB_RELEASE_TOKEN', 'GITHUB_REPO'],
  );

  console.log('release asset publication tests passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}

function createFixture(parent) {
  const dir = path.join(parent, 'assets');
  mkdirSync(dir);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(parent, 'private.pem');
  const publicKeyPath = path.join(parent, 'public.pem');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const bundle = writeAsset(dir, 'bundle.tar.gz', 'bundle');
  sign(path.join(dir, bundle.path), path.join(dir, 'bundle.tar.gz.sig'), privateKeyPath);
  const sbom = writeAsset(dir, 'bundle.spdx.json', JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: [{ name: bundle.path, filesAnalyzed: true, checksums: [{ algorithm: 'SHA256', checksumValue: bundle.sha256 }] }], files: [{ fileName: 'manifest.json', checksums: [{ algorithm: 'SHA256', checksumValue: '1'.repeat(64) }] }] }));
  const provenance = writeAsset(dir, 'bundle.provenance.json', JSON.stringify({ _type: 'https://in-toto.io/Statement/v1', subject: [{ name: bundle.path, digest: { sha256: bundle.sha256 } }], predicateType: 'https://slsa.dev/provenance/v1', predicate: { buildDefinition: { externalParameters: { tag: TAG, commit: COMMIT, platform: 'linux/amd64' } } } }));
  const source = writeAsset(dir, 'source.tar.gz', 'source');
  const install = writeAsset(dir, 'install.sh', 'install');
  const notes = writeAsset(dir, 'release-notes.md', 'notes');
  const refs = [bundle, sbom, provenance, source, install, notes];
  writeFileSync(path.join(dir, 'SHA256SUMS'), `${refs.map((item) => `${item.sha256}  ${item.path}`).join('\n')}\n`);
  sign(path.join(dir, 'SHA256SUMS'), path.join(dir, 'SHA256SUMS.sig'), privateKeyPath);
  const manifest = {
    schema: 1,
    release: { tag: TAG, version: TAG.slice(1), commit: COMMIT, stability: 'stable' },
    builder: { workflow: 'trusted-operator', runId: 'test-1' },
    artifacts: [
      artifact(dir, 'SHA256SUMS', 'checksum-file', { signature: signature(dir, 'SHA256SUMS.sig') }),
      artifact(dir, bundle.path, 'offline-bundle', { platform: 'linux/amd64', signature: signature(dir, 'bundle.tar.gz.sig'), sbom, provenance }),
      artifact(dir, source.path, 'source-archive'), artifact(dir, install.path, 'install-script'), artifact(dir, notes.path, 'release-notes'),
    ],
  };
  const manifestPath = path.join(dir, 'release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  sign(manifestPath, `${manifestPath}.sig`, privateKeyPath);
  return { dir, manifestPath, publicKeyPath };
}

function writeAsset(dir, name, content) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, content);
  return { path: name, sha256: digest(readFileSync(filePath)) };
}
function artifact(dir, name, type, extra = {}) { return { name, type, path: name, sha256: digest(readFileSync(path.join(dir, name))), ...extra }; }
function signature(dir, name) { return { path: name, sha256: digest(readFileSync(path.join(dir, name))), format: 'openssl-rsa-sha256' }; }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sign(input, output, key) { assert.equal(spawnSync('openssl', ['dgst', '-sha256', '-sign', key, '-out', output, input]).status, 0); }

async function handle(request, response) {
  const url = new URL(request.url, base);
  const provider = url.pathname.startsWith('/api/v1/') ? 'forgejo' : 'github';
  const assets = state[provider];
  if (url.pathname.includes('/releases/tags/')) return json(response, 200, { id: provider === 'forgejo' ? 1 : 2, tag_name: TAG, prerelease: false, draft: false, upload_url: `${base}/repos/o/r/releases/2/assets{?name,label}` });
  const exactRefRoute = provider === 'github' ? '/git/ref/tags/' : '/git/refs/tags/';
  if (url.pathname.includes(exactRefRoute)) {
    const object = provider === 'github'
      ? { type: 'tag', sha: 'b'.repeat(40) }
      : { type: 'commit', sha: COMMIT };
    return json(response, 200, { ref: `refs/tags/${TAG}`, object });
  }
  if (url.pathname.includes(`/git/tags/${'b'.repeat(40)}`)) return json(response, 200, { object: { type: 'commit', sha: COMMIT } });
  if (request.method === 'GET' && /\/releases\/\d+\/assets$/.test(url.pathname)) {
    return json(response, 200, assets.map((asset) => publicAsset(asset, provider)));
  }
  if (request.method === 'POST' && /\/releases\/\d+\/assets$/.test(url.pathname)) {
    await consume(request);
    const name = url.searchParams.get('name');
    const bytes = readFileSync(path.join(fixture.dir, name));
    const asset = { id: state.nextId++, name, size: bytes.length, bytes, state: 'uploaded' };
    assets.push(asset); state.uploads.push({ provider, name });
    return json(response, 201, publicAsset(asset, provider));
  }
  if (request.method === 'GET' && url.pathname === '/forgejo-redirect') {
    response.writeHead(302, { Location: 'https://example.com/install.sh' });
    return response.end();
  }
  if (request.method === 'GET' && url.pathname === '/forgejo-relative') {
    response.writeHead(302, { Location: `/o/r/releases/download/${TAG}/install.sh` });
    return response.end();
  }
  if (request.method === 'GET' && url.pathname === '/forgejo-second-hop') {
    response.writeHead(302, { Location: '/forgejo-escape' });
    return response.end();
  }
  if (request.method === 'GET' && url.pathname === '/forgejo-escape') {
    response.writeHead(302, { Location: 'https://example.com/install.sh' });
    return response.end();
  }
  const forgeDownload = url.pathname.match(new RegExp(`^/o/r/releases/download/${TAG}/(.+)$`));
  if (request.method === 'GET' && forgeDownload) {
    const name = decodeURIComponent(forgeDownload[1]);
    const asset = state.forgejo.find((item) => item.name === name);
    response.writeHead(asset ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
    return response.end(asset?.bytes ?? 'missing');
  }
  const match = url.pathname.match(/\/releases\/(?:\d+\/assets|assets)\/(\d+)$/);
  if (request.method === 'GET' && match) {
    const asset = assets.find((item) => item.id === Number(match[1]));
    if (provider === 'forgejo') return json(response, asset ? 200 : 404, asset ? publicAsset(asset, provider) : { error: 'missing' });
    response.writeHead(asset ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
    return response.end(asset?.bytes ?? 'missing');
  }
  return json(response, 404, { error: url.pathname });
}
function publicAsset(asset, provider) {
  return {
    id: asset.id, name: asset.name, size: asset.size, state: asset.state,
    ...(provider === 'forgejo' ? { browser_download_url: asset.browser_download_url ?? `${base}/o/r/releases/download/${TAG}/${encodeURIComponent(asset.name)}` } : {}),
  };
}
function json(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
function consume(request) { return new Promise((resolve) => { request.on('data', () => {}); request.on('end', resolve); }); }
