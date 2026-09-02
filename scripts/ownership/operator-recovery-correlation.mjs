import { canonicalSha256 } from './canonical-json.mjs';

const COMMIT = /^[a-f0-9]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,128}\/[A-Za-z0-9_.-]{1,128}$/;
const STATUSES = new Set([
  'unknown', 'waiting', 'running', 'success', 'failure', 'cancelled',
  'skipped', 'blocked', 'pending', 'requested', 'in_progress',
]);
const LIMIT_KEYS = Object.freeze([
  'maxRuns', 'maxJobsPerRun', 'maxTotalJobs', 'maxPages', 'maxDecodedBytes',
  'deadlineMs', 'pageSize',
]);
const DEFAULT_LIMITS = Object.freeze({
  maxRuns: 64,
  maxJobsPerRun: 128,
  maxTotalJobs: 2_048,
  maxPages: 128,
  maxDecodedBytes: 4 * 1024 * 1024,
  deadlineMs: 30_000,
  pageSize: 50,
});
const MAX_LIMITS = Object.freeze({
  maxRuns: 1_000,
  maxJobsPerRun: 1_000,
  maxTotalJobs: 10_000,
  maxPages: 1_000,
  maxDecodedBytes: 64 * 1024 * 1024,
  deadlineMs: 120_000,
  pageSize: 100,
});
const MAX_FRESHNESS_MS = 5 * 60_000;

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function boundedString(value, label, { max = 512, pattern } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
      || value.includes('\0') || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())
      || (!(value instanceof Date) && (typeof value !== 'string' || date.toISOString() !== value))) {
    throw new Error(`${label} is invalid`);
  }
  return date;
}

function decimal(value, label) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : value;
  if (!DECIMAL.test(normalized ?? '')) throw new Error(`${label} is invalid`);
  return normalized;
}

function status(value, label) {
  if (!STATUSES.has(value)) throw new Error(`${label} is invalid`);
  return value;
}

function providerInstance(value) {
  const parsed = new URL(boundedString(value, 'providerInstance', { max: 2_048 }));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.search || parsed.hash) throw new Error('providerInstance is invalid');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function workflow(value, label = 'workflowId') {
  return boundedString(value, label, { pattern: /^[^\s\0]+$/ });
}

function jobName(value, label = 'jobName') {
  return boundedString(value, label, { max: 512 });
}

function normalizeQuery(value) {
  exactFields(value, ['commit', 'workflowId', 'jobName'], 'provider correlation query');
  if (!COMMIT.test(value.commit ?? '')) throw new Error('query commit is invalid');
  return Object.freeze({
    commit: value.commit, workflowId: workflow(value.workflowId), jobName: jobName(value.jobName),
  });
}

function queryCompare(left, right) {
  return left.commit.localeCompare(right.commit)
    || left.workflowId.localeCompare(right.workflowId)
    || left.jobName.localeCompare(right.jobName);
}

function normalizedQueries(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32) {
    throw new Error('provider correlation queries are invalid');
  }
  const queries = values.map(normalizeQuery).sort(queryCompare);
  if (queries.some((entry, index) => index > 0 && queryCompare(queries[index - 1], entry) === 0)) {
    throw new Error('provider correlation queries contain a duplicate');
  }
  return queries;
}

function limits(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !LIMIT_KEYS.includes(key))) {
    throw new Error('provider correlation limits are invalid');
  }
  const result = { ...DEFAULT_LIMITS, ...value };
  for (const key of LIMIT_KEYS) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > MAX_LIMITS[key]) {
      throw new Error(`provider correlation ${key} is invalid`);
    }
  }
  if (result.maxTotalJobs < result.maxJobsPerRun) {
    throw new Error('provider correlation total job bound is smaller than its per-run bound');
  }
  return Object.freeze(result);
}

function freshness(value = 60_000) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_FRESHNESS_MS) {
    throw new Error('provider correlation freshness is invalid');
  }
  return value;
}

