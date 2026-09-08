import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ciEnvFile } from './provider-context.mjs';

export const DEADLINE_VARIABLE = 'SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS';
export const JOB_STARTED_VARIABLE = 'SANCTUARY_CI_JOB_STARTED_EPOCH_MS';
const MAX_JOB_SECONDS = 24 * 60 * 60;

function positiveInteger(value, label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)
      || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} must be a canonical positive safe integer`);
  }
  return Number(value);
}

function validateClock(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid budget clock');
}

function jobStart(value, now) {
  if (value === undefined) return now;
  const started = positiveInteger(value, 'job started timestamp');
  if (started > now || now - started > MAX_JOB_SECONDS * 1000) {
    throw new Error('job started timestamp must be within the past 24 hours');
  }
  return started;
}

export function initializeDeadline(jobSeconds, reserveSeconds, now, existingDeadline, startedValue) {
  if (existingDeadline !== undefined) throw new Error('subject deadline is already set; refusing reset');
  validateClock(now);
  const job = positiveInteger(jobSeconds, 'job seconds');
  const reserve = positiveInteger(reserveSeconds, 'reserve seconds');
  if (job > MAX_JOB_SECONDS || reserve >= job) throw new Error('invalid job/reserve budget');
  const deadline = jobStart(startedValue, now) + (job - reserve) * 1000;
  if (!Number.isSafeInteger(deadline)) throw new Error('subject deadline overflow');
  if (deadline - now < 1000) {
    throw Object.assign(new Error('subject budget exhausted'), { exitCode: 124 });
  }
  return deadline;
}

export function lockWaitSeconds(configuredSeconds, deadlineValue, now) {
  const configured = positiveInteger(configuredSeconds, 'configured seconds');
  if (deadlineValue === undefined) return configured;
  validateClock(now);
  const deadline = positiveInteger(deadlineValue, 'subject deadline');
  const remaining = deadline - now;
  if (remaining > MAX_JOB_SECONDS * 1000) throw new Error('subject deadline exceeds 24 hours');
  if (remaining < 1000) {
    throw Object.assign(new Error('subject budget exhausted'), { exitCode: 124 });
  }
  return Math.min(configured, Math.floor(remaining / 1000));
}

export function stepDeadline(stepSeconds, reserveSeconds, now, inheritedDeadline) {
  const candidate = initializeDeadline(stepSeconds, reserveSeconds, now);
  if (inheritedDeadline === undefined) return candidate;
  lockWaitSeconds('1', inheritedDeadline, now);
  return Math.min(candidate, Number(inheritedDeadline));
}

export function runSubjectBudget(args, {
  environment = process.env, now = Date.now(), envFile = ciEnvFile(),
  append = appendFileSync, output = (value) => process.stdout.write(value),
} = {}) {
  const existing = environment[DEADLINE_VARIABLE];
  if (args[0] === 'initialize' && args.length === 3) {
    const deadline = initializeDeadline(args[1], args[2], now, existing, environment[JOB_STARTED_VARIABLE]);
    if (typeof envFile !== 'string' || envFile.length === 0) throw new Error('CI environment file is required');
    append(envFile, `${DEADLINE_VARIABLE}=${deadline}\n`, { encoding: 'utf8' });
    return;
  }
  if (args[0] === 'lock-wait' && args.length === 2) {
    output(`${lockWaitSeconds(args[1], existing, now)}\n`);
    return;
  }
  if (args[0] === 'step-deadline' && args.length === 3) {
    output(`${stepDeadline(args[1], args[2], now, existing)}\n`);
    return;
  }
  throw new Error('usage: subject-budget.mjs initialize JOB_SECONDS RESERVE_SECONDS | lock-wait CONFIGURED_SECONDS | step-deadline STEP_SECONDS RESERVE_SECONDS');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runSubjectBudget(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`subject-budget: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
