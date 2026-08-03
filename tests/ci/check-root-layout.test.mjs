import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { test } from "node:test";

import {
  evaluateLayout,
  inventoryTrackedFiles,
  listTrackedFiles,
  parseConfig,
  runCheck,
} from "../../scripts/quality/check-root-layout.mjs";

function config(overrides = {}) {
  return {
    $schema: "./root-layout-classification.schema.json",
    schemaVersion: 1,
    baseline: { total: 67, files: 42, directories: 25 },
    maximumEntries: 67,
    targetMaxEntries: 45,
    classifications: {
      conventional: ["README.md"],
      generated: [],
      project: ["docs", "src"],
      tooling: ["package.json"],
    },
    ...overrides,
  };
}

const TRACKED = ["README.md", "docs/guide.md", "package.json", "src/index.ts"];

test("inventories tracked top-level files and directories deterministically", () => {
  assert.deepEqual(inventoryTrackedFiles([...TRACKED].reverse()), [
    { path: "docs", kind: "directory" },
    { path: "package.json", kind: "file" },
    { path: "README.md", kind: "file" },
    { path: "src", kind: "directory" },
  ]);
  assert.throws(
    () => inventoryTrackedFiles(["entry", "entry/file"]),
    /both a file and directory/,
  );
});

test("accepts a complete classification below the current ceiling", () => {
  const result = evaluateLayout(parseConfig(config()), TRACKED);
  assert.deepEqual(result.counts, { total: 4, files: 2, directories: 2 });
  assert.deepEqual(result.classificationCounts, {
    conventional: 1,
    generated: 0,
    project: 2,
    tooling: 1,
  });
  assert.deepEqual(result.errors, []);
});

test("rejects unclassified, stale, duplicate, and over-ceiling entries", () => {
  const value = config({ maximumEntries: 45 });
  value.classifications.project = ["docs", "missing", "src"];
  const extras = Array.from(
    { length: 41 },
    (_, index) => `extra-${String(index).padStart(2, "0")}.ts`,
  );
  value.classifications.tooling = ["README.md", ...extras, "package.json"].sort(
    (a, b) => a.localeCompare(b),
  );
  const result = evaluateLayout(parseConfig(value), [
    ...TRACKED,
    ...extras,
    "new-root.ts",
  ]);
  assert.ok(
    result.errors.includes("unclassified tracked root entry: new-root.ts"),
  );
  assert.ok(
    result.errors.includes("stale project root classification: missing"),
  );
  assert.match(
    result.errors.join("\n"),
    /duplicate root classification: README\.md/,
  );
  assert.ok(
    result.errors.includes(
      "tracked root has 46 entries; current maximum is 45",
    ),
  );
});

test("accepts the cap boundary and rejects cap plus one", () => {
  const entries = Array.from(
    { length: 45 },
    (_, index) => `entry-${String(index).padStart(2, "0")}.ts`,
  );
  const value = config({
    maximumEntries: 45,
    classifications: {
      conventional: [],
      generated: [],
      project: [],
      tooling: entries,
    },
  });
  assert.deepEqual(evaluateLayout(parseConfig(value), entries).errors, []);
  const result = evaluateLayout(parseConfig(value), [...entries, "extra.ts"]);
  assert.ok(
    result.errors.includes(
      "tracked root has 46 entries; current maximum is 45",
    ),
  );
});

test("rejects malformed schemas, counts, categories, and paths", () => {
  assert.throws(() => parseConfig("{"), /not valid JSON/);
  assert.throws(() => parseConfig(config({ schemaVersion: 2 })), /unsupported/);
  assert.throws(
    () => parseConfig(config({ extra: true })),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      parseConfig(
        config({ baseline: { total: 100, files: 75, directories: 25 } }),
      ),
    /baseline\.total must remain 67/,
  );
  assert.throws(
    () => parseConfig(config({ targetMaxEntries: 66 })),
    /targetMaxEntries must remain 45/,
  );
  assert.throws(
    () => parseConfig(config({ maximumEntries: 68 })),
    /cannot exceed/,
  );
  assert.throws(
    () => parseConfig(config({ maximumEntries: 44 })),
    /cannot be below/,
  );
  const missingCategory = config();
  delete missingCategory.classifications.generated;
  assert.throws(() => parseConfig(missingCategory), /missing fields/);
  const unsorted = config();
  unsorted.classifications.project = ["src", "docs"];
  assert.throws(() => parseConfig(unsorted), /must be sorted/);
  const nested = config();
  nested.classifications.project = ["docs", "src/index.ts"];
  assert.throws(() => parseConfig(nested), /top-level path segment/);
});

test("JSON Schema pins the baseline and target while bounding the migration ceiling", () => {
  const schema = JSON.parse(
    readFileSync(
      "scripts/quality/root-layout-classification.schema.json",
      "utf8",
    ),
  );
  assert.deepEqual(schema.properties.baseline.properties, {
    total: { const: 67 },
    files: { const: 42 },
    directories: { const: 25 },
  });
  assert.deepEqual(schema.properties.maximumEntries, {
    description:
      "Current non-increasing ceiling; lower this after each atomic path migration.",
    type: "integer",
    minimum: 45,
    maximum: 67,
  });
  assert.deepEqual(schema.properties.targetMaxEntries, {
    description:
      "Bounded final target retained independently from the current migration ceiling.",
    const: 45,
  });
});

test("uses NUL-delimited tracked Git paths and fails closed on Git errors", () => {
  const runner = (_command, args) => {
    assert.deepEqual(args.slice(-2), ["ls-files", "-z"]);
    return "README.md\0docs/guide with spaces.md\0docs/other.md\0";
  };
  assert.deepEqual(listTrackedFiles("/fixture", runner), [
    "README.md",
    "docs/guide with spaces.md",
    "docs/other.md",
  ]);
  assert.throws(
    () =>
      listTrackedFiles("/fixture", () => {
        throw new Error("git failed");
      }),
    /unable to inventory.*git failed/,
  );
});

test("real Git inventory collapses nested paths and ignores untracked files", () => {
  const root = mkdtempSync(join(tmpdir(), "sanctuary-root-layout-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "README.md"), "tracked\n");
    writeFileSync(join(root, "docs", "guide with spaces.md"), "tracked\n");
    writeFileSync(join(root, "untracked.md"), "ignored by inventory\n");
    execFileSync("git", [
      "-C",
      root,
      "add",
      "README.md",
      "docs/guide with spaces.md",
    ]);
    const tracked = listTrackedFiles(root);
    assert.deepEqual(tracked, ["README.md", "docs/guide with spaces.md"]);
    assert.deepEqual(inventoryTrackedFiles(tracked), [
      { path: "docs", kind: "directory" },
      { path: "README.md", kind: "file" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository classification is complete", () => {
  const result = runCheck();
  assert.deepEqual(result.counts, { total: 50, files: 33, directories: 17 });
  assert.deepEqual(result.errors, []);
});

test("live code has no relative reference back into a retired frontend root", () => {
  const retiredRoots = new Set([
    "components",
    "contexts",
    "hooks",
    "providers",
    "services",
    "themes",
    "types",
    "utils",
  ]);
  const codeExtensions = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
  const errors = [];
  for (const file of listTrackedFiles().filter((path) => codeExtensions.test(path))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(['"`])((?:\.\.?\/)[^'"`\n]+)\1/g)) {
      const specifier = match[2].split(/[?#]/, 1)[0];
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      const root = target.split("/", 1)[0];
      if (retiredRoots.has(root)) errors.push(`${file}: ${specifier} resolves into retired root ${root}/`);
    }
  }
  assert.deepEqual(errors, []);
});
