#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--repo', '--output', '--revision', '--end'].includes(flag) || !value) {
      throw new Error('usage: audit.mjs --repo REPOSITORY --output EXTERNAL_DIRECTORY --revision COMMIT [--end ISO_TIMESTAMP]');
    }
    values[flag.slice(2)] = value;
  }
  if (!values.repo || !values.output || !values.revision) {
    throw new Error('usage: audit.mjs --repo REPOSITORY --output EXTERNAL_DIRECTORY --revision COMMIT [--end ISO_TIMESTAMP]');
  }
  const repo = path.resolve(values.repo);
  const output = path.resolve(values.output);
  if (output === repo || output.startsWith(`${repo}${path.sep}`)) {
    throw new Error('--output must be outside the repository so raw captures cannot enter the tracked evidence tree');
  }
  const end = values.end ? new Date(values.end) : new Date();
  if (!Number.isFinite(end.getTime())) throw new Error('--end must be a valid ISO timestamp');
  const revision = execFileSync('git', ['rev-parse', '--verify', `${values.revision}^{commit}`], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('--revision must resolve to one full commit SHA');
  return { repo, output, revision, end };
}

const OPTIONS = parseArgs(process.argv.slice(2));
const REPO = OPTIONS.repo;
const OUTPUT = OPTIONS.output;
const REVISION = OPTIONS.revision;
const END = OPTIONS.end;
const START = new Date(END.getTime() - 60 * 24 * 60 * 60 * 1000);
const WORKFLOWS = ['test.yml', 'install-test.yml', 'release-candidate.yml', 'verify-vectors.yml'];
const LIMIT = 50;

function ensure(directory) { mkdirSync(directory, { recursive: true }); }
function writeJson(file, value) { ensure(path.dirname(file)); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function gitShow(spec) { return execFileSync('git', ['show', spec], { cwd: REPO, encoding: 'utf8' }); }

function forgejoCoordinates() {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO, encoding: 'utf8' }).trim();
  const url = new URL(remote);
  const repository = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
  if (!/^https?:$/.test(url.protocol) || repository.split('/').length !== 2) {
    throw new Error('origin must be an HTTP(S) Forgejo owner/repository URL');
  }
  return { api: `${url.origin}/api/v1/repos/${repository}`, protocol: url.protocol.slice(0, -1), host: url.host };
}

const FORGEJO = forgejoCoordinates();

