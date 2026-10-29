// Derives the repository files that the ci-classifier-tests suites execute,
// so tests/ci/classify-quality-scope.test.sh can require every one of them to
// select that job (D-17.C2). The suite list comes from the job body in
// .github/workflows/quality.yml (plus the npm scripts it runs), never from a
// hand-kept list: a hand-kept list is how iteration 11's fix missed six
// subjects. A subject is a tracked file the suite runs, not one it mentions:
//   - every module in the static relative import/require graph of a JS suite;
//   - a file a shell suite sources, runs, copies from the checkout, or binds
//     to a variable when it is a script (.sh/.mjs/.cjs/.js or extensionless)
//     (`. "$ROOT_DIR/x"`, `bash "$ROOT_DIR/x"`, `cp "$SOURCE_ROOT/x" ...`);
//   - a script a shell suite runs as a command (`"$ROOT_DIR/scripts/x.sh" --yes`);
//   - a file a JS suite opens through `resolve('x')` / `path.resolve('x')`;
//   - a script a JS suite locates with `new URL('../../x.mjs', import.meta.url)`;
//   - an entry of the `SITES` table a JS suite runs from its copy of the
//     checkout's scripts/ tree (esm-main-guard-symlink.test.mjs);
//   - a repo-relative script path a JS suite names when it spawns
//     `process.execPath` (phase-smoke-cleanup-composition.test.mjs);
//   - a file a derived shell subject sources (`. "$VAR/x.sh"`, `source x.sh`),
//     followed transitively. Only two variable classes resolve: a script-dir
//     variable (`SCRIPT_DIR`, `script_dir`, `*_script_dir`, or an inline
//     `$(dirname "$0")`) against the sourcing file's directory, and a
//     ROOT/WORKSPACE variable (`ROOT_DIR`, `REPO_ROOT`, `PROJECT_ROOT`,
//     `WORKSPACE`, ...) against the repo root. A literal relative path
//     resolves against the repo root. Other variables are runtime inputs.
// Paths a suite only names (fixture strings, workflow needles) are not
// subjects; they would turn this guard into a word list.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isMainModule } from '../../../scripts/lib/is-main-module.mjs';
import { listTrackedFiles } from '../../../scripts/quality/check-root-layout.mjs';
import YAML from './yaml.mjs';

