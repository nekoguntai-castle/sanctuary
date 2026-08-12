#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ciRunId } from './provider-context.mjs';

function fail(message) {
  console.error(`record-command-timing: ${message}`);
  process.exit(1);
}

function parseInteger(value, name) {
  if (!/^\d+$/.test(value ?? '')) {
    fail(`${name} must be a non-negative integer`);
  }
  return Number(value);
}

function loadBudgets(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`could not read valid budget JSON at ${path}: ${error.message}`);
  }
  if (parsed?.schemaVersion !== 1 || typeof parsed.budgets !== 'object') {
    fail('budget file must have schemaVersion 1 and a budgets object');
  }
  for (const [label, budget] of Object.entries(parsed.budgets)) {
    if (
      !Number.isInteger(budget?.warnSeconds) ||
      !Number.isInteger(budget?.hardSeconds) ||
      budget.warnSeconds < 0 ||
      budget.hardSeconds < budget.warnSeconds
    ) {
      fail(`invalid warnSeconds/hardSeconds budget for ${label}`);
    }
  }
  return parsed.budgets;
}

function budgetLevel(elapsedSeconds, budget) {
  if (!budget) return 'unbudgeted';
  if (elapsedSeconds > budget.hardSeconds) return 'hard-limit';
  if (elapsedSeconds > budget.warnSeconds) return 'warning';
  return 'within-budget';
}

function writeRecord(path, record) {
  if (path === '-') return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
}

if (process.argv.length !== 9) {
  fail(
    'usage: record-command-timing.mjs OUTPUT BUDGETS LABEL ELAPSED EXIT_CODE START_EPOCH END_EPOCH',
  );
}

const [, , outputPath, budgetPath, label, elapsedArg, exitArg, startArg, endArg] = process.argv;
const elapsedSeconds = parseInteger(elapsedArg, 'elapsed seconds');
const exitCode = parseInteger(exitArg, 'exit code');
const startedAtEpochSeconds = parseInteger(startArg, 'start epoch');
const completedAtEpochSeconds = parseInteger(endArg, 'end epoch');
const budgets = loadBudgets(budgetPath);
const budget = budgets[label];
const level = budgetLevel(elapsedSeconds, budget);

writeRecord(outputPath, {
  schemaVersion: 1,
  label,
  elapsedSeconds,
  exitCode,
  startedAtEpochSeconds,
  completedAtEpochSeconds,
  budgetLevel: level,
  ...(budget ? { warnSeconds: budget.warnSeconds, hardSeconds: budget.hardSeconds } : {}),
  workflow: process.env.GITHUB_WORKFLOW ?? null,
  job: process.env.GITHUB_JOB ?? null,
  runId: ciRunId(),
  commitSha: process.env.GITHUB_SHA ?? null,
});

if (level === 'warning') {
  console.log(
    `::warning title=CI performance budget::${label} took ${elapsedSeconds}s; warning budget is ${budget.warnSeconds}s`,
  );
}
if (level === 'hard-limit') {
  console.error(
    `::error title=CI performance budget::${label} took ${elapsedSeconds}s; hard budget is ${budget.hardSeconds}s`,
  );
  process.exit(2);
}
