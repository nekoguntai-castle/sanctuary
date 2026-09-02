// Provider-agnostic CI context for Node helpers. Mirrors provider-context.sh.
//
// import { ciProvider, ciEmitWarning, ... } from './provider-context.mjs';
//
// Same override points as the shell version (see provider-context.sh header).

import { appendFileSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const env = process.env;

export function ciProvider(environment = env) {
  if (environment.SANCTUARY_CI_PROVIDER_OVERRIDE) {
    return environment.SANCTUARY_CI_PROVIDER_OVERRIDE;
  }
  if (environment.FORGEJO_ACTIONS === 'true' || environment.FORGEJO_SERVER_URL) return 'forgejo';
  if (environment.GITHUB_ACTIONS === 'true') return 'github';
  if (environment.CI === 'true') return 'unknown-ci';
  return 'local';
}

export function ciAuthorityProvider(environment = env) {
  if (environment.FORGEJO_ACTIONS === 'true' || environment.FORGEJO_SERVER_URL) return 'forgejo';
  if (environment.GITHUB_ACTIONS === 'true') return 'github';
  if (environment.CI === 'true') return 'unknown-ci';
  return 'local';
}

export function ciAuthorityRunId(environment = env) {
  return environment.GITHUB_RUN_ID || '';
}

export function ciAuthorityRunAttempt(environment = env) {
  return environment.GITHUB_RUN_ATTEMPT || '';
}

export function ciAuthorityTempDir(environment = env) {
  return environment.RUNNER_TEMP || '';
}

export function ciEventName() {
  return env.SANCTUARY_CI_EVENT_NAME_OVERRIDE || env.EVENT_NAME || env.GITHUB_EVENT_NAME || '';
}

export function ciEventBaseSha() {
  if (env.SANCTUARY_CI_BASE_SHA_OVERRIDE) return env.SANCTUARY_CI_BASE_SHA_OVERRIDE;
  switch (ciEventName()) {
    case 'pull_request': return env.PR_BASE_SHA || '';
    case 'merge_group':  return env.MERGE_GROUP_BASE_SHA || '';
    case 'push':         return env.PUSH_BEFORE_SHA || '';
    default:             return '';
  }
}

export function ciEventHeadSha() {
  if (env.SANCTUARY_CI_HEAD_SHA_OVERRIDE) return env.SANCTUARY_CI_HEAD_SHA_OVERRIDE;
  const fallback = env.WORKFLOW_SHA || env.GITHUB_SHA || 'HEAD';
  switch (ciEventName()) {
    case 'pull_request': return env.PR_HEAD_SHA || fallback;
    case 'merge_group':  return env.MERGE_GROUP_HEAD_SHA || fallback;
    default:             return fallback;
  }
}

export function ciEventPrNumber() {
  return env.SANCTUARY_CI_PR_NUMBER_OVERRIDE || env.PR_NUMBER || '';
}

export function ciWorkspace() {
  if (env.SANCTUARY_CI_WORKSPACE_OVERRIDE) return env.SANCTUARY_CI_WORKSPACE_OVERRIDE;
  if (env.GITHUB_WORKSPACE) return env.GITHUB_WORKSPACE;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

export function ciRunId(environment = env) {
  if (environment.SANCTUARY_CI_RUN_ID_OVERRIDE) return environment.SANCTUARY_CI_RUN_ID_OVERRIDE;
  if (environment.GITHUB_RUN_ID) return environment.GITHUB_RUN_ID;
  if (environment.GITHUB_RUN_NUMBER) return environment.GITHUB_RUN_NUMBER;
  return `${process.pid}-${Math.floor(Date.now() / 1000)}`;
}

export function ciRunAttempt(environment = env) {
  if (environment.SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE) {
    return environment.SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE;
  }
  return environment.GITHUB_RUN_ATTEMPT || '1';
}

export function ciTempDir(environment = env) {
  if (environment.SANCTUARY_CI_TEMP_DIR_OVERRIDE) {
    return environment.SANCTUARY_CI_TEMP_DIR_OVERRIDE;
  }
  if (environment.RUNNER_TEMP) return environment.RUNNER_TEMP;
  return environment.TMPDIR || '/tmp';
}

export function ciOutputFile() {
  if (env.SANCTUARY_CI_OUTPUT_FILE) return env.SANCTUARY_CI_OUTPUT_FILE;
  if (env.GITHUB_OUTPUT) return env.GITHUB_OUTPUT;
  if (env.FORGEJO_OUTPUT) return env.FORGEJO_OUTPUT;
  return null;
}

export function ciEnvFile() {
  if (env.SANCTUARY_CI_ENV_FILE) return env.SANCTUARY_CI_ENV_FILE;
  if (env.GITHUB_ENV) return env.GITHUB_ENV;
  if (env.FORGEJO_ENV) return env.FORGEJO_ENV;
  return null;
}

export function ciStepSummaryFile() {
  if (env.SANCTUARY_CI_STEP_SUMMARY_FILE) return env.SANCTUARY_CI_STEP_SUMMARY_FILE;
  if (env.GITHUB_STEP_SUMMARY) return env.GITHUB_STEP_SUMMARY;
  if (env.FORGEJO_STEP_SUMMARY) return env.FORGEJO_STEP_SUMMARY;
  return null;
}

function appendOrWrite(target, line) {
  if (target) {
    appendFileSync(target, line.endsWith('\n') ? line : `${line}\n`);
    return;
  }
  // No file configured — the shell-side falls back to /dev/stdout (or /dev/stderr
  // for summary). We emulate stdout for outputs/env, stderr for summary.
  writeSync(1, line.endsWith('\n') ? line : `${line}\n`);
}

export function ciEmitOutput(...lines) {
  const target = ciOutputFile();
  for (const line of lines) appendOrWrite(target, line);
}

export function ciEmitEnv(...lines) {
  const target = ciEnvFile();
  for (const line of lines) appendOrWrite(target, line);
}

export function ciEmitSummary(...lines) {
  const target = ciStepSummaryFile();
  if (target) {
    for (const line of lines) appendFileSync(target, line.endsWith('\n') ? line : `${line}\n`);
    return;
  }
  for (const line of lines) writeSync(2, line.endsWith('\n') ? line : `${line}\n`);
}

function annotationSupported() {
  return ['github', 'forgejo', 'unknown-ci'].includes(ciProvider());
}

export function ciEmitWarning(msg) {
  if (annotationSupported()) {
    process.stdout.write(`::warning::${msg}\n`);
  } else {
    process.stderr.write(`warning: ${msg}\n`);
  }
}

export function ciEmitNotice(msg) {
  if (annotationSupported()) {
    process.stdout.write(`::notice::${msg}\n`);
  } else {
    process.stderr.write(`notice: ${msg}\n`);
  }
}

export function ciEmitError(msg) {
  if (annotationSupported()) {
    process.stdout.write(`::error::${msg}\n`);
  } else {
    process.stderr.write(`error: ${msg}\n`);
  }
}
