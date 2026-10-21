import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Drift guard: every repo file a Vitest suite reads must select that suite's
 * lane in scripts/ci/classify-files-lib.sh. A suite that reads, say,
 * docker-compose.yml or config/jade-emulator-proof.json goes stale silently when
 * a PR touching only that file runs no lane that holds the reader.
 *
 * The scan follows the D-10.18 rules of the iteration-10 bug-scrub plan:
 * 1. Scope: the root, server and llm-egress-proxy Vitest include sets, plus the
 *    transitive closure of their relative imports outside src/, shared/,
 *    server/src/ and gateway/ (imports into those trees are not followed).
 * 2. Resolution: the exact file, then `.js`/`.mjs` mapped to TypeScript, then
 *    appended extensions, then directory index files; the first tracked hit
 *    wins. Literals are resolved first and kept only under the literal prefix
 *    set; repo-root and ancestor-directory path anchors are skipped.
 * 3. src/, shared/, tests/, server/src/ and server/tests/ are not inputs, except
 *    the non-server/src server/ files that root suites read.
 * 4. An unresolved target outside those trees fails unless allowlisted;
 *    gitignored generated paths never fail.
 * 5. Root readers need frontend, server/tests readers backend, and
 *    tests/llm-egress-proxy readers the llm-egress-proxy lane, or a full scan.
 * 6. The one gateway import of a server integration suite is allowlisted.
 *
 * Known residuals: a read added only under server/tests is caught by the nightly
 * full scan, and root suites reading server/src or gateway/src are skipped by
 * server-only or gateway-only PRs.
 */

type Lane = "root" | "server" | "llm";

type Target =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "miss"; path: string }
  | { kind: "outside"; path: string };

interface Repo {
  tracked: Set<string>;
  dirs: Set<string>;
  rootLevel: Set<string>;
}

interface ScanState {
  repo: Repo;
  inputs: Map<string, Map<Lane, string>>;
  problems: Set<string>;
  allowlistHits: Set<string>;
  expansionHits: Set<string>;
  sources: Map<string, string>;
  ignored: Map<string, boolean>;
}