const CLASSIFIER_JOB = 'ci-classifier-tests';
const SUITE_PATTERN = /\btests\/[A-Za-z0-9_./*-]+\.(?:sh|mjs|cjs|js)\b/g;
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const SHELL_RUN_PATTERN = /(?:^|[\s;&|(])(?:\.|source|bash|sh|node|cp)\s+"?\$\{?[A-Z_]*ROOT[A-Z_]*\}?\/([A-Za-z0-9_./-]+)/g;
// A shell variable bound to a checkout script (`X="$ROOT_DIR/scripts/x.sh"`):
// only executable extensions, so data files a contract suite greps stay out.
const SHELL_SCRIPT_BINDING_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]*="\$\{?[A-Z_]*ROOT[A-Z_]*\}?\/([A-Za-z0-9_./-]+?(?:\.(?:sh|mjs|cjs|js)|\/[A-Za-z0-9_-]+))"/g;
// A checkout script in command position (after a line start, a separator or a
// shell keyword, optionally behind `VAR=value` assignments): it is executed.
const SHELL_DIRECT_EXEC_PATTERN = /(?:^|[;&|(!{]|\b(?:then|do|else|exec))[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*"?\$\{?[A-Z_]*ROOT[A-Z_]*\}?\/([A-Za-z0-9_./-]+\.(?:sh|mjs|cjs|js))"?(?=[\s;&|)]|$)/gm;
const JS_RESOLVE_PATTERN = /\b(?:path\.)?resolve\(\s*['"]([A-Za-z0-9_./-]+)['"]\s*\)/g;
// Relative to the suite, like an import; only scripts, so data reads stay out.
const JS_MODULE_URL_PATTERN = /\bnew URL\(\s*['"](\.{1,2}\/[A-Za-z0-9_./-]+\.(?:sh|mjs|cjs|js))['"]\s*,\s*import\.meta\.url\s*\)/g;
// `const SITES = [ ['ci/x.mjs', []], ... ]` in a suite that copies scripts/.
const COPIES_SCRIPTS_TREE_PATTERN = /\bcpSync\([^)]*['"]scripts['"]\s*\)/;
const SCRIPT_TABLE_PATTERN = /\bconst SITES = \[([\s\S]*?)\n\];/;
const SCRIPT_TABLE_ENTRY_PATTERN = /^\s*\[\s*'([A-Za-z0-9_./-]+\.(?:sh|mjs|cjs|js))'/gm;
// A suite that runs node itself (`spawnSync(process.execPath, [subject])`):
// its repo-relative script literals are what it runs.
const SPAWNS_NODE_PATTERN = /\b(?:spawnSync|execFileSync|spawn|execFile)\(\s*process\.execPath\b/;
const REPO_SCRIPT_LITERAL_PATTERN = /['"]((?:scripts|server|tests|config|gateway|shared)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js))['"]/g;
// `. "$SCRIPT_DIR/x.sh"`, `source "$(dirname "$0")/x.sh"`, `source tests/x.sh`
// in command position: group 1 is the variable, group 2 a literal first segment.
const SHELL_SOURCE_PATTERN = /(?:^|[;&|(!{]|\b(?:then|do|else))[ \t]*(?:\.|source)[ \t]+"?(?:\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|\$\(dirname "\$(?:0|\{BASH_SOURCE\[0\]\})"\)|([A-Za-z0-9_.][A-Za-z0-9_.-]*))\/([A-Za-z0-9_./-]+\.sh)\b/gm;
const SCRIPT_DIR_VARIABLE = /(?:^|_)script_dir$/i;
const ROOT_VARIABLE = /root|workspace/i;
const RESOLVE_SUFFIXES = ['', '.mjs', '.js', '.cjs', '.ts', '/index.mjs', '/index.js'];

export function trackedFiles(root) {
  return new Set(listTrackedFiles(root));
}

/** The `run` scripts of quality.yml's ci-classifier-tests steps, joined. */
export function classifierJobBody(workflowText) {
  const steps = YAML.parse(workflowText)?.jobs?.[CLASSIFIER_JOB]?.steps;
  if (!Array.isArray(steps)) throw new Error(`quality.yml has no ${CLASSIFIER_JOB} job steps`);
  return steps.map((step) => (typeof step?.run === 'string' ? step.run : '')).join('\n');
}

function expandGlob(pattern, tracked) {
  if (!pattern.includes('*')) return tracked.has(pattern) ? [pattern] : [];
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  const matcher = new RegExp(`^${escaped}$`);
  return [...tracked].filter((path) => matcher.test(path));
}

export function deriveSuites(root, tracked = trackedFiles(root)) {
  const workflow = readFileSync(join(root, '.github/workflows/quality.yml'), 'utf8');
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  // `bash -n` / `node --check` lines only syntax-check; comments run nothing.
  let body = classifierJobBody(workflow)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && !/\b(?:bash -n|node --check)\s/.test(line))
    .join('\n');
  for (const match of body.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
    body += `\n${scripts[match[1]] ?? ''}`;
  }
  const suites = new Set();
  for (const match of body.matchAll(SUITE_PATTERN)) {
    for (const path of expandGlob(match[0], tracked)) suites.add(path);
  }
  return [...suites].sort();
}

function resolveImport(root, from, specifier, tracked) {
  const base = resolve(dirname(join(root, from)), specifier);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = relative(root, base + suffix);
    if (tracked.has(candidate) && existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) {
      return candidate;
    }
  }
  return null;
}