function normalizeRun(raw, query) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || ['run_attempt', 'attempt'].some((key) => Object.hasOwn(raw, key))) {
    throw new Error('Forgejo run attempt is unsupported');
  }
  if (['head_sha', 'path', 'conclusion'].some((key) => Object.hasOwn(raw, key))) {
    throw new Error('Forgejo run response uses an unsupported field shape');
  }
  const result = {
    runId: decimal(raw.id, 'Forgejo run id'),
    repositoryRunNumber: decimal(raw.index_in_repo, 'Forgejo repository run number'),
    workflowId: workflow(raw.workflow_id, 'Forgejo workflow_id'),
    commit: raw.commit_sha,
    status: status(raw.status, 'Forgejo run status'),
    runAttempt: null,
    jobs: [],
  };
  if (!COMMIT.test(result.commit ?? '')) throw new Error('Forgejo commit_sha is invalid');
  if (result.commit !== query.commit || result.workflowId !== query.workflowId) {
    throw new Error('Forgejo run server-filter mismatch');
  }
  return result;
}

function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Forgejo job response is malformed');
  }
  if (!Number.isSafeInteger(raw.attempt) || raw.attempt < 1) {
    throw new Error('Forgejo job attempt is invalid');
  }
  return {
    jobId: decimal(raw.id, 'Forgejo job id'),
    taskId: decimal(raw.task_id, 'Forgejo task id'),
    name: jobName(raw.name, 'Forgejo job name'),
    status: status(raw.status, 'Forgejo job status'),
    attempt: raw.attempt,
    handle: boundedString(raw.handle, 'Forgejo job handle', { max: 512 }),
  };
}

function normalizeTask(raw) {
  if (raw?.taskId !== undefined) {
    exactFields(raw, [
      'taskId', 'repositoryRunNumber', 'workflowId', 'jobName', 'commit', 'status',
    ], 'task snapshot');
    const result = {
      taskId: decimal(raw.taskId, 'task snapshot id'),
      repositoryRunNumber: decimal(raw.repositoryRunNumber, 'task snapshot run number'),
      workflowId: workflow(raw.workflowId), jobName: jobName(raw.jobName),
      commit: raw.commit, status: status(raw.status, 'task snapshot status'),
    };
    if (!COMMIT.test(result.commit ?? '')) throw new Error('task snapshot commit is invalid');
    return result;
  }
  const result = {
    taskId: decimal(raw?.id, 'task snapshot id'),
    repositoryRunNumber: decimal(raw?.run_number, 'task snapshot run number'),
    workflowId: workflow(raw?.workflow_id), jobName: jobName(raw?.name),
    commit: raw?.head_sha, status: status(raw?.status, 'task snapshot status'),
  };
  if (!COMMIT.test(result.commit ?? '')) throw new Error('task snapshot commit is invalid');
  return result;
}

function taskCompare(left, right) {
  return left.taskId.localeCompare(right.taskId)
    || left.workflowId.localeCompare(right.workflowId)
    || left.jobName.localeCompare(right.jobName);
}

function normalizeTaskSnapshot(value = []) {
  if (!Array.isArray(value) || value.length > 256) throw new Error('task snapshot is invalid');
  const result = value.map(normalizeTask).sort(taskCompare);
  if (result.some((entry, index) => index > 0 && entry.taskId === result[index - 1].taskId)) {
    throw new Error('task snapshot contains a duplicate task id');
  }
  return result;
}

function pageShape(value) {
  exactFields(value, ['items', 'nextCursor', 'complete'], 'Forgejo pagination page');
  if (!Array.isArray(value.items) || typeof value.complete !== 'boolean') {
    throw new Error('Forgejo pagination page is malformed');
  }
  if (value.nextCursor !== null) boundedString(value.nextCursor, 'Forgejo pagination cursor', { max: 256 });
  if (value.complete && value.nextCursor !== null) throw new Error('complete page has a pagination cursor');
  if (!value.complete && value.nextCursor === null) throw new Error('incomplete page lacks a cursor');
  return value;
}

