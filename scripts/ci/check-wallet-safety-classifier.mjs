#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);

export function matchesClassifierPath(file, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expression = escaped.replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*');
  return new RegExp(`^${expression}$`).test(file);
}

function validateManifestPaths(manifest, repositoryFiles) {
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.paths) ||
    manifest.paths.length === 0
  ) {
    throw new Error('wallet-safety classifier manifest has an unsupported shape');
  }
  if (new Set(manifest.paths).size !== manifest.paths.length) {
    throw new Error('wallet-safety classifier paths must be unique');
  }
  for (const path of manifest.paths) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('wallet-safety classifier paths must be non-empty strings');
    }
    if (!repositoryFiles.some((file) => matchesClassifierPath(file, path))) {
      throw new Error(`wallet-safety classifier path does not resolve: ${path}`);
    }
  }
}

function validateWorkflowEvents(workflowText) {
  for (const event of ['pull_request', 'merge_group', 'push', 'schedule']) {
    const eventPattern = new RegExp(`^  ${event}:`, 'm');
    if (!eventPattern.test(workflowText)) {
      throw new Error(`verify-vectors workflow is missing event: ${event}`);
    }
  }
}

function validateWorkflowPathFilters(workflowText) {
  const inlineEventFilter =
    /^  (?:pull_request|merge_group|push):[^\n]*(?:paths|paths-ignore)\s*:/m;
  if (/^[ \t]+paths(?:-ignore)?:/m.test(workflowText) || inlineEventFilter.test(workflowText)) {
    throw new Error('verify-vectors workflow must run without path filters');
  }
}

function validateClassifierCommand(workflowText) {
  if (!workflowText.includes('node scripts/ci/check-wallet-safety-classifier.mjs')) {
    throw new Error('verify-vectors workflow must execute the wallet-safety classifier');
  }
}

function validateProofManifest(proofManifest) {
  if (
    !proofManifest ||
    proofManifest.schemaVersion !== 1 ||
    typeof proofManifest.coreImage !== 'string' ||
    !/^bitcoin\/bitcoin:\d+\.\d+@sha256:[0-9a-f]{64}$/.test(proofManifest.coreImage) ||
    !Number.isSafeInteger(proofManifest.coreVersion) ||
    typeof proofManifest.coreSubversion !== 'string'
  ) {
    throw new Error('PSBT proof manifest must pin Bitcoin Core by digest');
  }
}

function validateCoreImage(workflowText, proofManifest) {
  if (!workflowText.includes(`VERIFY_PSBT_CORE_IMAGE: ${proofManifest.coreImage}`)) {
    throw new Error('verify-vectors workflow Bitcoin Core image must match the proof manifest');
  }
}

function validateProofCommands(workflowText) {
  for (const command of [
    'scripts/verify-psbt',
    'npm run verify',
    'psbt.signed-vectors.test.ts',
    'psbt.hardware-signed-vectors.test.ts',
    'npm run test:trezor-emulator-proof',
    'TREZOR_EMULATOR_PROOF_DIR',
    'TREZOR_EMULATOR_DIAGNOSTICS_DIR',
    'npm run test:ledger-emulator-proof',
    'LEDGER_EMULATOR_PROOF_DIR',
    'LEDGER_EMULATOR_DIAGNOSTICS_DIR',
  ]) {
    if (!workflowText.includes(command)) {
      throw new Error(
        `verify-vectors workflow is missing mandatory PSBT proof command: ${command}`
      );
    }
  }
}

function validateWorkflow(workflowText, proofManifest) {
  validateWorkflowEvents(workflowText);
  validateWorkflowPathFilters(workflowText);
  validateClassifierCommand(workflowText);
  validateProofManifest(proofManifest);
  validateCoreImage(workflowText, proofManifest);
  validateProofCommands(workflowText);
}

export function validateClassifier(manifest, workflowText, repositoryFiles, proofManifest) {
  validateManifestPaths(manifest, repositoryFiles);
  validateWorkflow(workflowText, proofManifest);
}

export async function checkWalletSafetyClassifier(root = repoRoot) {
  const manifestPath = resolve(root, 'config/wallet-safety-critical-paths.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const proofManifest = JSON.parse(
    await readFile(resolve(root, 'scripts/verify-psbt/proof-manifest.json'), 'utf8')
  );
  const workflowText = await readFile(resolve(root, manifest.workflow), 'utf8');
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, maxBuffer: 10 * 1024 * 1024 }
  );
  const repositoryFiles = stdout.split('\n').filter(Boolean);
  validateClassifier(manifest, workflowText, repositoryFiles, proofManifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await checkWalletSafetyClassifier();
  process.stdout.write('wallet-safety classifier is complete\n');
}
