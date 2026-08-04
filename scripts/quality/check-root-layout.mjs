#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CONFIG = resolve(SCRIPT_DIR, "root-layout-classification.json");
const CATEGORY_NAMES = ["conventional", "generated", "project", "tooling"];
const IMMUTABLE_BASELINE = Object.freeze({
  total: 67,
  files: 42,
  directories: 25,
});
const FINAL_MAXIMUM_FILES = 10;
const FINAL_MAXIMUM_DIRECTORIES = 12;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unexpected.length > 0)
    throw new Error(
      `${label} has unsupported fields: ${unexpected.join(", ")}`,
    );
  if (missing.length > 0)
    throw new Error(`${label} is missing fields: ${missing.join(", ")}`);
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}`);
}

function requireEntry(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  if (value === "." || value === ".." || value.includes("/"))
    throw new Error(`${label} must be one top-level path segment`);
}

function validateCounts(counts) {
  if (!isPlainObject(counts)) throw new Error("baseline must be an object");
  assertExactKeys(counts, ["total", "files", "directories"], "baseline");
  for (const key of ["total", "files", "directories"])
    requireInteger(counts[key], `baseline.${key}`);
  if (counts.files + counts.directories !== counts.total)
    throw new Error("baseline file and directory counts must equal total");
  for (const key of ["total", "files", "directories"]) {
    if (counts[key] !== IMMUTABLE_BASELINE[key]) {
      throw new Error(`baseline.${key} must remain ${IMMUTABLE_BASELINE[key]}`);
    }
  }
}

function validateClassifications(classifications) {
  if (!isPlainObject(classifications))
    throw new Error("classifications must be an object");
  assertExactKeys(classifications, CATEGORY_NAMES, "classifications");
  for (const category of CATEGORY_NAMES) {
    const group = classifications[category];
    if (!isPlainObject(group))
      throw new Error(`classifications.${category} must be an object`);
    assertExactKeys(
      group,
      ["files", "directories"],
      `classifications.${category}`,
    );
    for (const kind of ["files", "directories"]) {
      const entries = group[kind];
      if (!Array.isArray(entries))
        throw new Error(`classifications.${category}.${kind} must be an array`);
      entries.forEach((entry, index) =>
        requireEntry(entry, `classifications.${category}.${kind}[${index}]`),
      );
      const sorted = [...entries].sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(sorted) !== JSON.stringify(entries))
        throw new Error(`classifications.${category}.${kind} must be sorted`);
    }
  }
}

function validateRetiredEntries(retiredEntries) {
  if (!Array.isArray(retiredEntries))
    throw new Error("retiredEntries must be an array");
  retiredEntries.forEach((entry, index) =>
    requireEntry(entry, `retiredEntries[${index}]`),
  );
  const sorted = [...retiredEntries].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(sorted) !== JSON.stringify(retiredEntries))
    throw new Error("retiredEntries must be sorted");
  if (new Set(retiredEntries).size !== retiredEntries.length)
    throw new Error("retiredEntries must not contain duplicates");
}

export function parseConfig(raw) {
  let config;
  try {
    config = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`root-layout config is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(config))
    throw new Error("root-layout config must be an object");
  const keys = [
    "$schema",
    "schemaVersion",
    "baseline",
    "maximumFiles",
    "maximumDirectories",
    "classifications",
    "retiredEntries",
  ];
  assertExactKeys(config, keys, "root-layout config");
  if (config.schemaVersion !== 2)
    throw new Error(
      `unsupported root-layout schema version: ${String(config.schemaVersion)}`,
    );
  if (config.$schema !== "./root-layout-classification.schema.json")
    throw new Error("root-layout config must reference its local schema");
  validateCounts(config.baseline);
  requireInteger(config.maximumFiles, "maximumFiles", 1);
  requireInteger(config.maximumDirectories, "maximumDirectories", 1);
  if (config.maximumFiles !== FINAL_MAXIMUM_FILES)
    throw new Error(`maximumFiles must remain ${FINAL_MAXIMUM_FILES}`);
  if (config.maximumDirectories !== FINAL_MAXIMUM_DIRECTORIES)
    throw new Error(
      `maximumDirectories must remain ${FINAL_MAXIMUM_DIRECTORIES}`,
    );
  validateClassifications(config.classifications);
  validateRetiredEntries(config.retiredEntries);

  const classified = new Map();
  for (const { path, category, kind } of flattenedClassifications(config)) {
    const previous = classified.get(path);
    if (previous) {
      throw new Error(
        `duplicate root classification: ${path} (${previous.category}/${previous.kind}, ${category}/${kind})`,
      );
    }
    classified.set(path, { category, kind });
  }
  for (const retired of config.retiredEntries) {
    if (classified.has(retired))
      throw new Error(`retired root entry is still classified: ${retired}`);
  }
  return config;
}