function newBudget(bound) {
  return {
    ...bound, pages: 0, decodedBytes: 0, totalRuns: 0, totalJobs: 0,
    deadlineAt: Date.now() + bound.deadlineMs,
  };
}

async function withinDeadline(callback, budget) {
  const remaining = budget.deadlineAt - Date.now();
  if (remaining < 1) throw new Error('provider correlation shared deadline expired');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => callback(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('provider correlation shared deadline expired'));
        }, remaining);
      }),
    ]);
  } catch (error) {
    if (error?.message === 'provider correlation shared deadline expired') throw error;
    throw new Error('Forgejo provider correlation query is unavailable');
  } finally { clearTimeout(timer); }
}

async function collectPages(fetchPage, request, budget, consume) {
  if (typeof fetchPage !== 'function') throw new TypeError('Forgejo page fetcher is required');
  const seen = new Set();
  let cursor = null;
  while (true) {
    if (budget.pages >= budget.maxPages) throw new Error('provider correlation page bound exceeded');
    budget.pages += 1;
    const raw = await withinDeadline((signal) => fetchPage({
      ...request, cursor, pageSize: budget.pageSize, signal,
    }), budget);
    const page = pageShape(raw);
    accountDecoded(raw, budget);
    await consume(page.items);
    if (page.complete) return;
    if (seen.has(page.nextCursor)) throw new Error('provider correlation repeated pagination cursor');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function accountDecoded(value, budget) {
  budget.decodedBytes += Buffer.byteLength(JSON.stringify(value));
  if (budget.decodedBytes > budget.maxDecodedBytes) {
    throw new Error('provider correlation decoded-byte bound exceeded');
  }
}

function jobCompare(left, right) {
  return left.jobId.localeCompare(right.jobId) || left.handle.localeCompare(right.handle);
}

async function jobsForRun(rawRun, query, fetchJobsPage, budget, request) {
  const matching = [];
  const seenJobs = new Set();
  let scanned = 0;
  await collectPages(fetchJobsPage, { ...request, runId: rawRun.runId }, budget, async (items) => {
    scanned += items.length;
    budget.totalJobs += items.length;
    if (scanned > budget.maxJobsPerRun || budget.totalJobs > budget.maxTotalJobs) {
      throw new Error('provider correlation job bound exceeded');
    }
    for (const raw of items) {
      const entry = normalizeJob(raw);
      if (seenJobs.has(entry.jobId)) throw new Error('duplicate Forgejo job identity');
      seenJobs.add(entry.jobId);
      if (entry.name === query.jobName) matching.push(entry);
    }
  });
  matching.sort(jobCompare);
  if (matching.some((entry, index) => index > 0 && entry.jobId === matching[index - 1].jobId)) {
    throw new Error('duplicate Forgejo job identity');
  }
  return matching;
}

function runCompare(left, right) {
  return left.runId.localeCompare(right.runId)
    || left.repositoryRunNumber.localeCompare(right.repositoryRunNumber);
}

function runCore(value) {
  const { jobs: _jobs, ...core } = value;
  return core;
}

async function verifiedRunDetail(listed, query, options, budget) {
  if (typeof options.fetchRunDetail !== 'function') {
    throw new TypeError('Forgejo run-detail fetcher is required');
  }
  const raw = await withinDeadline((signal) => options.fetchRunDetail({
    providerInstance: options.providerInstance,
    repository: options.repository,
    runId: listed.runId,
    signal,
  }), budget);
  accountDecoded(raw, budget);
  const detail = normalizeRun(raw, query);
  if (canonicalSha256(runCore(detail)) !== canonicalSha256(runCore(listed))) {
    throw new Error('Forgejo run detail mismatch');
  }
  return detail;
}

async function resultForQuery(query, options, budget) {
  const runs = [];
  await collectPages(options.fetchRunsPage, {
    providerInstance: options.providerInstance, repository: options.repository,
    commit: query.commit, workflowId: query.workflowId, jobName: query.jobName,
  }, budget, async (items) => {
    budget.totalRuns += items.length;
    if (budget.totalRuns > budget.maxRuns) {
      throw new Error('provider correlation run bound exceeded');
    }
    for (const raw of items) runs.push(normalizeRun(raw, query));
  });
  runs.sort(runCompare);
  if (runs.some((entry, index) => index > 0 && entry.runId === runs[index - 1].runId)) {
    throw new Error('duplicate Forgejo run identity');
  }
  for (let index = 0; index < runs.length; index += 1) {
    const entry = await verifiedRunDetail(runs[index], query, options, budget);
    entry.jobs = await jobsForRun(entry, query, options.fetchJobsPage, budget, {
      providerInstance: options.providerInstance, repository: options.repository,
    });
    runs[index] = entry;
  }
  return Object.freeze({ ...query, complete: true, runs });
}

export function providerCorrelationCore(value) {
  return Object.freeze({
    provider: value.provider,
    providerInstance: value.providerInstance,
    repository: value.repository,
    operatorTerminalAuthority: value.operatorTerminalAuthority,
    queries: value.queries,
  });
}

function validateNormalizedJob(value, path) {
  exactFields(value, ['jobId', 'taskId', 'name', 'status', 'attempt', 'handle'], path);
  decimal(value.jobId, `${path}.jobId`); decimal(value.taskId, `${path}.taskId`);
  jobName(value.name, `${path}.name`); status(value.status, `${path}.status`);
  if (!Number.isSafeInteger(value.attempt) || value.attempt < 1) throw new Error(`${path}.attempt is invalid`);
  boundedString(value.handle, `${path}.handle`, { max: 512 });
}

function validateNormalizedRun(value, query, path) {
  exactFields(value, [
    'runId', 'repositoryRunNumber', 'workflowId', 'commit', 'status', 'runAttempt', 'jobs',
  ], path);
  decimal(value.runId, `${path}.runId`); decimal(value.repositoryRunNumber, `${path}.repositoryRunNumber`);
  if (value.commit !== query.commit || value.workflowId !== query.workflowId || value.runAttempt !== null) {
    throw new Error(`${path} does not match its query or invents a run attempt`);
  }
  status(value.status, `${path}.status`);
  if (!Array.isArray(value.jobs)) throw new Error(`${path}.jobs is invalid`);
  value.jobs.forEach((entry, index) => validateNormalizedJob(entry, `${path}.jobs[${index}]`));
  if (value.jobs.some((entry) => entry.name !== query.jobName)) throw new Error(`${path}.jobs are not exact matches`);
  if (value.jobs.some((entry, index) => index > 0 && jobCompare(value.jobs[index - 1], entry) >= 0)) {
    throw new Error(`${path}.jobs are unsorted or duplicated`);
  }
}

function validateEvidenceQueries(value) {
  const expected = normalizedQueries(value.map(({ complete: _complete, runs: _runs, ...query }) => query));
  if (expected.some((entry, index) => queryCompare(entry, value[index]) !== 0)) {
    throw new Error('provider correlation queries are unsorted');
  }
  value.forEach((query, queryIndex) => {
    exactFields(query, ['commit', 'workflowId', 'jobName', 'complete', 'runs'], `queries[${queryIndex}]`);
    if (query.complete !== true || !Array.isArray(query.runs)) throw new Error('provider correlation query is incomplete');
    query.runs.forEach((entry, index) => validateNormalizedRun(entry, query, `queries[${queryIndex}].runs[${index}]`));
    if (query.runs.some((entry, index) => index > 0 && runCompare(query.runs[index - 1], entry) >= 0)) {
      throw new Error('provider correlation runs are unsorted or duplicated');
    }
  });
}

function validateEvidenceIdentity(value) {
  if (value.schemaVersion !== '1.0.0' || value.artifactType !== 'provider_correlation_evidence'
      || value.provider !== 'forgejo') throw new Error('provider correlation evidence type is invalid');
  if (value.providerInstance !== providerInstance(value.providerInstance)
      || !REPOSITORY.test(value.repository ?? '')) throw new Error('provider correlation authority is invalid');
  if (value.operatorTerminalAuthority !== false) throw new Error('operatorTerminalAuthority must be false');
}

function validateEvidenceFreshness(value, now) {
  const observed = timestamp(value.observedAt, 'provider correlation observedAt');
  const expires = timestamp(value.freshUntil, 'provider correlation freshUntil');
  if (expires <= observed || expires - observed > MAX_FRESHNESS_MS) throw new Error('provider correlation freshness is invalid');
  if (now === undefined) return;
  const instant = timestamp(now, 'provider correlation current time');
  if (instant < observed || instant >= expires) {
    throw new Error('provider correlation evidence expired or is not yet valid');
  }
}

function validateEvidenceContent(value) {
  if (!Array.isArray(value.queries)) throw new Error('provider correlation queries are invalid');
  validateEvidenceQueries(value.queries);
  const normalizedTasks = normalizeTaskSnapshot(value.taskSnapshot);
  if (canonicalSha256(normalizedTasks) !== canonicalSha256(value.taskSnapshot)) {
    throw new Error('task snapshot is unsorted or noncanonical');
  }
  if (!/^[a-f0-9]{64}$/.test(value.queryResultCoreDigest ?? '')
      || value.queryResultCoreDigest !== canonicalSha256(providerCorrelationCore(value))) {
    throw new Error('provider correlation core digest is invalid');
  }
}

export function validateProviderCorrelationEvidence(value, { now } = {}) {
  exactFields(value, [
    'schemaVersion', 'artifactType', 'provider', 'providerInstance', 'repository',
    'operatorTerminalAuthority', 'queryResultCoreDigest', 'observedAt', 'freshUntil',
    'queries', 'taskSnapshot',
  ], 'provider correlation evidence');
  validateEvidenceIdentity(value);
  validateEvidenceFreshness(value, now);
  validateEvidenceContent(value);
  return value;
}

export async function observeForgejoProviderCorrelation(options = {}) {
  const authority = providerInstance(options.providerInstance);
  if (!REPOSITORY.test(options.repository ?? '')) throw new Error('repository is invalid');
  const queries = normalizedQueries(options.queries);
  const bound = limits(options.limits);
  const budget = newBudget(bound);
  const results = [];
  const queryOptions = { ...options, providerInstance: authority, repository: options.repository };
  for (const query of queries) results.push(await resultForQuery(query, queryOptions, budget));
  const observed = timestamp(typeof options.now === 'function' ? options.now() : (options.now ?? new Date()), 'now');
  const evidence = {
    schemaVersion: '1.0.0', artifactType: 'provider_correlation_evidence',
    provider: 'forgejo', providerInstance: authority, repository: options.repository,
    operatorTerminalAuthority: false,
    queryResultCoreDigest: null,
    observedAt: observed.toISOString(),
    freshUntil: new Date(observed.getTime() + freshness(options.freshnessMs)).toISOString(),
    queries: results,
    taskSnapshot: normalizeTaskSnapshot(options.taskSnapshot),
  };
  evidence.queryResultCoreDigest = canonicalSha256(providerCorrelationCore(evidence));
  validateProviderCorrelationEvidence(evidence, { now: observed });
  return Object.freeze(evidence);
}

export async function revalidateForgejoProviderCorrelation(prior, options = {}) {
  const instant = typeof options.now === 'function' ? options.now() : (options.now ?? new Date());
  validateProviderCorrelationEvidence(prior, options.allowExpiredPrior ? {} : { now: instant });
  const queries = prior.queries.map(({ complete: _complete, runs: _runs, ...query }) => query);
  const fresh = await observeForgejoProviderCorrelation({
    ...options,
    providerInstance: prior.providerInstance,
    repository: prior.repository,
    queries,
  });
  if (fresh.queryResultCoreDigest !== prior.queryResultCoreDigest) {
    throw new Error('provider correlation stable core drifted');
  }
  return fresh;
}
