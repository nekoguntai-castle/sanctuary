#!/usr/bin/env node
// Internal usage: report-commit-workflows.mjs SHA MANIFEST.json STAGING_DIR
// Manifest: {event, workflows:[{workflow_id, required_jobs:[name]}]}.
// Read-only observation, not permission to merge or retry. Two identical
// snapshots detect movement; no API without a snapshot token is atomic.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson, canonicalJson } from '../ownership/canonical-json.mjs';

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const STATUSES = new Set(['success', 'failure', 'cancelled', 'skipped', 'blocked', 'waiting', 'running', 'queued']);
const PENDING = new Set(['blocked', 'waiting', 'running', 'queued']);
const TERMINAL_FAILURE = new Set(['failure', 'cancelled', 'skipped']);
const OBSERVATION_BUDGET_MS = 300_000;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const safeName = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !/[\x00-\x1f\x7f]/.test(value);
function requireValue(condition, reason) { if (!condition) throw new Error(reason); }

function validateRequiredJobs(requiredJobs) {
  requireValue(Array.isArray(requiredJobs) && requiredJobs.length > 0
    && requiredJobs.length <= 100
    && requiredJobs.every(safeName)
    && new Set(requiredJobs).size === requiredJobs.length, 'invalid_required_jobs');
}

function validateWorkflow(workflow, ids) {
  requireValue(workflow && Object.keys(workflow).length === 2
    && Object.hasOwn(workflow, 'workflow_id') && Object.hasOwn(workflow, 'required_jobs'), 'invalid_workflow_fields');
  requireValue(safeName(workflow.workflow_id) && !ids.has(workflow.workflow_id), 'invalid_workflow_id');
  ids.add(workflow.workflow_id);
  validateRequiredJobs(workflow.required_jobs);
}

export function validateManifest(sha, manifest) {
  requireValue(typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha), 'invalid_sha');
  requireValue(manifest && Object.keys(manifest).length === 2
    && Object.hasOwn(manifest, 'event') && Object.hasOwn(manifest, 'workflows'), 'invalid_manifest_fields');
  requireValue(typeof manifest.event === 'string' && manifest.event.length <= 40
    && /^[a-z_]+$/.test(manifest.event), 'invalid_event');
  requireValue(Array.isArray(manifest.workflows) && manifest.workflows.length > 0
    && manifest.workflows.length <= 30, 'invalid_workflows');
  const ids = new Set();
  for (const workflow of manifest.workflows) {
    validateWorkflow(workflow, ids);
  }
}

function validateRun(row, sha, event) {
  requireValue(row && positiveId(row.id) && safeName(row.workflow_id), 'invalid_run');
  requireValue(row.commit_sha === sha && row.event === event, 'run_identity_mismatch');
  requireValue(STATUSES.has(row.status), 'invalid_run_status');
  return { id: row.id, workflow_id: row.workflow_id, commit_sha: row.commit_sha,
    event, status: row.status };
}

async function runsSnapshot(get, sha, event) {
  let total;
  const rows = [];
  const ids = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await get(`actions/runs?head_sha=${sha}&event=${event}&page=${page}&limit=${PAGE_SIZE}`);
    requireValue(response && Number.isSafeInteger(response.total_count) && response.total_count >= 0
      && Array.isArray(response.workflow_runs), 'invalid_runs_response');
    total ??= response.total_count;
    requireValue(total === response.total_count && total <= MAX_PAGES * PAGE_SIZE, 'unstable_run_count');
    const expected = Math.min(PAGE_SIZE, Math.max(0, total - rows.length));
    requireValue(response.workflow_runs.length === expected, 'incomplete_runs_page');
    for (const raw of response.workflow_runs) {
      const row = validateRun(raw, sha, event);
      requireValue(!ids.has(row.id), 'duplicate_run_id');
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows.sort((a, b) => a.id - b.id);
  }
  throw new Error('run_page_limit');
}

async function jobsSnapshot(get, run) {
  // Forgejo's run/jobs endpoint returns the complete unpaginated job array.
  const rows = await get(`actions/runs/${run.id}/jobs`);
  requireValue(Array.isArray(rows) && rows.length <= 1000, 'invalid_jobs_response');
  const ids = new Set();
  const jobs = rows.map((row) => {
    requireValue(row && positiveId(row.id) && !ids.has(row.id) && safeName(row.name)
      && STATUSES.has(row.status) && positiveId(row.attempt), 'invalid_job');
    requireValue(row.run_id === undefined || row.run_id === run.id, 'job_identity_mismatch');
    ids.add(row.id);
    return { id: row.id, name: row.name, status: row.status, attempt: row.attempt };
  }).sort((a, b) => a.id - b.id);
  const attempts = new Set(jobs.map((job) => job.attempt));
  requireValue(attempts.size <= 1, 'mixed_job_attempts');
  return { attempt: jobs[0]?.attempt ?? null, jobs };
}

async function runDetailSnapshot(get, run, sha, event) {
  const detail = validateRun(await get(`actions/runs/${run.id}`), sha, event);
  requireValue(canonicalJson(detail).equals(canonicalJson(run)), 'run_detail_mismatch');
  return detail;
}

