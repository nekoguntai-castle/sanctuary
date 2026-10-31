import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drift guard: every file the render-regression lane loads must select the
 * render lane in scripts/ci/classify-files-lib.sh (`is_render_file`), or a PR
 * touching only that file skips Full Render E2E while changing what it
 * renders (D-11.17 of the iteration-11 bug-scrub plan).
 *
 * The render spec drives the built app (Playwright's webServer serves
 * `vite preview` in CI) against a mocked API, so the app's own import closure
 * from src/main.tsx and src/App.tsx is a render input (iteration 20).
 *
 * The walk starts at the harness entry points and the app entries, and
 * follows every relative, `@/` and `@sanctuary/shared/` specifier quoted with
 * ', " or `: `import`, `import type`, `export ... from` and dynamic `import()`,
 * skipping comment-only lines. Type-only reachability is excluded
 * by path (src/api/**\/types.ts), never by import kind. src/types/** is not
 * excluded: it holds runtime enums, labels and quorum helpers.
 *
 * Known residual: tests/e2e/* does not select the root Vitest lane, so a PR
 * that only adds a new harness import is caught by the scheduled full scan,
 * not on that PR.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const HARNESS_DIR = "tests/e2e/render-regression";
const HARNESS_SPEC = "tests/e2e/render-regression.spec.ts";
const APP_ENTRIES = ["src/main.tsx", "src/App.tsx"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`]*?|@\/[^'"`]*?|@sanctuary\/shared\/[^'"`]*?)\1/g;
const ALIASES: Array<[string, string]> = [
  ["@/", "src/"],
  ["@sanctuary/shared/", "shared/"],
];
/** Comment-only lines (JSDoc bodies, `//` and `/*` openers) carry usage examples, not imports. */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*).*$/gm;
const HARNESS_TREE = /^tests\/e2e\/render-regression(?:\.spec\.ts$|\/)/;
const TYPE_ONLY_TREE = /^src\/api\/(?:.*\/)?types\.ts$/;

/** Harness-reachable files deliberately outside the render lane, with the reason. */
const ALLOWLIST = new Map<string, string>();

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
  const harnessFiles = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", HARNESS_DIR], { encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file));
  return [HARNESS_SPEC, ...harnessFiles, ...APP_ENTRIES];
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

let memoizedRenderInputs: string[] | undefined;

/** Walked lazily once per module so both tests share it and a walk error fails a test, not collection. */
function renderInputs(): string[] {
  memoizedRenderInputs ??= [...reachableFiles()]
    .filter((file) => !HARNESS_TREE.test(file) && !TYPE_ONLY_TREE.test(file))
    .sort();
  return memoizedRenderInputs;
}

const CLASSIFY_SCRIPT = `. scripts/ci/classify-files-lib.sh
while IFS= read -r p; do
  is_render_file "$p" || printf '%s\\n' "$p"
done
`;

/** One bash call that sources the classifier library and prints the paths `is_render_file` rejects. */
function notRenderClassified(paths: string[]): string[] {
  const output = execFileSync("bash", ["-c", CLASSIFY_SCRIPT], {
    cwd: REPO_ROOT,
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

describe("render-regression harness and app inputs select the render lane", () => {
  it("reaches the shared e2e helpers and the app's runtime trees", () => {
    const inputs = renderInputs();
    expect(inputs).toEqual(
      expect.arrayContaining([
        "tests/e2e/helpers.ts",
        "tests/e2e/apiSimulator.ts",
        "src/App.tsx",
        "src/types/index.ts",
      ]),
    );
    for (const tree of ["src/api/", "src/services/", "src/hooks/", "shared/"]) {
      expect(inputs.some((file) => file.startsWith(tree)), tree).toBe(true);
    }
  });

  it("classifies every render-reachable file as a render input", () => {
    const rejected = notRenderClassified(renderInputs());
    const unclassified = rejected.filter((file) => !ALLOWLIST.has(file));
    // An entry that is no longer reachable, or is now render-classified, is stale.
    const staleAllowlist = [...ALLOWLIST.keys()].filter((file) => !rejected.includes(file));
    expect({ unclassified, staleAllowlist }).toEqual({ unclassified: [], staleAllowlist: [] });
  });
});
