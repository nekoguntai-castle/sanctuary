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

const RETIRED_ENTRIES = [
  ".dependency-cruiser.cjs",
  ".env.example",
  ".gitleaks.toml",
  ".gitleaksignore",
  ".jscpd.json",
  ".node-version",
  "App.tsx",
  "assets",
  "CHANGELOG.md",
  "components",
  "contexts",
  "CONTRIBUTING.md",
  "docker-compose.monitoring.yml",
  "docker-compose.prod.yml",
  "docker-compose.ssl.yml",
  "docker-compose.test.yml",
  "docker-compose.tor.yml",
  "DOCKER.md",
  "Dockerfile",
  "e2e",
  "eslint.config.js",
  "global.d.ts",
  "hooks",
  "index.html",
  "index.tsx",
  "metadata.json",
  "playwright.config.ts",
  "providers",
  "public",
  "README.template.md",
  "services",
  "stryker.config.mjs",
  "themes",
  "tools",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.scripts.json",
  "tsconfig.tests.json",
  "types",
  "utils",
  "vite.config.ts",
  "vite.nodePolyfills.ts",
  "vitest.config.ts",
  "vitest.coverage-shard.config.ts",
  "website",
];

function config(overrides = {}) {
  return {
    $schema: "./root-layout-classification.schema.json",
    schemaVersion: 2,
    baseline: { total: 67, files: 42, directories: 25 },
    maximumFiles: 10,
    maximumDirectories: 12,
    classifications: {
      conventional: { files: ["README.md"], directories: [] },
      generated: { files: [], directories: [] },
      project: { files: [], directories: ["docs", "src"] },
      tooling: { files: ["package.json"], directories: [] },
    },
    retiredEntries: ["legacy"],
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

test("accepts a complete typed classification within both final caps", () => {
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

test("rejects unclassified, stale, kind-mismatched, and retired entries", () => {
  const value = config();
  value.classifications.project.directories = ["docs", "missing", "src"];
  value.classifications.tooling.files = ["package.json", "wrong-kind"];
  const result = evaluateLayout(parseConfig(value), [
    ...TRACKED,
    "legacy/file.txt",
    "new-root.ts",
    "wrong-kind/file.ts",
  ]);
  assert.ok(result.errors.includes("unclassified tracked root entry: legacy"));
  assert.ok(
    result.errors.includes("unclassified tracked root entry: new-root.ts"),
  );
  assert.ok(
    result.errors.includes("stale project root classification: missing"),
  );
  assert.ok(
    result.errors.includes(
      "root entry kind mismatch: wrong-kind is tracked as directory, classified as file",
    ),
  );
  assert.ok(
    result.errors.includes("retired root entry has been reintroduced: legacy"),
  );
});

test("enforces file and directory caps independently", () => {
  const files = Array.from(
    { length: 11 },
    (_, index) => `file-${String(index).padStart(2, "0")}.txt`,
  );
  const directories = Array.from(
    { length: 13 },
    (_, index) => `dir-${String(index).padStart(2, "0")}`,
  );
  const fileConfig = config({
    classifications: {
      conventional: { files: [], directories: [] },
      generated: { files: [], directories: [] },
      project: { files, directories: [] },
      tooling: { files: [], directories: [] },
    },
  });
  const fileResult = evaluateLayout(parseConfig(fileConfig), files);
  assert.ok(
    fileResult.errors.includes("tracked root has 11 files; maximum is 10"),
  );
  assert.ok(!fileResult.errors.some((error) => error.includes("directories;")));

  const directoryConfig = config({
    classifications: {
      conventional: { files: [], directories: [] },
      generated: { files: [], directories: [] },
      project: { files: [], directories },
      tooling: { files: [], directories: [] },
    },
  });
  const directoryResult = evaluateLayout(
    parseConfig(directoryConfig),
    directories.map((entry) => `${entry}/file.txt`),
  );
  assert.ok(
    directoryResult.errors.includes(
      "tracked root has 13 directories; maximum is 12",
    ),
  );
  assert.ok(!directoryResult.errors.some((error) => error.includes("files;")));
});

test("rejects malformed v2 schemas, caps, categories, kinds, and paths", () => {
  assert.throws(() => parseConfig("{"), /not valid JSON/);
  assert.throws(() => parseConfig(config({ schemaVersion: 1 })), /unsupported/);
  assert.throws(
    () => parseConfig(config({ maximumEntries: 22, targetMaxEntries: 22 })),
    /unsupported fields/,
  );
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
    () => parseConfig(config({ maximumFiles: 11 })),
    /maximumFiles must remain 10/,
  );
  assert.throws(
    () => parseConfig(config({ maximumDirectories: 13 })),
    /maximumDirectories must remain 12/,
  );

  const missingCategory = config();
  delete missingCategory.classifications.generated;
  assert.throws(() => parseConfig(missingCategory), /missing fields/);
  const missingKind = config();
  delete missingKind.classifications.project.files;
  assert.throws(() => parseConfig(missingKind), /missing fields/);
  const unsorted = config();
  unsorted.classifications.project.directories = ["src", "docs"];
  assert.throws(() => parseConfig(unsorted), /must be sorted/);
  const nested = config();
  nested.classifications.project.directories = ["docs", "src/index.ts"];
  assert.throws(() => parseConfig(nested), /top-level path segment/);
  const unsortedRetired = config({ retiredEntries: ["z", "a"] });
  assert.throws(
    () => parseConfig(unsortedRetired),
    /retiredEntries must be sorted/,
  );
  const duplicateRetired = config({ retiredEntries: ["legacy", "legacy"] });
  assert.throws(
    () => parseConfig(duplicateRetired),
    /retiredEntries must not contain duplicates/,
  );
});

test("rejects duplicate classifications across categories and kinds", () => {
  const duplicateCategory = config();
  duplicateCategory.classifications.generated.files = ["README.md"];
  assert.throws(
    () => parseConfig(duplicateCategory),
    /duplicate root classification: README\.md/,
  );

  const duplicateKind = config();
  duplicateKind.classifications.conventional.directories = ["README.md"];
  assert.throws(
    () => parseConfig(duplicateKind),
    /duplicate root classification: README\.md/,
  );
});

test("rejects overlap between retained and retired entries", () => {
  assert.throws(
    () => parseConfig(config({ retiredEntries: ["README.md"] })),
    /retired root entry is still classified: README\.md/,
  );
});

test("JSON Schema mirrors the immutable baseline, strict caps, and typed lists", () => {
  const schema = JSON.parse(
    readFileSync(
      "scripts/quality/root-layout-classification.schema.json",
      "utf8",
    ),
  );
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.deepEqual(schema.properties.baseline.properties, {
    total: { const: 67 },
    files: { const: 42 },
    directories: { const: 25 },
  });
  assert.equal(schema.properties.maximumFiles.const, 10);
  assert.equal(schema.properties.maximumDirectories.const, 12);
  assert.deepEqual(schema.$defs.classificationGroup.required, [
    "files",
    "directories",
  ]);
  assert.equal(schema.properties.retiredEntries.$ref, "#/$defs/entryList");
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

test("CLI JSON mode emits one parseable JSON document", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/quality/check-root-layout.mjs", "--json"],
    { encoding: "utf8" },
  );
  const result = JSON.parse(output);
  assert.deepEqual(result.counts, { total: 22, files: 10, directories: 12 });
  assert.deepEqual(result.errors, []);
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

test("the real repository matches the exact typed 10-file/12-directory allowlist", () => {
  const result = runCheck();
  assert.deepEqual(result.counts, { total: 22, files: 10, directories: 12 });
  assert.deepEqual(result.inventory, [
    { path: ".dockerignore", kind: "file" },
    { path: ".github", kind: "directory" },
    { path: ".gitignore", kind: "file" },
    { path: ".nvmrc", kind: "file" },
    { path: "config", kind: "directory" },
    { path: "docker", kind: "directory" },
    { path: "docker-compose.yml", kind: "file" },
    { path: "docs", kind: "directory" },
    { path: "gateway", kind: "directory" },
    { path: "install.sh", kind: "file" },
    { path: "llm-egress-proxy", kind: "directory" },
    { path: "package-lock.json", kind: "file" },
    { path: "package.json", kind: "file" },
    { path: "README.md", kind: "file" },
    { path: "scripts", kind: "directory" },
    { path: "server", kind: "directory" },
    { path: "shared", kind: "directory" },
    { path: "src", kind: "directory" },
    { path: "start.sh", kind: "file" },
    { path: "tasks", kind: "directory" },
    { path: "tests", kind: "directory" },
    { path: "uninstall.sh", kind: "file" },
  ]);
  assert.deepEqual(result.errors, []);
});

test("the real contract prohibits every entry removed from the baseline", () => {
  const result = runCheck();
  assert.deepEqual(result.config.retiredEntries, RETIRED_ENTRIES);
  const actual = new Set(result.inventory.map(({ path }) => path));
  for (const retired of RETIRED_ENTRIES)
    assert.ok(!actual.has(retired), retired);
  assert.equal(
    result.config.baseline.total,
    result.counts.total + result.config.retiredEntries.length,
  );
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
  for (const file of listTrackedFiles().filter((path) =>
    codeExtensions.test(path),
  )) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(['"`])((?:\.\.?\/)[^'"`\n]+)\1/g)) {
      const specifier = match[2].split(/[?#]/, 1)[0];
      const target = posix.normalize(
        posix.join(posix.dirname(file), specifier),
      );
      const root = target.split("/", 1)[0];
      if (retiredRoots.has(root))
        errors.push(
          `${file}: ${specifier} resolves into retired root ${root}/`,
        );
    }
  }
  assert.deepEqual(errors, []);
});
