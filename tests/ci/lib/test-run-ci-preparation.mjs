#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

const workflowsDir = process.argv[2];
if (!workflowsDir) {
  throw new Error('usage: test-run-ci-preparation.mjs <workflow-directory>');
}

const TEST_SCRIPT = 'test:run:ci';
const SETUP_SERVER_DEPS = './.github/actions/setup-server-deps';
const DIRECT_SHARED_BUILD = /^npm\s+--workspace(?:=|\s+)shared\s+run\s+build$/;
const DIRECT_PRISMA_GENERATE = /^(?:npx\s+prisma\s+generate|npm\s+--workspace(?:=|\s+)server\s+run\s+prisma:generate)$/;
const WORKSPACE = String.raw`\$\{\{\s*github\.workspace\s*\}\}`;
const INSTALL_BLOCK_OPEN = new RegExp(
  String.raw`^${WORKSPACE}\/scripts\/ci\/run-with-log\.sh\s+"\$DIAGNOSTIC_DIR\/install-server-dependencies\.log"\s+${WORKSPACE}\/scripts\/ci\/with-runner-lock\.sh\s+node-toolchain\s+bash\s+-c\s+'$`,
);
const RETRIED_ROOT_INSTALL = new RegExp(
  String.raw`^${WORKSPACE}\/scripts\/ci\/retry-command\.sh\s+"[^"]+"\s+npm\s+ci\s+--strict-allow-scripts\s+--ignore-scripts$`,
);
const RETRIED_SHARED_BUILD = new RegExp(
  String.raw`^${WORKSPACE}\/scripts\/ci\/retry-command\.sh\s+"[^"]+"\s+npm\s+--workspace(?:=|\s+)shared\s+run\s+build$`,
);
const RETRIED_PRISMA_GENERATE = new RegExp(
  String.raw`^${WORKSPACE}\/scripts\/ci\/retry-command\.sh\s+"[^"]+"\s+npx\s+prisma\s+generate$`,
);

function normalizedCondition(step) {
  if (!Object.hasOwn(step, 'if')) return null;
  if (step.if === false || String(step.if).trim().toLowerCase() === 'false') {
    return false;
  }
  return String(step.if).trim();
}

function normalizedCommandLines(run) {
  return String(run)
    .replace(/\\\r?\n[ \t]*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsTestInvocation(run) {
  // Search the parsed scalar conservatively. Treating even an inert occurrence
  // as a possible invocation can create a reviewable false positive, but can
  // never let quoting, YAML folding, or shell continuation hide a real test.
  return normalizedCommandLines(run).join(' ').includes(TEST_SCRIPT);
}

function isCanonicalInstallBlock(step, lines) {
  return step.name === 'Install server dependencies' &&
    lines.length === 7 &&
    INSTALL_BLOCK_OPEN.test(lines[0]) &&
    lines[1] === 'set -euo pipefail' &&
    RETRIED_ROOT_INSTALL.test(lines[2]) &&
    RETRIED_SHARED_BUILD.test(lines[3]) &&
    lines[4] === 'cd server' &&
    RETRIED_PRISMA_GENERATE.test(lines[5]) &&
    lines[6] === "'";
}

function setupCommands(step) {
  const result = { shared: false, prisma: false };
  const lines = normalizedCommandLines(step.run);

  // Accept either a whole run step containing exactly one direct command, or
  // the exact fail-fast install block used by the wallet-vector jobs. Anything
  // with shell control flow, heredocs, functions, masking, or extra commands is
  // intentionally unrecognized and therefore fails closed.
  if (lines.length === 1) {
    result.shared = DIRECT_SHARED_BUILD.test(lines[0]);
    result.prisma = DIRECT_PRISMA_GENERATE.test(lines[0]);
  } else if (isCanonicalInstallBlock(step, lines)) {
    result.shared = true;
    result.prisma = true;
  }
  return result;
}

function isContinueOnError(step) {
  if (!Object.hasOwn(step, 'continue-on-error')) return false;
  return step['continue-on-error'] !== false &&
    String(step['continue-on-error']).trim().toLowerCase() !== 'false';
}

function usesSupportedRunShell(step, job, workflowDefaults) {
  const shell = step.shell ?? job.defaults?.run?.shell ?? workflowDefaults?.run?.shell;
  return shell === undefined || shell === null || String(shell).trim() === 'bash';
}

function preparationForTest(condition, evidence) {
  if (condition !== null) return { composite: false, shared: false, prisma: false };
  return evidence;
}

function hasRequiredPreparation(evidence) {
  return evidence.composite || (evidence.shared && evidence.prisma);
}

function recordSetupEvidence(step, condition, run, job, workflowDefaults, evidence) {
  if (condition !== null || isContinueOnError(step)) return;

  if (typeof step.uses === 'string' && step.uses.trim() === SETUP_SERVER_DEPS) {
    evidence.composite = true;
  }
  if (!run || !usesSupportedRunShell(step, job, workflowDefaults)) return;

  const commands = setupCommands(step);
  evidence.shared ||= commands.shared;
  evidence.prisma ||= commands.prisma;
}

function jobOffender(file, jobName, job, workflowDefaults) {
  if (!job || !Array.isArray(job.steps)) return null;

  const evidence = { composite: false, shared: false, prisma: false };
  for (const step of job.steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const condition = normalizedCondition(step);
    const run = typeof step.run === 'string' ? step.run : '';

    if (containsTestInvocation(run) && condition !== false) {
      // A conditional test can run in a state that did not execute an earlier
      // conditional setup (notably always()/failure()). The supported contract
      // is deliberately narrower: both preparation and test steps are blocking
      // and unconditional.
      const state = preparationForTest(condition, evidence);
      if (!hasRequiredPreparation(state)) {
        return `${basename(file)}:${jobName} (composite=${Number(state.composite)} shared=${Number(state.shared)} prisma=${Number(state.prisma)})`;
      }
    }

    // Setup in the same step is intentionally too late. Only record evidence
    // after checking the step for test invocations.
    recordSetupEvidence(step, condition, run, job, workflowDefaults, evidence);
  }
  return null;
}

const names = (await readdir(workflowsDir))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

for (const name of names) {
  const file = join(workflowsDir, name);
  const workflow = parse(await readFile(file, 'utf8'));
  const jobs = workflow?.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) continue;
  for (const [jobName, job] of Object.entries(jobs)) {
    const offender = jobOffender(file, jobName, job, workflow.defaults);
    if (offender) process.stdout.write(`${offender}\n`);
  }
}