function importGraph(root, entry, tracked, seen = new Set()) {
  if (seen.has(entry) || !/\.(?:mjs|cjs|js|ts)$/.test(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(join(root, entry), 'utf8');
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const target = resolveImport(root, entry, match[1], tracked);
    if (target) importGraph(root, target, tracked, seen);
  }
  return seen;
}

function directlyRunFiles(root, suite, tracked) {
  const source = readFileSync(join(root, suite), 'utf8');
  const patterns = suite.endsWith('.sh')
    ? [SHELL_RUN_PATTERN, SHELL_SCRIPT_BINDING_PATTERN, SHELL_DIRECT_EXEC_PATTERN]
    : [JS_RESOLVE_PATTERN];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)])
    .map((match) => match[1].replace(/[.,:;)]+$/, ''))
    .concat(suite.endsWith('.sh') ? [] : jsLocatedFiles(root, suite, source))
    .filter((path) => tracked.has(path));
}

function jsLocatedFiles(root, suite, source) {
  const located = [...source.matchAll(JS_MODULE_URL_PATTERN)]
    .map((match) => relative(root, resolve(dirname(join(root, suite)), match[1])));
  const table = COPIES_SCRIPTS_TREE_PATTERN.test(source) ? (SCRIPT_TABLE_PATTERN.exec(source)?.[1] ?? '') : '';
  const spawned = SPAWNS_NODE_PATTERN.test(source) ? [...source.matchAll(REPO_SCRIPT_LITERAL_PATTERN)] : [];
  return located.concat(
    [...table.matchAll(SCRIPT_TABLE_ENTRY_PATTERN)].map((match) => `scripts/${match[1]}`),
    spawned.map((match) => match[1]),
  );
}

function isShellFile(root, path) {
  if (path.endsWith('.sh')) return true;
  return !/\.[A-Za-z0-9]+$/.test(path) && /^#!.*\b(?:ba)?sh\b/.test(readFileSync(join(root, path), 'utf8'));
}

// Files a shell file sources, each resolved by its variable class.
function sourcedFiles(root, path, tracked) {
  const source = readFileSync(join(root, path), 'utf8');
  return [...source.matchAll(SHELL_SOURCE_PATTERN)].flatMap(([, variable, literal, rest]) => {
    if (variable && ROOT_VARIABLE.test(variable)) return [rest];
    if (literal) return [`${literal}/${rest}`];
    if (variable && !SCRIPT_DIR_VARIABLE.test(variable)) return [];
    return [relative(root, resolve(dirname(join(root, path)), rest))];
  }).filter((target) => tracked.has(target));
}

// Adds every file the shell files in `reached` source, transitively.
function addSourcedClosure(root, reached, tracked) {
  const queue = [...reached];
  while (queue.length > 0) {
    const path = queue.pop();
    if (!isShellFile(root, path)) continue;
    for (const target of sourcedFiles(root, path, tracked)) {
      if (!reached.has(target)) queue.push(target);
      reached.add(target);
    }
  }
}

// Returns Map<subject, suites[]>, excluding the suites themselves.
export function deriveSubjects(root, suites = deriveSuites(root), tracked = trackedFiles(root)) {
  const subjects = new Map();
  const suiteSet = new Set(suites);
  for (const suite of suites) {
    const reached = new Set([...importGraph(root, suite, tracked), suite]);
    for (const path of directlyRunFiles(root, suite, tracked)) {
      for (const module of importGraph(root, path, tracked)) reached.add(module);
      reached.add(path);
    }
    addSourcedClosure(root, reached, tracked);
    for (const path of reached) {
      if (suiteSet.has(path)) continue;
      if (!subjects.has(path)) subjects.set(path, []);
      subjects.get(path).push(suite);
    }
  }
  return new Map([...subjects].sort(([left], [right]) => (left < right ? -1 : 1)));
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '.');
  const mode = process.argv[3] ?? 'subjects';
  const suites = deriveSuites(root);
  if (mode === 'suites') {
    process.stdout.write(`${suites.join('\n')}\n`);
  } else {
    for (const [path, owners] of deriveSubjects(root, suites)) {
      process.stdout.write(`${path}\t${owners.join(',')}\n`);
    }
  }
}
