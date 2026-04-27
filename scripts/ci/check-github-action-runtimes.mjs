#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BANNED_RUNTIMES = ['node12', 'node16', 'node20'];
const ACTION_MANIFEST_NAMES = ['action.yml', 'action.yaml'];

function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    workflowDir: '.github/workflows',
    manifestRoot: '',
    bannedRuntimes: DEFAULT_BANNED_RUNTIMES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--workflow-dir') {
      options.workflowDir = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--manifest-root') {
      options.manifestRoot = readOptionValue(argv, index);
      index += 1;
    } else if (arg === '--banned-runtimes') {
      options.bannedRuntimes = readOptionValue(argv, index)
        .split(',')
        .map((runtime) => runtime.trim())
        .filter(Boolean);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return value;
}

function listWorkflowFiles(rootDir, workflowDir) {
  const fullDir = path.resolve(rootDir, workflowDir);
  if (!existsSync(fullDir)) {
    return [];
  }

  return readdirSync(fullDir)
    .filter((name) => /\.(?:ya?ml)$/i.test(name))
    .map((name) => path.join(fullDir, name))
    .sort();
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function stripInlineComment(value) {
  const quote = value.trimStart()[0];
  if (quote === '"' || quote === "'") {
    return value.trim();
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function extractUses(source) {
  const uses = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(.+?)\s*$/);
    if (!match) {
      return;
    }

    const spec = unquote(stripInlineComment(match[1]));
    if (spec) {
      uses.push({ spec, line: index + 1 });
    }
  });

  return uses;
}

function extractRuntime(source) {
  const match = source.match(/^\s*using:\s*['"]?([^'"\s#]+)['"]?/m);
  return match?.[1].toLowerCase() ?? '';
}

function isWorkflowPath(actionPath) {
  return /^\.github\/workflows\/[^/]+\.(?:ya?ml)$/i.test(actionPath);
}

function parseUsesSpec(spec) {
  if (spec.startsWith('docker://')) {
    return { kind: 'skip', reason: 'docker action', spec };
  }
  if (spec.startsWith('./')) {
    return { kind: 'local', actionPath: spec, spec };
  }

  const atIndex = spec.lastIndexOf('@');
  if (atIndex <= 0) {
    return { kind: 'unresolved', reason: 'missing @ref', spec };
  }

  const locator = spec.slice(0, atIndex);
  const ref = spec.slice(atIndex + 1);
  const parts = locator.split('/');

  if (parts.length < 2 || !ref) {
    return { kind: 'unresolved', reason: 'invalid remote action spec', spec };
  }

  const actionPath = parts.slice(2).join('/');
  if (isWorkflowPath(actionPath)) {
    return { kind: 'skip', reason: 'reusable workflow', spec };
  }

  return {
    kind: 'remote',
    owner: parts[0],
    repo: parts[1],
    actionPath,
    ref,
    spec,
  };
}

function manifestCacheKey(action) {
  if (action.kind === 'local') {
    return `local:${action.actionPath}`;
  }
  return `remote:${action.owner}/${action.repo}/${action.ref}/${action.actionPath}`;
}

function remoteFixtureDir(manifestRoot, action) {
  return path.join(
    manifestRoot,
    action.owner,
    action.repo,
    encodeURIComponent(action.ref),
    action.actionPath,
  );
}

