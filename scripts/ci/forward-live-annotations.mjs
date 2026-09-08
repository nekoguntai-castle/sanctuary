#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { canonicalJson, parseStrictJson } from '../ownership/canonical-json.mjs';

const LIFECYCLE_PREFIX = 'SANCTUARY_CI_LIFECYCLE_V1 ';
const LIFECYCLE_TITLE = '::notice title=CI lifecycle::';
const MAX_CANDIDATE_BYTES = 512;
const EVENTS = new Set([
  'cleanup_prepared', 'subject_started', 'subject_terminal',
  'cleanup_started', 'cleanup_terminal',
]);
const STATUSES = new Set([
  'running', 'succeeded', 'failed', 'interrupted', 'timed_out', 'refused',
]);
const CLEANUP_STATES = new Set([
  'dry_run', 'no_op', 'cleaned', 'partial', 'cancelled', 'refused', 'ambiguous',
  'recovered', 'coordinator_failed',
]);
const EXACT_FIELDS = Object.freeze([
  'schema_version', 'event', 'status', 'subject_exit', 'cleanup_state',
]);
const SORTED_EXACT_FIELDS = Object.freeze([...EXACT_FIELDS].sort());
const CLEANUP_STATUS_BY_STATE = Object.freeze({
  dry_run: 'failed', no_op: 'succeeded', cleaned: 'succeeded', partial: 'failed',
  cancelled: 'interrupted', refused: 'refused', ambiguous: 'refused',
  recovered: 'succeeded', coordinator_failed: 'failed',
});

const TIMING_RE = /^::(notice|error) title=CI timing::.+ completed in [0-9]+m [0-9]+s \([0-9]+s\)( with exit code [0-9]+)?$/;
const WARNING_BUDGET_RE = /^::warning title=CI performance budget::.+ took [0-9]+s; warning budget is [0-9]+s$/;
const HARD_BUDGET_RE = /^::error title=CI performance budget::.+ took [0-9]+s; hard budget is [0-9]+s$/;

function exactFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === EXACT_FIELDS.length
    && keys.every((key, index) => key === SORTED_EXACT_FIELDS[index]);
}

function validExit(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 255);
}

function validSubjectTerminal(status, subjectExit) {
  const validators = {
    succeeded: () => subjectExit === 0,
    timed_out: () => subjectExit === 124,
    interrupted: () => subjectExit >= 129 && subjectExit <= 192,
    failed: () => subjectExit > 0 && subjectExit !== 124,
  };
  return validators[status]?.() === true;
}

const EVENT_VALIDATORS = Object.freeze({
  cleanup_prepared: ({ status, subject_exit: exit, cleanup_state: cleanup }) => (
    status === 'succeeded' && exit === null && cleanup === null
  ),
  subject_started: ({ status, subject_exit: exit, cleanup_state: cleanup }) => (
    status === 'running' && exit === null && cleanup === null
  ),
  subject_terminal: ({ status, subject_exit: exit, cleanup_state: cleanup }) => (
    validSubjectTerminal(status, exit) && cleanup === null
  ),
  cleanup_started: ({ status, subject_exit: exit, cleanup_state: cleanup }) => (
    status === 'running' && exit !== null && cleanup === null
  ),
  cleanup_terminal: ({ status, subject_exit: exit, cleanup_state: cleanup }) => (
    status === cleanupLifecycleStatus(cleanup) && exit !== null
  ),
});

export function cleanupLifecycleStatus(cleanupState) {
  return CLEANUP_STATUS_BY_STATE[cleanupState] ?? null;
}

function validLifecycleCombination(value) {
  return EVENT_VALIDATORS[value.event]?.(value) === true;
}

export function lifecycleAnnotation(line) {
  if (!line.startsWith(LIFECYCLE_PREFIX)) return null;
  if (Buffer.byteLength(line, 'utf8') > MAX_CANDIDATE_BYTES
      || !/^[\x20-\x7e]+$/.test(line)
      || /%|<|>/.test(line)) return null;
  let value;
  try {
    value = parseStrictJson(Buffer.from(line.slice(LIFECYCLE_PREFIX.length), 'utf8'));
  } catch {
    return null;
  }
  if (!exactFields(value)
      || value.schema_version !== 1
      || !EVENTS.has(value.event)
      || !STATUSES.has(value.status)
      || !validExit(value.subject_exit)
      || !(value.cleanup_state === null || CLEANUP_STATES.has(value.cleanup_state))
      || !validLifecycleCombination(value)) return null;
  return `${LIFECYCLE_TITLE}${canonicalJson(value).toString('utf8')}`;
}

export function liveAnnotation(line) {
  if (TIMING_RE.test(line) || WARNING_BUDGET_RE.test(line) || HARD_BUDGET_RE.test(line)) {
    return line;
  }
  return lifecycleAnnotation(line);
}

export async function forwardLiveAnnotations(input, output, liveOutput) {
  // Live annotations are observability only. A runner may close its log sink;
  // consume that stream error while leaving stdout's diagnostic path strict.
  let liveWritable = true;
  liveOutput.on('drain', () => { liveWritable = true; });
  liveOutput.on('error', () => { liveWritable = false; });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!output.write(`${line}\n`)) await once(output, 'drain');
    const annotation = liveAnnotation(line);
    if (annotation !== null && liveWritable && !liveOutput.destroyed) {
      try {
        liveWritable = liveOutput.write(`${annotation}\n`, () => {});
      } catch {
        liveWritable = false;
        // Best-effort live delivery must not affect the diagnostic pipeline.
      }
    }
  }
}

export function lifecycleCandidate(value) {
  return `${LIFECYCLE_PREFIX}${canonicalJson(value).toString('utf8')}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  forwardLiveAnnotations(process.stdin, process.stdout, process.stderr).catch(() => {
    process.exitCode = 1;
  });
}