function workflowOutcome(workflow, run, snapshot) {
  if (!run) return { workflow_id: workflow.workflow_id, state: 'unknown', reason: 'missing_run' };
  const { attempt, jobs } = snapshot;
  const required = workflow.required_jobs.map((name) => jobs.filter((job) => job.name === name));
  if (required.some((matches) => matches.length !== 1)) {
    return { workflow_id: workflow.workflow_id, run_id: run.id, state: 'unknown', reason: 'missing_or_duplicate_aggregate' };
  }
  const statuses = [run.status, ...required.map(([job]) => job.status)];
  let state;
  if (statuses.every((status) => status === 'success')) state = 'success';
  else if (statuses.some((status) => TERMINAL_FAILURE.has(status))) state = 'failure';
  else if (statuses.some((status) => PENDING.has(status))) state = 'running';
  else state = 'unknown';
  return { workflow_id: workflow.workflow_id, run_id: run.id, attempt, state };
}

export async function reportCommitWorkflows(sha, manifest, get) {
  try {
    validateManifest(sha, manifest);
    const runs = await runsSnapshot(get, sha, manifest.event);
    const selected = manifest.workflows.map((workflow) => runs.filter((run) => run.workflow_id === workflow.workflow_id).at(-1));
    const details = await Promise.all(selected.map((run) => (
      run ? runDetailSnapshot(get, run, sha, manifest.event) : null
    )));
    const snapshots = await Promise.all(selected.map((run) => (
      run ? jobsSnapshot(get, run) : { attempt: null, jobs: [] }
    )));
    const repeated = await runsSnapshot(get, sha, manifest.event);
    requireValue(canonicalJson(runs).equals(canonicalJson(repeated)), 'runs_changed_during_observation');
    for (const [index, run] of selected.entries()) {
      if (!run) continue;
      requireValue(canonicalJson(details[index]).equals(canonicalJson(
        await runDetailSnapshot(get, run, sha, manifest.event),
      )), 'run_details_changed_during_observation');
      requireValue(canonicalJson(snapshots[index]).equals(canonicalJson(await jobsSnapshot(get, run))), 'jobs_changed_during_observation');
    }
    const workflows = manifest.workflows.map((workflow, index) => workflowOutcome(workflow, selected[index], snapshots[index]));
    const state = ['unknown', 'failure', 'running'].find((candidate) => workflows.some((workflow) => workflow.state === candidate)) ?? 'success';
    return { sha, event: manifest.event, state, progress: 'not_measured', workflows };
  } catch (error) {
    // Never surface transport bodies, URLs, tokens or uncontrolled exceptions.
    const message = error instanceof Error ? error.message : '';
    const reason = /^[a-z_]+$/.test(message) ? message : 'unavailable_or_malformed';
    return { state: 'unknown', reason, progress: 'not_measured', workflows: [] };
  }
}

export function observationTimeoutMs(started, now = Date.now()) {
  const remaining = OBSERVATION_BUDGET_MS - (now - started);
  requireValue(Number.isSafeInteger(remaining) && remaining > 0, 'observation_budget_exhausted');
  return Math.min(65_000, remaining);
}

function apiGetter(directory) {
  const helper = fileURLToPath(new URL('./forgejo-report-api.sh', import.meta.url));
  let sequence = 0;
  const started = Date.now();
  return async (relative) => {
    const timeout = observationTimeoutMs(started);
    const output = path.join(directory, `${sequence++}.json`);
    const result = spawnSync('bash', ['-c',
      'set +x; source "$1"; forgejo_report_resolve_context && forgejo_report_get "$2" "$3" 2097152',
      'report-commit-workflows', helper, relative, output,
    ], { stdio: 'pipe', encoding: 'utf8', timeout, maxBuffer: 64 * 1024 });
    requireValue(result.status === 0, 'api_unavailable');
    return parseStrictJson(readFileSync(output));
  };
}

function validateStaging(candidate) {
  requireValue(process.env.SANCTUARY_CLEANUP_COORDINATED === '1', 'uncoordinated_staging');
  const runtime = process.env.SANCTUARY_RUNTIME_DIR;
  requireValue(typeof runtime === 'string' && path.isAbsolute(runtime), 'invalid_runtime');
  const runtimeReal = realpathSync(runtime);
  requireValue(runtimeReal === runtime, 'noncanonical_runtime');
  const staging = realpathSync(candidate);
  const metadata = lstatSync(candidate);
  requireValue(staging === candidate && metadata.isDirectory() && !metadata.isSymbolicLink(), 'invalid_staging');
  requireValue((metadata.mode & 0o777) === 0o700, 'insecure_staging_mode');
  if (typeof process.getuid === 'function') requireValue(metadata.uid === process.getuid(), 'foreign_staging_owner');
  requireValue(path.dirname(staging) === path.join(runtimeReal, 'subject-staging')
    && /^report-commit-workflows\.[A-Za-z0-9]+$/.test(path.basename(staging)), 'unregistered_staging');
  return staging;
}

export async function main(argv) {
  let report;
  try {
    requireValue(argv.length === 3, 'usage_sha_manifest_staging');
    const manifest = parseStrictJson(readFileSync(argv[1]));
    validateManifest(argv[0], manifest);
    const directory = validateStaging(argv[2]);
    report = await reportCommitWorkflows(argv[0], manifest, apiGetter(directory));
  } catch { report = { state: 'unknown', reason: 'invalid_input_or_unavailable', workflows: [] }; }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.state === 'success' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