interface ScanResult {
  inputs: Map<string, Map<Lane, string>>;
  unclassified: string[];
  problems: string[];
  staleAllowlist: string[];
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const POSIX = path.posix;
const SELF = "tests/ci/vitestRepoInputsClassified.test.ts";
const CODE_FILE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const NON_INPUT_TREE = /^(src|shared|tests|server\/src|server\/tests)\//;
const NOT_FOLLOWED = /^(src|shared|server\/src|gateway)\//;
const LITERAL_PREFIX = /^(docker|config|scripts|\.github|docs)\/|^docker-compose/;
const ROOT_SUITE_EXCLUDES = new Set([
  "tests/integration/ledgerEmulator.integration.test.ts",
  "tests/integration/trezorEmulator.integration.test.ts",
  "tests/integration/jadeEmulator.integration.test.ts",
]);

const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|unmock)\s*\(\s*|\bimportOriginal\s*\(\s*)(['"`])(\.{1,2}\/[^'"`]*?)\1/g;
const RELATIVE_LITERAL_RE = /(['"`])(\.{1,2}\/[^'"`\s]*)\1/g;
const PREFIX_LITERAL_RE =
  /(['"`])((?:docker|config|scripts|\.github|docs|server)\/[A-Za-z0-9_./@{}*-]*|docker-compose[A-Za-z0-9_.-]*\.yml)\1/g;
const ROOT_FILE_LITERAL_RE = /(['"`])(\.?[A-Za-z0-9_][A-Za-z0-9_.-]*)\1/g;

/**
 * Directory literals a suite discovers dynamically, expanded to the tracked
 * files it actually reads. tests/ci/npmOverridesApplied.test.ts reads only the
 * package manifest and lockfile of each install root it finds.
 */
const DIRECTORY_EXPANSIONS: Record<string, readonly string[]> = {
  "docs/site": ["docs/site/package.json", "docs/site/package-lock.json"],
  "scripts/verify-addresses": [
    "scripts/verify-addresses/package.json",
    "scripts/verify-addresses/package-lock.json",
  ],
  "scripts/verify-psbt": ["scripts/verify-psbt/package.json", "scripts/verify-psbt/package-lock.json"],
};

/** `<reader> :: <literal or specifier>` pairs that are not repo inputs, each with its reason. */
const ALLOWLIST: Record<string, string> = {
  "tests/server-worker-boundary.test.ts :: ../../jobs/syncJobContract":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../../services/workerSyncQueue":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../infrastructure/notificationDispatcher.js":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../jobs/syncJobContract":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../repositories/intelligenceRepository.js":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../worker":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/server-worker-boundary.test.ts :: ../worker/jobs/types":
    "fixture source text written into a temp repo, not an import of this repo",
  "tests/docs/remarkMermaidClickRewrite.test.ts :: docs/architecture/containers":
    "expected URL slug in a rewritten link, not a file read",
  "tests/scripts/checkLargeFiles.test.ts :: scripts/perf/proof.mjs":
    "path inside a temp quality root the test builds, not a repo file",
  "tests/scripts/checkLargeFiles.test.ts :: scripts/quality":
    "mkdir inside a temp quality root the test builds, not a repo read",
  "tests/ci/trezorEmulatorRunnerPreflight.test.ts :: scripts/ci":
    "mkdir inside a temp workspace the test builds, not a repo read",
  "server/tests/helpers/hardwareSignedEvidenceProvenance.ts :: server/tests/helpers":
    "readdirSync filtered to hardwareSigned*.ts, all four already listed",
  "server/tests/integration/ops/phase2OperationsProof.integration.test.ts :: ../../../../gateway/src/middleware/requestLogger":
    "cross-package gateway import, classified is_gateway_file only; a gateway-only PR does not re-run this suite (residual)",
};

function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
}

function loadRepo(): Repo {
  const tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean));
  const dirs = new Set<string>();
  for (const file of tracked) {
    for (let dir = POSIX.dirname(file); dir !== "."; dir = POSIX.dirname(dir)) dirs.add(dir);
  }
  const rootLevel = new Set([...tracked].filter((file) => !file.includes("/")));
  return { tracked, dirs, rootLevel };
}

function isRootSuite(file: string): boolean {
  if (file === "tests/ci/verify-jade-junit.test.mjs") return true;
  if (!/^tests\/.*\.test\.(ts|tsx)$/.test(file) || ROOT_SUITE_EXCLUDES.has(file)) return false;
  return !file.startsWith("tests/e2e/") && !file.startsWith("tests/release/");
}

function suiteLane(file: string): Lane | null {
  if (/^server\/tests\/.*\.test\.ts$/.test(file)) return "server";
  if (!isRootSuite(file)) return null;
  return file.startsWith("tests/llm-egress-proxy/") ? "llm" : "root";
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/.*$/gm, "$1");
}

function candidatePaths(target: string): string[] {
  const mapped: string[] = [];
  if (target.endsWith(".js")) mapped.push(`${target.slice(0, -3)}.ts`, `${target.slice(0, -3)}.tsx`);
  if (target.endsWith(".mjs")) mapped.push(`${target.slice(0, -4)}.mts`);
  const extensions = [".ts", ".tsx", ".mts", ".mjs", ".js"].map((ext) => target + ext);
  const indexes = ["/index.ts", "/index.tsx", "/index.js"].map((index) => target + index);
  return [target, ...mapped, ...extensions, ...indexes];
}

function resolveTarget(repo: Repo, raw: string): Target {
  const target = POSIX.normalize(raw).replace(/\/+$/, "");
  if (target === ".." || target.startsWith("../")) return { kind: "outside", path: target };
  const hit = candidatePaths(target).find((candidate) => repo.tracked.has(candidate));
  if (hit) return { kind: "file", path: hit };
  if (repo.dirs.has(target)) return { kind: "dir", path: target };
  return { kind: "miss", path: target };
}

function isInputFor(target: string, lane: Lane): boolean {
  return !NON_INPUT_TREE.test(target) || (lane === "root" && target.startsWith("server/tests/"));
}

function inLiteralPrefix(repo: Repo, target: string, lane: Lane): boolean {
  if (LITERAL_PREFIX.test(target) || repo.rootLevel.has(target)) return true;
  return lane === "root" && target.startsWith("server/") && !target.startsWith("server/src/");
}

function isPathAnchor(target: string, reader: string): boolean {
  if (target === "" || target === ".") return true;
  for (let dir = POSIX.dirname(reader); dir !== "."; dir = POSIX.dirname(dir)) {
    if (dir === target) return true;
  }
  return false;
}

function isGitIgnored(state: ScanState, target: string): boolean {
  const cached = state.ignored.get(target);
  if (cached !== undefined) return cached;
  let ignored = true;
  try {
    execFileSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", "--no-index", target], { stdio: "ignore" });
  } catch {
    ignored = false;
  }
  state.ignored.set(target, ignored);
  return ignored;
}

function sourceOf(state: ScanState, file: string): string {
  let source = state.sources.get(file);
  if (source === undefined) {
    source = stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8"));
    state.sources.set(file, source);
  }
  return source;
}

function consumeAllowlist(state: ScanState, reader: string, literal: string): boolean {
  const key = `${reader} :: ${literal}`;
  if (!(key in ALLOWLIST)) return false;
  state.allowlistHits.add(key);
  return true;
}

function addInput(state: ScanState, target: string, lane: Lane, reader: string): void {
  const lanes = state.inputs.get(target) ?? new Map<Lane, string>();
  if (!lanes.has(lane)) lanes.set(lane, reader);
  state.inputs.set(target, lanes);
}

function reportUnresolved(state: ScanState, reader: string, literal: string, target: Target): void {
  if (NON_INPUT_TREE.test(target.path)) return;
  if (target.kind === "miss" && isGitIgnored(state, target.path)) return;
  state.problems.add(`${reader}: ${literal} resolves to nothing (${target.path})`);
}

function recordDirectory(state: ScanState, reader: string, lane: Lane, literal: string, dir: string): void {
  const expansion = DIRECTORY_EXPANSIONS[dir];
  if (expansion) {
    state.expansionHits.add(dir);
    for (const file of expansion) addInput(state, file, lane, reader);
    return;
  }
  if (isInputFor(dir, lane)) {
    state.problems.add(`${reader}: directory literal ${literal} must be expanded or allowlisted`);
  }
}

function recordLiteralTarget(state: ScanState, reader: string, lane: Lane, literal: string, candidates: string[]): void {
  const resolved = candidates.map((candidate) => resolveTarget(state.repo, candidate));
  const target = resolved.find((entry) => entry.kind === "file" || entry.kind === "dir") ?? resolved[0];
  if (target.kind === "file") {
    if (isInputFor(target.path, lane)) addInput(state, target.path, lane, reader);
  } else if (target.kind === "dir") {
    recordDirectory(state, reader, lane, literal, target.path);
  } else {
    reportUnresolved(state, reader, literal, target);
  }
}

function scanImports(state: ScanState, reader: string, lane: Lane, source: string): string[] {
  const follow: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[2];
    if (specifier.includes("${") || consumeAllowlist(state, reader, specifier)) continue;
    const target = resolveTarget(state.repo, POSIX.join(POSIX.dirname(reader), specifier));
    if (target.kind === "dir") continue;
    if (target.kind !== "file") {
      reportUnresolved(state, reader, specifier, target);
      continue;
    }
    if (isInputFor(target.path, lane)) addInput(state, target.path, lane, reader);
    if (!NOT_FOLLOWED.test(target.path)) follow.push(target.path);
  }
  return follow;
}

function scanRelativeLiterals(state: ScanState, reader: string, lane: Lane, source: string): void {
  for (const match of source.matchAll(RELATIVE_LITERAL_RE)) {
    const literal = match[2];
    if (literal.includes("${") || literal.includes("*") || consumeAllowlist(state, reader, literal)) continue;
    const target = POSIX.normalize(POSIX.join(POSIX.dirname(reader), literal)).replace(/\/+$/, "");
    if (isPathAnchor(target, reader) || !inLiteralPrefix(state.repo, target, lane)) continue;
    recordLiteralTarget(state, reader, lane, literal, [target]);
  }
}

function literalCandidates(reader: string, literal: string): string[] {
  const target = literal.replace(/\/+$/, "");
  return reader.startsWith("server/") ? [target, `server/${target}`] : [target];
}

function scanPrefixLiteral(state: ScanState, reader: string, lane: Lane, literal: string): void {
  if (literal.startsWith("server/") && (lane !== "root" || literal.startsWith("server/src/"))) return;
  if (consumeAllowlist(state, reader, literal)) return;
  if (/[*{]/.test(literal)) {
    state.problems.add(`${reader}: glob literal ${literal} must be expanded or allowlisted`);
    return;
  }
  recordLiteralTarget(state, reader, lane, literal, literalCandidates(reader, literal));
}

function scanPathLiterals(state: ScanState, reader: string, lane: Lane, source: string): void {
  for (const match of source.matchAll(PREFIX_LITERAL_RE)) scanPrefixLiteral(state, reader, lane, match[2]);
  for (const match of source.matchAll(ROOT_FILE_LITERAL_RE)) {
    const literal = match[2];
    if (!state.repo.rootLevel.has(literal) || consumeAllowlist(state, reader, literal)) continue;
    recordLiteralTarget(state, reader, lane, literal, literalCandidates(reader, literal));
  }
}

function walkLane(state: ScanState, suites: string[], lane: Lane): void {
  const seen = new Set<string>();
  const queue = [...suites];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || file === SELF || !CODE_FILE.test(file)) continue;
    seen.add(file);
    const source = sourceOf(state, file);
    queue.push(...scanImports(state, file, lane, source));
    scanRelativeLiterals(state, file, lane, source);
    scanPathLiterals(state, file, lane, source);
  }
}

const CLASSIFY_SCRIPT = `. scripts/ci/classify-files-lib.sh
while IFS= read -r p; do
  f=n; b=n; s=n; l=n
  is_frontend_file "$p" && f=y
  { is_backend_file "$p" || is_backend_vitest_input_file "$p"; } && b=y
  is_full_scan_trigger_file "$p" && s=y
  is_docs_only_file "$p" && { is_wallet_safety_critical_file "$p" || is_hardware_proof_source_file "$p"; } && s=y
  is_llm_egress_proxy_file "$p" && l=y
  printf '%s %s%s%s%s\\n' "$p" "$f" "$b" "$s" "$l"
done
`;

/** One bash call that sources the classifier library and reports fbsl flags (y/n) per path. */
function classifyPaths(paths: string[]): Map<string, string> {
  const output = execFileSync("bash", ["-c", CLASSIFY_SCRIPT], {
    cwd: REPO_ROOT,
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
  });
  const flags = new Map<string, string>();
  for (const line of output.split("\n").filter(Boolean)) {
    const separator = line.lastIndexOf(" ");
    flags.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return flags;
}

function laneAccepts(flags: string, lane: Lane): boolean {
  if (flags[2] === "y") return true;
  const laneFlag: Record<Lane, string> = { root: flags[0], server: flags[1], llm: flags[3] };
  return laneFlag[lane] === "y";
}

function unclassifiedInputs(inputs: Map<string, Map<Lane, string>>): string[] {
  const flags = classifyPaths([...inputs.keys()]);
  const failures: string[] = [];
  for (const [input, lanes] of inputs) {
    const inputFlags = flags.get(input) ?? "nnnn";
    for (const [lane, reader] of lanes) {
      if (!laneAccepts(inputFlags, lane)) failures.push(`${input} (${lane} lane, read by ${reader})`);
    }
  }
  return failures.sort();
}

function scanRepo(): ScanResult {
  const repo = loadRepo();
  const state: ScanState = {
    repo,
    inputs: new Map(),
    problems: new Set(),
    allowlistHits: new Set(),
    expansionHits: new Set(),
    sources: new Map(),
    ignored: new Map(),
  };
  const suites: Record<Lane, string[]> = { root: [], server: [], llm: [] };
  for (const file of repo.tracked) {
    const lane = suiteLane(file);
    if (lane) suites[lane].push(file);
  }
  for (const lane of ["root", "server", "llm"] as const) walkLane(state, suites[lane], lane);
  const staleAllowlist = [
    ...Object.keys(ALLOWLIST).filter((key) => !state.allowlistHits.has(key)),
    ...Object.keys(DIRECTORY_EXPANSIONS).filter((dir) => !state.expansionHits.has(dir)),
  ];
  return {
    inputs: state.inputs,
    unclassified: unclassifiedInputs(state.inputs),
    problems: [...state.problems].sort(),
    staleAllowlist,
  };
}

describe("repo files read by Vitest suites are classified", () => {
  let result: ScanResult;

  beforeAll(() => {
    result = scanRepo();
  }, 120_000);

  it("reaches known inputs through literals, closure imports and directory expansion", () => {
    const lanesOf = (input: string) => [...(result.inputs.get(input)?.keys() ?? [])];
    expect(lanesOf("docker-compose.yml")).toContain("root");
    expect(lanesOf(".nvmrc")).toContain("root");
    expect(lanesOf("server/Dockerfile")).toContain("root");
    expect(lanesOf("scripts/verify-addresses/implementations/go.ts")).toContain("root");
    expect(lanesOf("scripts/verify-psbt/package-lock.json")).toContain("root");
    expect(lanesOf("config/jade-emulator-proof.json")).toEqual(expect.arrayContaining(["root", "server"]));
    expect([...result.inputs.keys()].filter((input) => input.startsWith("gateway/"))).toEqual([]);
  });

  it("selects the reader's lane for every input", () => {
    expect(result.unclassified).toEqual([]);
  });

  it("resolves every path literal and import outside the source trees, or allowlists it", () => {
    expect(result.problems).toEqual([]);
  });

  it("keeps no stale allowlist or directory expansion entries", () => {
    expect(result.staleAllowlist).toEqual([]);
  });
});
