import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drift guard: every file the render-regression harness imports must select
 * the render lane in scripts/ci/classify-files-lib.sh (`is_render_file`), or a
 * PR touching only that file skips Full Render E2E while changing what it
 * renders (D-11.17 of the iteration-11 bug-scrub plan).
 *
 * The walk starts at the harness entry points and follows every relative
 * specifier quoted with ', " or `: `import`, `import type`, `export ... from`
 * and dynamic `import()`. Type-only reachability is excluded by path
 * (src/types/** and src/api/**\/types.ts), never by import kind.
 *
 * Known residual: tests/e2e/* does not select the root Vitest lane, so a PR
 * that only adds a new harness import is caught by the scheduled full scan,
 * not on that PR.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const HARNESS_DIR = "tests/e2e/render-regression";
const HARNESS_SPEC = "tests/e2e/render-regression.spec.ts";
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`]*?)\1/g;
const HARNESS_TREE = /^tests\/e2e\/render-regression(?:\.spec\.ts$|\/)/;
const TYPE_ONLY_TREE = /^src\/types\/|^src\/api\/(?:.*\/)?types\.ts$/;

/** Harness-reachable files deliberately outside the render lane, with the reason. */
const ALLOWLIST = new Map<string, string>();

function isFile(relative: string): boolean {
  const absolute = path.join(REPO_ROOT, relative);
  return existsSync(absolute) && statSync(absolute).isFile();
}

function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  return RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(isFile);
}

function relativeImports(file: string): string[] {
  const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
  return [...source.matchAll(IMPORT_RE)].map((match) => match[2]);
}

function entryPoints(): string[] {
  const harnessFiles = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", HARNESS_DIR], { encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file));
  return [HARNESS_SPEC, ...harnessFiles];
}

function reachableFiles(): Set<string> {
  const seen = new Set<string>();
  const queue = entryPoints();
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of relativeImports(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target === undefined) throw new Error(`unresolved import ${specifier} in ${file}`);
      queue.push(target);
    }
  }
  return seen;
}

function harnessInputs(): string[] {
  return [...reachableFiles()]
    .filter((file) => !HARNESS_TREE.test(file) && !TYPE_ONLY_TREE.test(file))
    .sort();
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

describe("render-regression harness inputs select the render lane", () => {
  it("reaches the shared e2e helpers through double-quoted and type-only imports", () => {
    const inputs = harnessInputs();
    expect(inputs).toEqual(expect.arrayContaining(["tests/e2e/helpers.ts", "tests/e2e/apiSimulator.ts"]));
  });

  it("classifies every harness-reachable file as a render input", () => {
    const rejected = notRenderClassified(harnessInputs());
    const unclassified = rejected.filter((file) => !ALLOWLIST.has(file));
    // An entry that is no longer reachable, or is now render-classified, is stale.
    const staleAllowlist = [...ALLOWLIST.keys()].filter((file) => !rejected.includes(file));
    expect({ unclassified, staleAllowlist }).toEqual({ unclassified: [], staleAllowlist: [] });
  });
});
