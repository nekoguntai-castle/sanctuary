#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

function matchesClassifierPath(file, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${expression}$`).test(file);
}

export function validateClassifier(manifest, workflowText, repositoryFiles) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.paths) || manifest.paths.length === 0) {
    throw new Error("wallet-safety classifier manifest has an unsupported shape");
  }
  if (new Set(manifest.paths).size !== manifest.paths.length) {
    throw new Error("wallet-safety classifier paths must be unique");
  }
  for (const path of manifest.paths) {
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("wallet-safety classifier paths must be non-empty strings");
    }
    if (!repositoryFiles.some(file => matchesClassifierPath(file, path))) {
      throw new Error(`wallet-safety classifier path does not resolve: ${path}`);
    }
  }
  for (const event of ["pull_request", "merge_group", "push", "schedule"]) {
    const eventPattern = new RegExp(`^  ${event}:`, "m");
    if (!eventPattern.test(workflowText)) {
      throw new Error(`verify-vectors workflow is missing event: ${event}`);
    }
  }
  const inlineEventFilter = /^  (?:pull_request|merge_group|push):[^\n]*(?:paths|paths-ignore)\s*:/m;
  if (/^[ \t]+paths(?:-ignore)?:/m.test(workflowText) || inlineEventFilter.test(workflowText)) {
    throw new Error("verify-vectors workflow must run without path filters");
  }
  if (!workflowText.includes("node scripts/ci/check-wallet-safety-classifier.mjs")) {
    throw new Error("verify-vectors workflow must execute the wallet-safety classifier");
  }
}

export async function checkWalletSafetyClassifier(root = repoRoot) {
  const manifestPath = resolve(root, "config/wallet-safety-critical-paths.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const workflowText = await readFile(resolve(root, manifest.workflow), "utf8");
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  const repositoryFiles = stdout.split("\n").filter(Boolean);
  validateClassifier(manifest, workflowText, repositoryFiles);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await checkWalletSafetyClassifier();
  process.stdout.write("wallet-safety classifier is complete\n");
}
