#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryPath = "config/hardware-emulator-source-inventory.json";
export const HARDWARE_EMULATOR_VENDORS = Object.freeze([
  "trezor",
  "ledger",
  "jade",
]);

function fail(message) {
  throw new Error(`hardware emulator source inventory: ${message}`);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function validateSelectorText(selector, label) {
  if (typeof selector !== "string" || selector.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(selector)) {
    fail(`${label} contains control characters`);
  }
}

function validateRepositoryRelativePath(selector, label) {
  if (
    selector.includes("\\") ||
    isAbsolute(selector) ||
    selector.startsWith("/")
  ) {
    fail(`${label} must be a POSIX repository-relative path`);
  }
  if (
    selector === "." ||
    selector.endsWith("/") ||
    posix.normalize(selector) !== selector
  ) {
    fail(`${label} is not normalized`);
  }
  if (
    selector.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    fail(`${label} contains traversal or an empty segment`);
  }
}

function validateWildcardSyntax(selector, label, allowWildcards) {
  const hasWildcard = selector.includes("*");
  if (allowWildcards && !hasWildcard) {
    fail(`${label} must contain a wildcard`);
  }
  if (
    allowWildcards &&
    (/[*]{3,}/u.test(selector) ||
      selector.includes("?") ||
      selector.includes("[") ||
      selector.includes("]"))
  ) {
    fail(`${label} uses unsupported glob syntax; only * and ** are supported`);
  }
  if (!allowWildcards && hasWildcard) {
    fail(`${label} must be exact; put wildcards in patterns`);
  }
}

function validateSelector(selector, label, allowWildcards) {
  validateSelectorText(selector, label);
  validateRepositoryRelativePath(selector, label);
  validateWildcardSyntax(selector, label, allowWildcards);
}

function validateScope(scope, label) {
  assertExactKeys(scope, ["files", "patterns"], label);
  if (!Array.isArray(scope.files) || !Array.isArray(scope.patterns)) {
    fail(`${label}.files and ${label}.patterns must be arrays`);
  }
  if (scope.files.length + scope.patterns.length === 0) {
    fail(`${label} must contain at least one selector`);
  }
  scope.files.forEach((selector, index) =>
    validateSelector(selector, `${label}.files[${index}]`, false),
  );
  scope.patterns.forEach((selector, index) =>
    validateSelector(selector, `${label}.patterns[${index}]`, true),
  );
  const selectors = [...scope.files, ...scope.patterns];
  if (new Set(selectors).size !== selectors.length) {
    fail(`${label} contains duplicate selectors`);
  }
}

export function validateInventoryShape(inventory) {
  assertExactKeys(inventory, ["schemaVersion", "common", "vendors"], "root");
  if (inventory.schemaVersion !== 1) {
    fail("schemaVersion must equal 1");
  }
  validateScope(inventory.common, "common");
  assertExactKeys(inventory.vendors, HARDWARE_EMULATOR_VENDORS, "vendors");
  for (const vendor of HARDWARE_EMULATOR_VENDORS) {
    validateScope(inventory.vendors[vendor], `vendors.${vendor}`);
  }
  return inventory;
}

export function matchesRepositoryPattern(file, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${expression}$`).test(file);
}

function validateRepositoryFiles(repositoryFiles) {
  if (!Array.isArray(repositoryFiles) || repositoryFiles.length === 0) {
    fail("repository file inventory must be a non-empty array");
  }
  for (const [index, file] of repositoryFiles.entries()) {
    validateSelector(file, `repositoryFiles[${index}]`, false);
  }
  if (new Set(repositoryFiles).size !== repositoryFiles.length) {
    fail("repository file inventory contains duplicates");
  }
  return [...repositoryFiles].sort();
}

function expandScope(scope, repositoryFiles, label) {
  const selected = [];
  const selectedBy = new Map();
  for (const file of scope.files) {
    if (!repositoryFiles.includes(file)) {
      fail(`${label} exact file does not exist: ${file}`);
    }
    selected.push(file);
    selectedBy.set(file, file);
  }
  for (const pattern of scope.patterns) {
    const matches = repositoryFiles.filter((file) =>
      matchesRepositoryPattern(file, pattern),
    );
    if (matches.length === 0) {
      fail(`${label} pattern matches no repository files: ${pattern}`);
    }
    for (const file of matches) {
      if (selectedBy.has(file)) {
        fail(
          `${label} selectors overlap on ${file}: ${selectedBy.get(file)} and ${pattern}`,
        );
      }
      selected.push(file);
      selectedBy.set(file, pattern);
    }
  }
  return selected.sort();
}

export function expandInventory(inventory, repositoryFiles) {
  validateInventoryShape(inventory);
  const files = validateRepositoryFiles(repositoryFiles);
  const declaredScopes = {
    common: expandScope(inventory.common, files, "common"),
  };
  for (const vendor of HARDWARE_EMULATOR_VENDORS) {
    declaredScopes[vendor] = expandScope(
      inventory.vendors[vendor],
      files,
      `vendors.${vendor}`,
    );
  }

  const owners = new Map();
  for (const [scope, paths] of Object.entries(declaredScopes)) {
    for (const path of paths) {
      if (owners.has(path)) {
        fail(
          `declared scopes overlap on ${path}: ${owners.get(path)} and ${scope}`,
        );
      }
      owners.set(path, scope);
    }
  }

  return {
    common: declaredScopes.common,
    vendors: Object.fromEntries(
      HARDWARE_EMULATOR_VENDORS.map((vendor) => [
        vendor,
        [...declaredScopes.common, ...declaredScopes[vendor]].sort(),
      ]),
    ),
  };
}

export function resolveVendorSources(inventory, repositoryFiles, vendor) {
  if (!HARDWARE_EMULATOR_VENDORS.includes(vendor)) {
    fail(`unknown vendor: ${vendor}`);
  }
  return expandInventory(inventory, repositoryFiles).vendors[vendor];
}

export async function loadInventory(root = repoRoot) {
  const text = await readFile(resolve(root, inventoryPath), "utf8");
  return JSON.parse(text);
}

export async function listRepositoryFiles(root = repoRoot) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

async function listGitPaths(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

export async function listDirtyRepositoryFiles(root = repoRoot) {
  const [unstaged, staged, untracked] = await Promise.all([
    listGitPaths(root, ["diff", "--no-renames", "--name-only", "-z", "--"]),
    listGitPaths(root, [
      "diff",
      "--cached",
      "--no-renames",
      "--name-only",
      "-z",
      "--",
    ]),
    listGitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...unstaged, ...staged, ...untracked])].sort();
}

function scopeSelectsPath(scope, path) {
  return (
    scope.files.includes(path) ||
    scope.patterns.some((pattern) => matchesRepositoryPattern(path, pattern))
  );
}

export function findRelevantDirtySources(inventory, dirtyPaths, vendor) {
  validateInventoryShape(inventory);
  if (!HARDWARE_EMULATOR_VENDORS.includes(vendor)) {
    fail(`unknown vendor: ${vendor}`);
  }
  const scopes = [inventory.common, inventory.vendors[vendor]];
  return [...new Set(dirtyPaths)]
    .filter((path) => scopes.some((scope) => scopeSelectsPath(scope, path)))
    .sort();
}

async function assertRegularSources(root, sources) {
  for (const source of sources) {
    const stats = await lstat(resolve(root, source));
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(`selected source is not a regular file: ${source}`);
    }
  }
}

export async function checkInventory(root = repoRoot, options = {}) {
  const [inventory, repositoryFiles] = await Promise.all([
    loadInventory(root),
    listRepositoryFiles(root),
  ]);
  const expanded = expandInventory(inventory, repositoryFiles);
  if (options.requireCleanVendor !== undefined) {
    const vendor = options.requireCleanVendor;
    const dirtyPaths = await listDirtyRepositoryFiles(root);
    const relevantDirtySources = findRelevantDirtySources(
      inventory,
      dirtyPaths,
      vendor,
    );
    if (relevantDirtySources.length > 0) {
      fail(
        `cannot attest dirty sources for ${vendor}: ${relevantDirtySources.join(", ")}`,
      );
    }
    await assertRegularSources(root, expanded.vendors[vendor]);
  }
  return expanded;
}

function usage() {
  return "usage: hardware-emulator-source-inventory.mjs validate | list --vendor <trezor|ledger|jade> --format lines [--require-clean]";
}

export async function runCli(
  args,
  root = repoRoot,
  writeOutput = (text) => process.stdout.write(text),
) {
  if (args.length === 1 && args[0] === "validate") {
    await checkInventory(root);
    writeOutput("hardware emulator source inventory is valid\n");
    return;
  }
  if (
    (args.length === 5 ||
      (args.length === 6 && args[5] === "--require-clean")) &&
    args[0] === "list" &&
    args[1] === "--vendor" &&
    args[3] === "--format" &&
    args[4] === "lines"
  ) {
    const vendor = args[2];
    if (!HARDWARE_EMULATOR_VENDORS.includes(vendor)) {
      fail(`unknown vendor: ${vendor}`);
    }
    const expanded = await checkInventory(root, {
      requireCleanVendor: args.length === 6 ? vendor : undefined,
    });
    writeOutput(`${expanded.vendors[vendor].join("\n")}\n`);
    return;
  }
  fail(usage());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