export function inventoryTrackedFiles(trackedFiles) {
  const entries = new Map();
  for (const trackedFile of trackedFiles) {
    requireEntry(trackedFile.split("/")[0], "tracked root entry");
    const separator = trackedFile.indexOf("/");
    const rootEntry =
      separator < 0 ? trackedFile : trackedFile.slice(0, separator);
    const kind = separator < 0 ? "file" : "directory";
    const previous = entries.get(rootEntry);
    if (previous && previous !== kind)
      throw new Error(
        `tracked root entry is both a file and directory: ${rootEntry}`,
      );
    entries.set(rootEntry, kind);
  }
  return [...entries]
    .map(([path, kind]) => ({ path, kind }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function flattenedClassifications(config) {
  return CATEGORY_NAMES.flatMap((category) => [
    ...config.classifications[category].files.map((path) => ({
      path,
      category,
      kind: "file",
    })),
    ...config.classifications[category].directories.map((path) => ({
      path,
      category,
      kind: "directory",
    })),
  ]);
}

function inventoryCounts(inventory) {
  const files = inventory.filter(({ kind }) => kind === "file").length;
  return {
    total: inventory.length,
    files,
    directories: inventory.length - files,
  };
}

export function evaluateLayout(config, trackedFiles) {
  const inventory = inventoryTrackedFiles(trackedFiles);
  const entries = flattenedClassifications(config);
  const actual = new Map(inventory.map(({ path, kind }) => [path, kind]));
  const classified = new Map();
  const errors = [];
  for (const { path, category, kind } of entries)
    classified.set(path, { category, kind });
  for (const { path, kind } of inventory) {
    if (!classified.has(path))
      errors.push(`unclassified tracked root entry: ${path}`);
    else if (classified.get(path).kind !== kind)
      errors.push(
        `root entry kind mismatch: ${path} is tracked as ${kind}, classified as ${classified.get(path).kind}`,
      );
  }
  for (const { path, category } of entries) {
    if (!actual.has(path))
      errors.push(`stale ${category} root classification: ${path}`);
  }
  for (const retired of config.retiredEntries) {
    if (actual.has(retired))
      errors.push(`retired root entry has been reintroduced: ${retired}`);
  }
  const counts = inventoryCounts(inventory);
  if (counts.files > config.maximumFiles) {
    errors.push(
      `tracked root has ${counts.files} files; maximum is ${config.maximumFiles}`,
    );
  }
  if (counts.directories > config.maximumDirectories) {
    errors.push(
      `tracked root has ${counts.directories} directories; maximum is ${config.maximumDirectories}`,
    );
  }
  return {
    inventory,
    counts,
    classificationCounts: Object.fromEntries(
      CATEGORY_NAMES.map((name) => [
        name,
        config.classifications[name].files.length +
          config.classifications[name].directories.length,
      ]),
    ),
    errors,
  };
}

export function listTrackedFiles(
  repoRoot = REPO_ROOT,
  gitRunner = execFileSync,
) {
  try {
    return gitRunner("git", ["-C", repoRoot, "ls-files", "-z"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    throw new Error(`unable to inventory tracked files: ${error.message}`);
  }
}

export function runCheck({
  repoRoot = REPO_ROOT,
  configPath = DEFAULT_CONFIG,
  gitRunner = execFileSync,
} = {}) {
  const config = parseConfig(readFileSync(configPath, "utf8"));
  return {
    config,
    ...evaluateLayout(config, listTrackedFiles(repoRoot, gitRunner)),
  };
}

function isMainModule() {
  return (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMainModule()) {
  try {
    const result = runCheck();
    const jsonOutput = process.argv.includes("--json");
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    if (result.errors.length > 0) throw new Error(result.errors.join("; "));
    if (!jsonOutput) {
      const classes = CATEGORY_NAMES.map(
        (name) => `${name}=${result.classificationCounts[name]}`,
      ).join(", ");
      console.log(
        `root-layout: ${result.counts.total} classified entries (${result.counts.files}/${result.config.maximumFiles} files, ${result.counts.directories}/${result.config.maximumDirectories} directories; ${classes})`,
      );
    }
  } catch (error) {
    console.error(
      `root-layout: failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
