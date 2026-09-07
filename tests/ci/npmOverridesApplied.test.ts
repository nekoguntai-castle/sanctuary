import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm install` only re-evaluates `overrides` when it re-resolves the tree. Adding
 * an entry and running `npm install --package-lock-only` against an existing lock
 * reports "up to date" and silently leaves the old version pinned, so an override
 * can look applied in `package.json` while the shipped tree still carries the
 * vulnerable copy. That is how GHSA-ggr8-5vv4-36mx (#830) was misdiagnosed as
 * having no local fix. npm never records `overrides` in the lockfile either, so
 * the only honest check reads resolved versions.
 *
 * npm honours `overrides` only from an install root — a manifest that owns a
 * lockfile. `overrides` declared by a workspace member is silently ignored, which
 * is how gateway/package.json carried a dead `@tootallnate/once` pin from the
 * moment #400 deleted gateway/package-lock.json. Both halves are asserted below.
 *
 * Install roots and workspace members are discovered, never hardcoded: a new
 * lockfile or workspace has to be covered rather than silently escaping.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const IGNORED_DIRS = new Set([
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "reports",
  "tasks",
  "test-results",
]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type Lockfile = { packages: Record<string, { version?: string }> };

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8")) as T;

/**
 * Every directory holding a package-lock.json — i.e. every manifest npm honours
 * `overrides` from. Symlinks are followed so a linked install root is still found,
 * with a real-path visited set so a link pointing at an ancestor terminates instead
 * of recursing until the stack overflows.
 */
const findInstallRoots = (relativeDir = "", visited = new Set<string>()): string[] => {
  const absolute = resolve(REPO_ROOT, relativeDir);
  let entries: string[];
  try {
    const realPath = realpathSync(absolute);
    if (visited.has(realPath)) return [];
    visited.add(realPath);
    entries = readdirSync(absolute);
  } catch {
    // Unreadable or vanished between stat and read: treat as holding no root,
    // consistent with how a dangling entry is skipped below.
    return [];
  }
  const roots = entries.includes("package-lock.json")
    && entries.includes("package.json")
    ? [relativeDir || "."]
    : [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;
    const child = relativeDir ? `${relativeDir}/${entry}` : entry;
    // Follow symlinks so a symlinked install root is still discovered, but treat
    // a dangling one as absent rather than letting it abort collection.
    let isDirectory = false;
    try {
      isDirectory = statSync(resolve(REPO_ROOT, child)).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) roots.push(...findInstallRoots(child, visited));
  }
  return roots;
};

const INSTALL_ROOTS = findInstallRoots().sort();
const WORKSPACE_MEMBERS = (
  readJson<{ workspaces?: string[] }>("package.json").workspaces ?? []
).slice().sort();

const pathIn = (root: string, file: string) =>
  root === "." ? file : `${root}/${file}`;

/**
 * Every resolved copy of `packageName`, keyed by lockfile path so a failure names
 * the entry that drifted. Matching anchors on the `node_modules/` path component,
 * so `toml` cannot match `node_modules/xyz-toml`. Link entries carry no version.
 */
const resolvedCopies = (
  lockfile: Lockfile,
  packageName: string,
): Record<string, string> => {
  const suffix = `node_modules/${packageName}`;
  return Object.fromEntries(
    Object.entries(lockfile.packages)
      .filter(([key]) => key === suffix || key.endsWith(`/${suffix}`))
      .filter(([, entry]) => typeof entry.version === "string")
      .map(([key, entry]) => [key, entry.version as string]),
  );
};

const overridesOf = (root: string) =>
  Object.entries(
    readJson<{ overrides?: Record<string, unknown> }>(
      pathIn(root, "package.json"),
    ).overrides ?? {},
  );

/**
 * Discovery is dynamic so a new lockfile cannot escape the checks, and the result
 * is pinned so a bug in the walk that silently drops a root fails here rather than
 * quietly reducing coverage. A genuinely new install root updates this list.
 */
const EXPECTED_INSTALL_ROOTS = [
  ".",
  "docs/site",
  "llm-egress-proxy",
  "scripts/verify-addresses",
  "scripts/verify-psbt",
  "tests/ci/lib",
];

const ROOTS_WITH_OVERRIDES = INSTALL_ROOTS.filter((r) => overridesOf(r).length);
const ROOTS_WITHOUT_OVERRIDES = INSTALL_ROOTS.filter((r) => !overridesOf(r).length);

describe("every npm install root is discovered and checked", () => {
  it("discovers exactly the known set of install roots", () => {
    expect(INSTALL_ROOTS).toEqual(EXPECTED_INSTALL_ROOTS);
  });

  it("has at least one override somewhere, so the assertions are not vacuous", () => {
    expect(ROOTS_WITH_OVERRIDES.length).toBeGreaterThan(0);
  });
});

describe.each(ROOTS_WITH_OVERRIDES)("install root %s", (root) => {
  const overrides = overridesOf(root);

  it.each(overrides)(
    "pins %s to an exact version so the lockfile can be compared against it",
    (packageName, specifier) => {
      // Ranges, $-references, `name@range` selector keys and nested-object
      // values are all legal npm syntax that this comparison cannot evaluate.
      expect(typeof specifier).toBe("string");
      expect(String(specifier)).toMatch(EXACT_VERSION);
      // A `name@range` selector key would not address a plain lockfile path.
      expect(packageName.indexOf("@", 1)).toBe(-1);
    },
  );

  it.each(overrides)(
    "resolves every copy of %s to %s",
    (packageName, specifier) => {
      const lock = readJson<Lockfile>(pathIn(root, "package-lock.json"));
      const copies = resolvedCopies(lock, packageName);
      // A dead override (nothing left to override) is drift too: delete the entry.
      expect(Object.keys(copies).length).toBeGreaterThan(0);
      expect(copies).toEqual(
        Object.fromEntries(Object.keys(copies).map((key) => [key, specifier])),
      );
    },
  );
});

describe.each(ROOTS_WITHOUT_OVERRIDES)("install root %s", (root) => {
  it("declares no overrides, so there is nothing to enforce", () => {
    expect(overridesOf(root)).toEqual([]);
  });
});

/**
 * npm reads `overrides` only from an install root, so a block in a workspace
 * member is a pin that looks enforced and enforces nothing.
 */
describe("workspace members declare no overrides npm would ignore", () => {
  it("resolves the workspace list from the root manifest", () => {
    expect(WORKSPACE_MEMBERS.length).toBeGreaterThan(0);
    // A glob would need expanding before the per-member checks below are complete.
    for (const member of WORKSPACE_MEMBERS) expect(member).not.toContain("*");
  });

  it.each(WORKSPACE_MEMBERS)(
    "%s/package.json declares no inert overrides block",
    (workspace) => {
      const manifest = readJson<{ overrides?: Record<string, unknown> }>(
        `${workspace}/package.json`,
      );
      expect(manifest.overrides).toBeUndefined();
    },
  );

  it("has no workspace member owning a lockfile that would make overrides live", () => {
    for (const member of WORKSPACE_MEMBERS) {
      expect(INSTALL_ROOTS).not.toContain(member);
    }
  });
});

describe("deepmerge-ts stays on the patched major (GHSA-ggr8-5vv4-36mx, #830)", () => {
  const majorOf = (version: string) => Number.parseInt(version, 10);

  it("is overridden to a release at or above the first patched 8.0.0", () => {
    const { overrides } = readJson<{ overrides: Record<string, string> }>(
      "package.json",
    );
    expect(majorOf(overrides["deepmerge-ts"] ?? "")).toBeGreaterThanOrEqual(8);
  });

  it("ships no copy below 8.0.0 in any lockfile", () => {
    const found = INSTALL_ROOTS.flatMap((root) =>
      Object.entries(
        resolvedCopies(
          readJson<Lockfile>(pathIn(root, "package-lock.json")),
          "deepmerge-ts",
        ),
      ).map(([location, version]) => [pathIn(root, location), version] as const),
    );
    expect(found.length).toBeGreaterThan(0);
    for (const [location, version] of found) {
      expect(`${location} -> ${majorOf(version) >= 8}`).toBe(
        `${location} -> true`,
      );
    }
  });
});
