import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drift guard: every runtime file the browser e2e specs load must select the
 * Full Browser E2E lane in scripts/ci/classify-files-lib.sh
 * (`is_browser_smoke_file`). Every browser spec boots src/main.tsx -> App.tsx
 * and drives flows through hash routes, so a PR touching only a reachable
 * component, hook or shared module that is not classified skips the lane while
 * changing what the flow specs exercise.
 *
 * The walk starts at src/main.tsx, src/App.tsx and every tests/e2e/*.spec.ts
 * except the render-regression spec (owned by renderHarnessInputsClassified),
 * and follows every relative, `@/` and `@sanctuary/shared/` specifier quoted
 * with ', " or `: `import`, `import type`, `export ... from` and dynamic
 * `import()`, skipping comment-only lines. Type-only reachability is excluded
 * by path (src/api/**\/types.ts), never by import kind. src/types/** is not
 * excluded: it holds runtime enums, labels and quorum helpers.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const E2E_DIR = "tests/e2e";
const APP_ENTRIES = ["src/main.tsx", "src/App.tsx"];
const RENDER_SPEC = "tests/e2e/render-regression.spec.ts";
/** Imported by network-sync-toggle-dark.spec.ts, so it is a browser input (D-19.C1a). */
const SHARED_RENDER_HARNESS = "tests/e2e/render-regression/renderRegressionHarness.ts";
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`]*?|@\/[^'"`]*?|@sanctuary\/shared\/[^'"`]*?)\1/g;
const ALIASES: Array<[string, string]> = [
  ["@/", "src/"],
  ["@sanctuary/shared/", "shared/"],
];
/** Comment-only lines (JSDoc bodies, `//` and `/*` openers) carry usage examples, not imports. */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*).*$/gm;
const TYPE_ONLY_TREE = /^src\/api\/(?:.*\/)?types\.ts$/;

/** Browser-reachable files deliberately outside the browser lane, with the reason. */
const EXEMPTIONS = new Map<string, string>();

function isFile(relative: string): boolean {
  const absolute = path.join(REPO_ROOT, relative);
  return existsSync(absolute) && statSync(absolute).isFile();
}

function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  const base = alias
    ? `${alias[1]}${specifier.slice(alias[0].length)}`
    : path.posix.join(path.posix.dirname(fromFile), specifier);
  return RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(isFile);
}

function importSpecifiers(file: string): string[] {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return [];
  const source = readFileSync(path.join(REPO_ROOT, file), "utf8").replace(COMMENT_LINE_RE, "");
  return [...source.matchAll(IMPORT_RE)].map((match) => match[2]);
}

function entryPoints(): string[] {
  const specs = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", `${E2E_DIR}/*.spec.ts`], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "" && file !== RENDER_SPEC && path.posix.dirname(file) === E2E_DIR);
  return [...APP_ENTRIES, ...specs];
}

function reachableFiles(): Set<string> {
  const seen = new Set<string>();
  const queue = entryPoints();
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importSpecifiers(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target === undefined) throw new Error(`unresolved import ${specifier} in ${file}`);
      queue.push(target);
    }
  }
  return seen;
}

let memoizedBrowserInputs: string[] | undefined;

/** Walked lazily once per module so both tests share it and a walk error fails a test, not collection. */
function browserInputs(): string[] {
  memoizedBrowserInputs ??= [...reachableFiles()].filter((file) => !TYPE_ONLY_TREE.test(file)).sort();
  return memoizedBrowserInputs;
}

const CLASSIFY_SCRIPT = `. scripts/ci/classify-files-lib.sh
while IFS= read -r p; do
  is_browser_smoke_file "$p" || printf '%s\\n' "$p"
done
`;

/** One bash call that sources the classifier library and prints the paths `is_browser_smoke_file` rejects. */
function notBrowserClassified(paths: string[]): string[] {
  const output = execFileSync("bash", ["-c", CLASSIFY_SCRIPT], {
    cwd: REPO_ROOT,
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

describe("browser e2e inputs select the Full Browser E2E lane", () => {
  it("reaches flow components, hooks, runtime types, shared modules and the shared render harness", () => {
    const inputs = browserInputs();
    expect(inputs).toEqual(
      expect.arrayContaining(["src/App.tsx", "tests/e2e/helpers.ts", "src/types/index.ts", SHARED_RENDER_HARNESS]),
    );
    expect(inputs.some((file) => file.startsWith("src/hooks/"))).toBe(true);
    expect(inputs.some((file) => file.startsWith("shared/"))).toBe(true);
    expect(inputs).not.toContain(RENDER_SPEC);
  });

  it("classifies every browser-reachable runtime file as a browser smoke input", () => {
    const rejected = notBrowserClassified(browserInputs());
    const unclassified = rejected.filter((file) => !EXEMPTIONS.has(file));
    // An entry that is no longer reachable, or is now browser-classified, is stale.
    const staleExemptions = [...EXEMPTIONS.keys()].filter((file) => !rejected.includes(file));
    const reasonless = [...EXEMPTIONS].filter(([, reason]) => reason.trim() === "").map(([file]) => file);
    expect({ unclassified, staleExemptions, reasonless }).toEqual({
      unclassified: [],
      staleExemptions: [],
      reasonless: [],
    });
  });
});
