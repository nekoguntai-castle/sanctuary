#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(process.argv[2] ?? '.');
const findings = [];
const timeoutMs = Number(process.env.FRESHNESS_FETCH_TIMEOUT_MS ?? 30_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
  throw new Error('FRESHNESS_FETCH_TIMEOUT_MS must be an integer from 1 to 30000');
}
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
async function request(url, options, description) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (signal.aborted) throw new Error(`${description} timed out after ${timeoutMs} ms`);
    throw new Error(`${description} request failed: ${error.message}`);
  }
}
const maybeJson = async file => {
  try { return await readJson(file); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

const config = await maybeJson(path.join(repoRoot, 'config/browser-toolchain.json'));
const lockCandidates = ['package-lock.json', 'web/package-lock.json', 'server/package-lock.json'];
const lockVersions = [];
for (const relative of lockCandidates) {
  const lock = await maybeJson(path.join(repoRoot, relative));
  const version = lock?.packages?.['node_modules/playwright-core']?.version ??
    lock?.packages?.['node_modules/playwright']?.version;
  if (version && !lockVersions.some(entry => entry.version === version)) {
    lockVersions.push({ version, file: relative });
  }
}
if (lockVersions.length === 0) findings.push('No package-lock.json with a pinned Playwright package was found.');
if (lockVersions.length > 1) findings.push(`Multiple Playwright lock versions found: ${lockVersions.map(x => `${x.file}=${x.version}`).join(', ')}.`);
const packageVersion = config?.playwrightVersion ?? lockVersions[0]?.version;
if (config) {
  if (typeof config.playwrightVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.playwrightVersion)) {
    throw new Error('invalid playwrightVersion in config/browser-toolchain.json');
  }
  for (const field of ['browserVersion', 'minimumBrowserVersion']) {
    if (typeof config[field] !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(config[field])) {
      throw new Error(`invalid ${field} in config/browser-toolchain.json`);
    }
  }
  if (typeof config.browserSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(config.browserSha256)) {
    throw new Error('invalid browserSha256 in config/browser-toolchain.json');
  }
  if (lockVersions.length && lockVersions[0].version !== config.playwrightVersion) {
    findings.push(`config/browser-toolchain.json pins Playwright ${config.playwrightVersion}, but ${lockVersions[0].file} pins ${lockVersions[0].version}.`);
  }
  const numbers = value => value.split('.').map(Number);
  const floor = numbers(config.minimumBrowserVersion);
  const pinned = numbers(config.browserVersion);
  if (floor.some(value => !Number.isSafeInteger(value)) || pinned.some(value => !Number.isSafeInteger(value))) {
    throw new Error('browser versions must contain only safe numeric components');
  }
  let versionOrder = 0;
  for (let i = 0; i < Math.max(floor.length, pinned.length); i += 1) {
    if ((pinned[i] ?? 0) !== (floor[i] ?? 0)) {
      versionOrder = (pinned[i] ?? 0) > (floor[i] ?? 0) ? 1 : -1;
      break;
    }
  }
  if (versionOrder < 0) findings.push(`Configured browser ${config.browserVersion} is below minimum ${config.minimumBrowserVersion}.`);
}

async function listWorkflowFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listWorkflowFiles(full));
    else if (/\.(?:ya?ml)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const workflowFiles = (await Promise.all(['.github/workflows', '.forgejo/workflows']
  .map(directory => listWorkflowFiles(path.join(repoRoot, directory))))).flat();
const references = [];
const imagePattern = /nexus\.tabineko\.dev\/nekoguntai-castle\/(?:counting-cats|sanctuary)-ci-playwright(?::([^\s@]+))?(?:@(sha256:[a-f0-9]{64}))?/g;
for (const file of workflowFiles) {
  const content = await readFile(file, 'utf8');
  const activeLines = content.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  for (const match of activeLines.matchAll(imagePattern)) references.push({ file: path.relative(repoRoot, file), tag: match[1], digest: match[2] });
}
if (references.length === 0) findings.push('No digest-pinned Counting Cats or Sanctuary browser image reference was found in workflows.');
const pairPattern = /^pw(\d+\.\d+\.\d+)-chrome(\d+\.\d+\.\d+\.\d+)$/;
for (const reference of references) {
  if (!reference.digest) findings.push(`${reference.file} browser image reference is not digest-pinned.`);
  const pair = pairPattern.exec(reference.tag ?? '');
  if (!pair) {
    findings.push(`${reference.file} browser image reference lacks a combined Playwright/Chrome version tag.`);
    continue;
  }
  if (packageVersion && pair[1] !== packageVersion) {
    findings.push(`${reference.file} image tag Playwright ${pair[1]} differs from package pin ${packageVersion}.`);
  }
  if (config && (pair[1] !== config.playwrightVersion || pair[2] !== config.browserVersion)) {
    findings.push(`${reference.file} image tag ${reference.tag} differs from browser-toolchain.json.`);
  }
}

const [playwrightLatest, chromeFeed] = await Promise.all([
  request(process.env.PLAYWRIGHT_LATEST_URL ?? 'https://registry.npmjs.org/playwright/latest', { headers: { accept: 'application/json' } }, 'npm version feed'),
  request(process.env.CHROME_STABLE_URL ?? 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json', { headers: { accept: 'application/json' } }, 'Chrome Stable feed'),
]);
if (!playwrightLatest.ok || !chromeFeed.ok) {
  throw new Error(`upstream version feed failed: npm HTTP ${playwrightLatest.status}, Chrome HTTP ${chromeFeed.status}`);
}
const [npm, chrome] = await Promise.all([playwrightLatest.json(), chromeFeed.json()]);
const latestBrowser = chrome.channels?.Stable?.version;
if (typeof npm.version !== 'string' || typeof latestBrowser !== 'string') {
  throw new Error('upstream feeds did not include Playwright/latest and Chrome Stable versions');
}
if (packageVersion && npm.version !== packageVersion) {
  findings.push(`Playwright: package pin ${packageVersion}, upstream latest ${npm.version}.`);
}
if (config && latestBrowser !== config.browserVersion) {
  findings.push(`Chrome for Testing Stable: configured ${config.browserVersion}, upstream latest ${latestBrowser}.`);
}
if (!config) {
  const referencedBrowsers = references.flatMap(reference => {
    const pair = pairPattern.exec(reference.tag ?? '');
    return pair ? [pair[2]] : [];
  });
  if (referencedBrowsers.length === 0) {
    findings.push(`No config/browser-toolchain.json or combined browser image tag is available to compare with Chrome Stable ${latestBrowser}.`);
  } else if (referencedBrowsers.some(version => version !== latestBrowser)) {
    findings.push(`Chrome for Testing Stable: workflow image tag ${[...new Set(referencedBrowsers)].join(', ')}, upstream latest ${latestBrowser}.`);
  }
}

const api = process.env.FORGEJO_API_URL;
const repository = process.env.FORGEJO_REPOSITORY;
const token = process.env.FORGEJO_TOKEN;
if (!api || !repository || !token) {
  throw new Error('FORGEJO_API_URL, FORGEJO_REPOSITORY and FORGEJO_TOKEN are required');
}
const issueTitle = 'Browser toolchain freshness';
const issueMarker = '<!-- browser-toolchain-freshness:managed -->';
const base = `${api.replace(/\/$/, '')}/repos/${repository}/issues`;
const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' };
async function apiRequest(url, method = 'GET', body) {
  const response = await request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, `Forgejo API ${method}`);
  if (!response.ok) throw new Error(`Forgejo API ${method} failed with HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
let existing;
for (let page = 1; !existing; page += 1) {
  const openIssues = await apiRequest(`${base}?state=open&limit=50&page=${page}`);
  existing = openIssues.find(issue => issue.title === issueTitle && issue.body?.includes(issueMarker));
  if (openIssues.length < 50) break;
}
if (findings.length) {
  const body = [
    issueMarker,
    '',
    'The repository browser toolchain differs from current upstream stable versions or its deployed workflow pins.',
    '',
    ...findings.map(finding => `- ${finding}`),
    '',
    'Review upstream artifacts, checksums, and image digests before updating pins.',
  ].join('\n');
  if (existing) await apiRequest(`${base}/${existing.number}`, 'PATCH', { body });
  else await apiRequest(base, 'POST', { title: issueTitle, body });
  console.log(`Freshness issue ${existing ? 'updated' : 'created'} with ${findings.length} finding(s).`);
} else if (existing) {
  await apiRequest(`${base}/${existing.number}`, 'PATCH', { state: 'closed' });
  console.log('Closed the resolved browser toolchain freshness issue.');
} else {
  console.log('Package lock, browser image refs, and upstream stable versions agree.');
}