function findManifestInDir(dir) {
  for (const name of ACTION_MANIFEST_NAMES) {
    const filePath = path.join(dir, name);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return '';
}

function readLocalManifest(rootDir, action) {
  const localPath = path.resolve(rootDir, action.actionPath);
  if (/\.(?:ya?ml)$/i.test(localPath)) {
    return null;
  }

  const manifestPath = findManifestInDir(localPath);
  if (!manifestPath) {
    throw new Error(`missing local action manifest for ${action.spec}`);
  }

  return {
    source: path.relative(rootDir, manifestPath),
    text: readText(manifestPath),
  };
}

async function fetchGitHubManifest(action, manifestName) {
  const actionPath = [action.actionPath, manifestName].filter(Boolean).join('/');
  const url = new URL(
    `https://api.github.com/repos/${action.owner}/${action.repo}/contents/${actionPath}`,
  );
  url.searchParams.set('ref', action.ref);

  const headers = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'sanctuary-action-runtime-check',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    const cause = error.cause?.message ?? error.message;
    throw new Error(`network error while fetching ${action.spec}: ${cause}`);
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} while fetching ${action.spec}`);
  }

  return await response.text();
}

async function readRemoteManifest(action, manifestRoot) {
  if (manifestRoot) {
    const manifestPath = findManifestInDir(remoteFixtureDir(manifestRoot, action));
    if (!manifestPath) {
      throw new Error(`missing fixture manifest for ${action.spec}`);
    }
    return {
      source: action.spec,
      text: readText(manifestPath),
    };
  }

  for (const manifestName of ACTION_MANIFEST_NAMES) {
    const text = await fetchGitHubManifest(action, manifestName);
    if (text) {
      return { source: `${action.spec}/${manifestName}`, text };
    }
  }

  throw new Error(`missing remote action manifest for ${action.spec}`);
}

async function readManifest(action, options) {
  if (action.kind === 'local') {
    return readLocalManifest(options.rootDir, action);
  }
  return await readRemoteManifest(action, options.manifestRoot);
}

function formatChain(chain, action, manifest) {
  const current = manifest ? `${action.spec} (${manifest.source})` : action.spec;
  return [...chain, current].join(' -> ');
}

async function inspectAction(action, options, state, chain = []) {
  if (action.kind === 'skip') {
    return;
  }
  if (action.kind === 'unresolved') {
    addUniqueError(state, `${action.spec}: ${action.reason}`);
    return;
  }

  const cacheKey = manifestCacheKey(action);
  if (state.failedManifests.has(cacheKey)) {
    return;
  }
  if (state.visiting.has(cacheKey)) {
    return;
  }

  state.visiting.add(cacheKey);

  try {
    if (!state.manifestCache.has(cacheKey)) {
      const resolvedManifest = await readManifest(action, options);
      if (!resolvedManifest) {
        return;
      }
      state.manifestCache.set(cacheKey, resolvedManifest);
    }

    const manifest = state.manifestCache.get(cacheKey);
    if (!manifest) {
      return;
    }

    const runtime = extractRuntime(manifest.text);
    if (options.bannedRuntimes.includes(runtime)) {
      state.findings.push({
        runtime,
        chain: formatChain(chain, action, manifest),
      });
    }

    if (runtime === 'composite') {
      await inspectNestedActions(action, manifest, options, state, chain);
    }
  } catch (error) {
    state.failedManifests.add(cacheKey);
    addUniqueError(state, `${formatChain(chain, action)}: ${error.message}`);
  } finally {
    state.visiting.delete(cacheKey);
  }
}

function addUniqueError(state, error) {
  if (state.errorSet.has(error)) {
    return;
  }
  state.errorSet.add(error);
  state.errors.push(error);
}

async function inspectNestedActions(action, manifest, options, state, chain) {
  const nextChain = [...chain, `${action.spec} (${manifest.source})`];
  for (const nestedUse of extractUses(manifest.text)) {
    await inspectAction(parseUsesSpec(nestedUse.spec), options, state, nextChain);
  }
}

async function inspectWorkflow(filePath, options, state) {
  const workflow = readText(filePath);
  const relativePath = path.relative(options.rootDir, filePath);

  for (const use of extractUses(workflow)) {
    const action = parseUsesSpec(use.spec);
    const chain = [`${relativePath}:${use.line}`];
    await inspectAction(action, options, state, chain);
  }
}

export async function checkActionRuntimes(rawOptions = {}) {
  const options = {
    rootDir: path.resolve(rawOptions.rootDir ?? process.cwd()),
    workflowDir: rawOptions.workflowDir ?? '.github/workflows',
    manifestRoot: rawOptions.manifestRoot ? path.resolve(rawOptions.manifestRoot) : '',
    bannedRuntimes: rawOptions.bannedRuntimes ?? DEFAULT_BANNED_RUNTIMES,
  };
  const state = {
    errors: [],
    errorSet: new Set(),
    failedManifests: new Set(),
    findings: [],
    manifestCache: new Map(),
    visiting: new Set(),
  };

  for (const workflowPath of listWorkflowFiles(options.rootDir, options.workflowDir)) {
    await inspectWorkflow(workflowPath, options, state);
  }

  return {
    errors: state.errors,
    findings: state.findings,
    checkedManifests: state.manifestCache.size,
  };
}

function printResult(result) {
  for (const error of result.errors) {
    console.error(`github-action-runtimes: error: ${error}`);
  }
  for (const finding of result.findings) {
    console.error(
      `github-action-runtimes: banned runtime ${finding.runtime}: ${finding.chain}`,
    );
  }

  if (result.errors.length > 0 || result.findings.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `github-action-runtimes: checked ${result.checkedManifests} action manifest(s); no banned runtimes found`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = await checkActionRuntimes(options);
  printResult(result);
}
