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
const BOUNDED_TARGET = 45;

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
    const entries = classifications[category];
    if (!Array.isArray(entries))
      throw new Error(`classifications.${category} must be an array`);
    entries.forEach((entry, index) =>
      requireEntry(entry, `classifications.${category}[${index}]`),
    );
    const sorted = [...entries].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(sorted) !== JSON.stringify(entries))
      throw new Error(`classifications.${category} must be sorted`);
  }
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
    "maximumEntries",
    "targetMaxEntries",
    "classifications",
  ];
  assertExactKeys(config, keys, "root-layout config");
  if (config.schemaVersion !== 1)
    throw new Error(
      `unsupported root-layout schema version: ${String(config.schemaVersion)}`,
    );
  if (config.$schema !== "./root-layout-classification.schema.json")
    throw new Error("root-layout config must reference its local schema");
  validateCounts(config.baseline);
  requireInteger(config.maximumEntries, "maximumEntries", 1);
  requireInteger(config.targetMaxEntries, "targetMaxEntries", 1);
  if (config.targetMaxEntries !== BOUNDED_TARGET)
    throw new Error(`targetMaxEntries must remain ${BOUNDED_TARGET}`);
  if (config.maximumEntries > config.baseline.total)
    throw new Error("maximumEntries cannot exceed the baseline total");
  if (config.targetMaxEntries >= config.baseline.total)
    throw new Error("targetMaxEntries must be below the baseline total");
  if (config.maximumEntries < config.targetMaxEntries)
    throw new Error("maximumEntries cannot be below the bounded target");
  validateClassifications(config.classifications);
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
  return CATEGORY_NAMES.flatMap((category) =>
    config.classifications[category].map((path) => ({ path, category })),
  );
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
  const actual = new Set(inventory.map(({ path }) => path));
  const classified = new Map();
  const errors = [];
  for (const { path, category } of entries) {
    if (classified.has(path)) {
      errors.push(
        `duplicate root classification: ${path} (${classified.get(path)}, ${category})`,
      );
    } else {
      classified.set(path, category);
    }
  }
  for (const { path } of inventory) {
    if (!classified.has(path))
      errors.push(`unclassified tracked root entry: ${path}`);
  }
  for (const { path, category } of entries) {
    if (!actual.has(path))
      errors.push(`stale ${category} root classification: ${path}`);
  }
  if (inventory.length > config.maximumEntries) {
    errors.push(
      `tracked root has ${inventory.length} entries; current maximum is ${config.maximumEntries}`,
    );
  }
  return {
    inventory,
    counts: inventoryCounts(inventory),
    classificationCounts: Object.fromEntries(
      CATEGORY_NAMES.map((name) => [name, config.classifications[name].length]),
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
    if (process.argv.includes("--json"))
      console.log(JSON.stringify(result, null, 2));
    if (result.errors.length > 0) throw new Error(result.errors.join("; "));
    const classes = CATEGORY_NAMES.map(
      (name) => `${name}=${result.classificationCounts[name]}`,
    ).join(", ");
    console.log(
      `root-layout: ${result.counts.total} classified entries (${result.counts.files} files, ${result.counts.directories} directories; ${classes}); current maximum ${result.config.maximumEntries}, bounded target <=${result.config.targetMaxEntries}`,
    );
  } catch (error) {
    console.error(
      `root-layout: failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