function credential() {
  const filled = execFileSync('git', ['credential', 'fill'], {
    input: `protocol=${FORGEJO.protocol}\nhost=${FORGEJO.host}\n\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
  });
  const password = filled.split('\n').find(line => line.startsWith('password='))?.slice(9);
  if (!password) throw new Error('git credential fill returned no password');
  return password;
}

const TOKEN = credential();
async function request(relative, rawFile, allow404 = false) {
  const response = await fetch(`${FORGEJO.api}/${relative}`, {
    headers: { Authorization: `token ${TOKEN}`, Accept: 'application/json' },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (rawFile) { ensure(path.dirname(rawFile)); writeFileSync(rawFile, bytes); }
  return bytes;
}

async function jsonRequest(relative, rawFile, allow404 = false) {
  const bytes = await request(relative, rawFile, allow404);
  return bytes === null ? null : JSON.parse(bytes.toString('utf8'));
}

async function mapLimit(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function runTime(run) { return new Date(run.created ?? run.started ?? 0); }
function effectiveEvent(run) { return run.trigger_event || run.event || 'unknown'; }
function secondsBetween(a, b) {
  if (!a || !b) return null;
  const seconds = (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
function wallSeconds(run) {
  if ((run.duration ?? 0) > 0) return run.duration / 1e9;
  return secondsBetween(run.started ?? run.created, run.stopped ?? run.updated);
}
function queueSeconds(run) { return secondsBetween(run.created, run.started); }
function prNumber(run) {
  const match = String(run.prettyref ?? '').match(/^#(\d+)$/);
  if (match) return Number(match[1]);
  try { return JSON.parse(run.event_payload ?? '{}')?.number ?? null; } catch { return null; }
}

async function fetchRuns(workflow) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const rawFile = path.join(OUTPUT, 'raw', 'runs', workflow, `page-${String(page).padStart(3, '0')}.json`);
    const payload = await jsonRequest(`actions/runs?page=${page}&limit=${LIMIT}&workflow_id=${encodeURIComponent(workflow)}`, rawFile);
    const runs = payload.workflow_runs ?? [];
    all.push(...runs);
    if (runs.length < LIMIT || runs.some(run => runTime(run) < START)) break;
  }
  return all.filter(run => run.workflow_id === workflow && runTime(run) >= START && runTime(run) <= END);
}

async function fetchPrFiles(number) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const rawFile = path.join(OUTPUT, 'raw', 'pr-files', String(number), `page-${String(page).padStart(3, '0')}.json`);
    const payload = await jsonRequest(`pulls/${number}/files?page=${page}&limit=100`, rawFile);
    files.push(...payload.map(item => item.filename));
    if (payload.length < 100) break;
  }
  return [...new Set(files)].sort();
}

function globRegex(pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') { regex += '.*'; i += 1; }
    else if (char === '*') regex += '[^/]*';
    else if (char === '?') regex += '[^/]';
    else regex += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${regex}$`);
}

const walletPatterns = JSON.parse(gitShow(`${REVISION}:config/wallet-safety-critical-paths.json`)).paths.map(globRegex);
function matchesWallet(file) { return walletPatterns.some(pattern => pattern.test(file)); }
function isDocs(file) {
  return file.startsWith('docs/') || file.startsWith('tasks/') || /(^|\/)README(?:\.[^.]+)?$/i.test(file) || /\.(md|mdx|txt)$/i.test(file);
}
function isIntegrationSensitive(file) {
  return /^(server\/(src\/(api|middleware|repositories|workers?|queues?|services\/(worker|notification|recurring|deadLetter)|prisma)|prisma|tests\/integration)|docker-compose\.yml|package-lock\.json|server\/package(?:-lock)?\.json)/.test(file);
}
function isBackend(file) { return file.startsWith('server/'); }
function isFrontend(file) { return /^(src|tests|shared|public)\//.test(file) || /^(package(?:-lock)?\.json|config\/tooling\/(vite|vitest|playwright))/.test(file); }

function classifyFiles(files) {
  const classes = [];
  if (files.length > 0 && files.every(isDocs)) classes.push('docs-only');
  const otherProductPath = file => /^(src|tests|shared|server\/(src|tests)|llm-egress-proxy\/(src|tests))\//.test(file);
  if (files.some(file => /^(gateway\/(src|tests))\//.test(file)) && !files.some(otherProductPath)) classes.push('gateway-only');
  if (files.some(matchesWallet)) classes.push('wallet-safety');
  if (files.some(isIntegrationSensitive)) classes.push('backend-integration-sensitive');
  if (files.some(isBackend) && !files.some(isIntegrationSensitive) && !files.some(matchesWallet)) classes.push('backend-unit-only');
  if (files.some(isFrontend) && !files.some(isBackend) && !files.some(file => file.startsWith('gateway/')) && !files.some(matchesWallet)) classes.push('frontend');
  return classes;
}

function statusCounts(runs) {
  const counts = { total: runs.length, success: 0, failure: 0, cancelled: 0, other: 0 };
  for (const run of runs) {
    if (run.status === 'success') counts.success += 1;
    else if (run.status === 'failure') counts.failure += 1;
    else if (run.status === 'cancelled') counts.cancelled += 1;
    else counts.other += 1;
  }
  return counts;
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function metric(values) { return { available: values.filter(Number.isFinite).length, p50: percentile(values, 0.5), p90: percentile(values, 0.9) }; }

async function fetchJobs(run) {
  const rawFile = path.join(OUTPUT, 'raw', 'jobs', `${run.id}.json`);
  return jsonRequest(`actions/runs/${run.id}/jobs?page=1&limit=100`, rawFile);
}

function logTimestamps(text) {
  const values = [...text.matchAll(/^(\d{4}-\d\d-\d\dT[^ ]+) /gm)].map(match => Date.parse(match[1])).filter(Number.isFinite);
  return values.length ? { first: Math.min(...values), last: Math.max(...values), seconds: (Math.max(...values) - Math.min(...values)) / 1000 } : null;
}

function noticeSeconds(text, kind) {
  const lines = text.split('\n').filter(line => kind.test(line));
  const values = [];
  for (const line of lines) {
    const canonical = line.match(/\(([0-9]+(?:\.[0-9]+)?)s\)(?:\s|$)/);
    if (canonical) { values.push(Number(canonical[1])); continue; }
    const matches = [...line.matchAll(/(?:duration|elapsed|wait|held|seconds?)\D{0,12}([0-9]+(?:\.[0-9]+)?)/ig)];
    for (const match of matches) values.push(Number(match[1]));
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function artifactSeconds(text) {
  const lines = text.split('\n');
  let start = null;
  let total = 0;
  for (const line of lines) {
    const timestamp = Date.parse(line.slice(0, line.indexOf(' ')));
    if (!Number.isFinite(timestamp)) continue;
    if (/Beginning (upload|download) of artifact|Starting artifact download/i.test(line)) start = timestamp;
    if (start !== null && /(successfully (uploaded|downloaded)|Finished (uploading|downloading)|Artifact download completed)/i.test(line)) {
      total += Math.max(0, (timestamp - start) / 1000);
      start = null;
    }
  }
  return total > 0 ? total : null;
}

function classifyFailure(text) {
  if (/\b(?:HTTP\s*)?429\b|rate limit exceeded|too many requests|\b503\b.{0,30}Service Unavailable|manifest unknown|registry.{0,80}(timeout|unavailable)/i.test(text)) return 'registry-rate-limit';
  if (/runner.*(terminated|lost|shutdown)|signal: killed|no space left|podman.*(archive|socket|storage)|docker daemon.*unavailable|context canceled/i.test(text)) return 'proven-runner-or-substrate';
  if (/::error::Error unauthorized|HTTP\s+401|authentication required/i.test(text)) return 'unknown-provider-auth';
  if (/npm audit|lockfile|checksum mismatch|dependency.*(drift|resolution)|ERR_PNPM|ERESOLVE/i.test(text)) return 'dependency-drift';
  if (/queue|waiting for runner|acquir(e|ing).*lock|lock wait/i.test(text) && !/(AssertionError|expected|FAIL|failed test)/i.test(text)) return 'queueing-or-lock';
  if (/AssertionError|expected .* to|Tests?\s+\d+ failed|FAIL\s|mutation score|survived/i.test(text)) return 'deterministic-test-or-product-defect';
  return 'unknown';
}

async function fetchLog(job) {
  const rawFile = path.join(OUTPUT, 'raw', 'logs', `${job.id}.log`);
  const bytes = await request(`actions/jobs/${job.id}/logs`, rawFile, true);
  return bytes === null ? '' : bytes.toString('utf8');
}

function commit(run) { return run.commit_sha ?? run.head_sha ?? null; }
function selectedSuccesses(runs) { return runs.filter(run => run.status === 'success').sort((a, b) => runTime(b) - runTime(a)).slice(0, 20); }

const runsByWorkflow = {};
for (const workflow of WORKFLOWS) {
  console.error(`fetch runs: ${workflow}`);
  runsByWorkflow[workflow] = await fetchRuns(workflow);
}

const testRuns = runsByWorkflow['test.yml'];
const prNumbers = [...new Set(testRuns.filter(run => effectiveEvent(run) === 'pull_request').map(prNumber).filter(Boolean))].sort((a, b) => a - b);
console.error(`fetch PR file lists: ${prNumbers.length}`);
const prFileEntries = await mapLimit(prNumbers, 12, async number => [number, await fetchPrFiles(number)]);
const prFiles = new Map(prFileEntries);

const cohortRuns = Object.fromEntries(['docs-only', 'gateway-only', 'frontend', 'backend-unit-only', 'backend-integration-sensitive', 'wallet-safety'].map(name => [name, []]));
for (const run of testRuns.filter(run => effectiveEvent(run) === 'pull_request')) {
  for (const cohort of classifyFiles(prFiles.get(prNumber(run)) ?? [])) cohortRuns[cohort].push(run);
}
cohortRuns['main-push'] = testRuns.filter(run => effectiveEvent(run) === 'push' && run.prettyref === 'main');
cohortRuns.install = runsByWorkflow['install-test.yml'];
cohortRuns.rc = runsByWorkflow['release-candidate.yml'];

const sampleRuns = [...new Map(Object.values(cohortRuns).flatMap(selectedSuccesses).map(run => [run.id, run])).values()];
const failureOrCancelled = Object.values(runsByWorkflow).flat().filter(run => run.status === 'failure' || run.status === 'cancelled');
const detailedRuns = [...new Map([...sampleRuns, ...failureOrCancelled].map(run => [run.id, run])).values()];
console.error(`fetch job inventories: ${detailedRuns.length}`);
const jobEntries = await mapLimit(detailedRuns, 16, async run => [run.id, await fetchJobs(run)]);
const jobsByRun = new Map(jobEntries);

const jobsToLog = [];
for (const run of detailedRuns) {
  const jobs = jobsByRun.get(run.id) ?? [];
  const isSample = sampleRuns.some(sample => sample.id === run.id);
  for (const job of jobs) {
    if (isSample || job.status === 'failure' || (run.status === 'cancelled' && job.status !== 'skipped')) jobsToLog.push(job);
  }
}
const uniqueJobs = [...new Map(jobsToLog.map(job => [job.id, job])).values()];
console.error(`fetch selected/failure logs: ${uniqueJobs.length}`);
const logEntries = await mapLimit(uniqueJobs, 20, async job => [job.id, await fetchLog(job)]);
const logs = new Map(logEntries);

function detailedMetrics(run) {
  const jobs = jobsByRun.get(run.id) ?? [];
  const texts = jobs.map(job => logs.get(job.id) ?? '').filter(Boolean);
  const timings = texts.map(logTimestamps).filter(Boolean);
  const sumAvailable = values => {
    const available = values.filter(Number.isFinite);
    return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    runner_seconds: timings.length ? timings.reduce((sum, timing) => sum + timing.seconds, 0) : null,
    lock_seconds_observed: sumAvailable(texts.map(text => noticeSeconds(text, /lock wait|acquir.*lock|lock held/i))),
    setup_seconds_observed: sumAvailable(texts.map(text => noticeSeconds(text, /CI timing.*(npm ci|install|setup|build|migration|playwright browser)/i))),
    artifact_seconds_observed: sumAvailable(texts.map(artifactSeconds)),
  };
}

const runDetails = new Map(detailedRuns.map(run => [run.id, detailedMetrics(run)]));
function cohortSummary(name, runs) {
  const sample = selectedSuccesses(runs);
  const details = sample.map(run => runDetails.get(run.id) ?? {});
  return {
    name,
    counts: statusCounts(runs),
    comparable_success_sample_count: sample.length,
    sample_shortfall: Math.max(0, 20 - sample.length),
    metrics: {
      wall_seconds: metric(sample.map(wallSeconds)),
      workflow_queue_seconds: metric(sample.map(queueSeconds)),
      runner_sum_seconds: metric(details.map(item => item.runner_seconds)),
      lock_seconds_observed: metric(details.map(item => item.lock_seconds_observed)),
      setup_seconds_observed: metric(details.map(item => item.setup_seconds_observed)),
      artifact_seconds_observed: metric(details.map(item => item.artifact_seconds_observed)),
    },
    sample_runs: sample.map(run => ({ id: run.id, status: run.status, event: effectiveEvent(run), ref: run.prettyref, commit: commit(run), wall_seconds: wallSeconds(run), workflow_queue_seconds: queueSeconds(run), ...runDetails.get(run.id) })),
  };
}

function failedJobRecords(workflow, predicate = () => true) {
  const output = [];
  for (const run of runsByWorkflow[workflow].filter(run => run.status === 'failure')) {
    for (const job of (jobsByRun.get(run.id) ?? []).filter(job => job.status === 'failure' && predicate(job))) {
      const text = logs.get(job.id) ?? '';
      output.push({ run_id: run.id, job_id: job.id, job_name: job.name, commit: commit(run), ref: run.prettyref, category: classifyFailure(text), log_path: `raw/logs/${job.id}.log` });
    }
  }
  return output;
}

const mutationFailures = failedJobRecords('test.yml', job => /mutation.*shard/i.test(job.name));
const installFailures = failedJobRecords('install-test.yml', job => !/Install Test Summary|^Upgrade Extended$/i.test(job.name));

function uniqueYield() {
  const result = { quick_only_failures: [], full_only_failures: [], mutation_unique_failures: [], vector_unique_vs_test: [], install_unique_vs_test: [] };
  for (const run of testRuns.filter(run => run.status === 'failure')) {
    const jobs = jobsByRun.get(run.id) ?? [];
    const failed = jobs.filter(job => job.status === 'failure').map(job => job.name);
    const quick = failed.some(name => /^Quick /.test(name));
    const full = failed.some(name => /^Full /.test(name));
    if (quick && !full) result.quick_only_failures.push(run.id);
    if (full && !quick) result.full_only_failures.push(run.id);
    if (failed.some(name => /mutation/i.test(name)) && !failed.some(name => !/mutation|summary|required/i.test(name))) result.mutation_unique_failures.push(run.id);
  }
  const successfulTestCommits = new Set(testRuns.filter(run => run.status === 'success').map(commit).filter(Boolean));
  result.vector_unique_vs_test = runsByWorkflow['verify-vectors.yml'].filter(run => run.status === 'failure' && successfulTestCommits.has(commit(run))).map(run => run.id);
  result.install_unique_vs_test = runsByWorkflow['install-test.yml'].filter(run => run.status === 'failure' && successfulTestCommits.has(commit(run))).map(run => run.id);
  return result;
}

const cancellations = Object.fromEntries(WORKFLOWS.map(workflow => {
  const runs = runsByWorkflow[workflow].filter(run => run.status === 'cancelled');
  const observed = runs.map(run => runDetails.get(run.id)?.runner_seconds).filter(Number.isFinite);
  return [workflow, { count: runs.length, runner_waste_seconds_observed: observed.reduce((a, b) => a + b, 0), runs_with_log_timing: observed.length, unavailable_runs: runs.length - observed.length }];
}));

function firstFailureStages(workflow) {
  const records = [];
  for (const run of runsByWorkflow[workflow].filter(item => item.status === 'failure')) {
    const failed = (jobsByRun.get(run.id) ?? []).filter(job => job.status === 'failure').map(job => {
      const timing = logTimestamps(logs.get(job.id) ?? '');
      return { job, first: timing?.first ?? Number.MAX_SAFE_INTEGER };
    }).sort((a, b) => a.first - b.first);
    records.push({ run_id: run.id, job_id: failed[0]?.job.id ?? null, job_name: failed[0]?.job.name ?? 'unavailable' });
  }
  const counts = {};
  for (const record of records) counts[record.job_name] = (counts[record.job_name] ?? 0) + 1;
  return { counts, records };
}

const summary = {
  schema_version: 1,
  generated_at: END.toISOString(),
  exact_window: { start_inclusive: START.toISOString(), end_inclusive: END.toISOString(), days: 60 },
  repository_revision: REVISION,
  methodology: {
    api: 'Forgejo GET only; runs, PR files, job inventories, selected/failure job logs',
    cohort_overlap: true,
    sample: 'latest 20 successful path-comparable runs per cohort; topology is not normalized',
    runner_time: 'sum of first-to-last timestamps in persisted executed-job logs',
    queue_time: 'workflow started minus created; job-level queue timestamps unavailable',
    observed_subtimings: 'regex-derived lower bounds from timing/lock notices and artifact log markers; zero may mean unavailable',
  },
  workflow_counts: Object.fromEntries(WORKFLOWS.map(workflow => [workflow, statusCounts(runsByWorkflow[workflow])])),
  cohorts: Object.fromEntries(Object.entries(cohortRuns).map(([name, runs]) => [name, cohortSummary(name, runs)])),
  cancellation_waste: cancellations,
  first_failure_stage: Object.fromEntries(WORKFLOWS.map(workflow => [workflow, firstFailureStages(workflow)])),
  unique_yield: uniqueYield(),
  failure_attribution: { mutation: mutationFailures, install: installFailures },
  limitations: [
    'Forgejo run/job APIs expose no job timestamps; runner sums require logs and remain lower-bound estimates.',
    'Lock/setup notices were introduced during the window, so absence is not zero cost.',
    'Automated failure categories require representative-log review; unknown and deterministic-test-or-product-defect are intentionally not over-attributed.',
    'Cross-browser failure attribution is unavailable because CI selected Chromium only during the window.',
    'A successful run can belong to more than one path cohort; cohorts are reported independently, not summed.',
  ],
};

writeJson(path.join(OUTPUT, 'summary.json'), summary);
writeJson(path.join(OUTPUT, 'raw', 'pr-files-index.json'), Object.fromEntries(prFileEntries));
console.error('audit capture complete');
