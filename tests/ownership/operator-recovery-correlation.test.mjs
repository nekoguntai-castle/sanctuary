import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  observeForgejoProviderCorrelation,
  providerCorrelationCore,
  revalidateForgejoProviderCorrelation,
  validateProviderCorrelationEvidence,
} from '../../scripts/ownership/operator-recovery-correlation.mjs';

const COMMIT = 'a'.repeat(40);
const OBSERVED = new Date('2026-09-02T20:00:00.000Z');
const QUERY = Object.freeze({
  commit: COMMIT, workflowId: 'install-test.yml', jobName: 'Fresh Install E2E Test',
});

function run(overrides = {}) {
  return {
    id: 14338, index_in_repo: 10085, workflow_id: QUERY.workflowId,
    commit_sha: COMMIT, status: 'cancelled', ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: 181377, task_id: 0, name: QUERY.jobName, status: 'skipped',
    attempt: 1, handle: 'd7b54f27-d8fd-4f3d-b3b3-2028bb3898cb', ...overrides,
  };
}

function page(items, { nextCursor = null, complete = true, extra = {} } = {}) {
  return { items, nextCursor, complete, ...extra };
}

function callbacks({ runs = [run()], jobs = [job()] } = {}) {
  return {
    fetchRunsPage: async () => page(runs),
    fetchRunDetail: async ({ runId }) => runs.find((entry) => String(entry.id) === runId),
    fetchJobsPage: async () => page(jobs),
  };
}

function input(overrides = {}) {
  return {
    providerInstance: 'http://forgejo.test', repository: 'owner/repository',
    queries: [QUERY], now: () => OBSERVED,
    taskSnapshot: [{
      id: 99604, run_number: 5053, workflow_id: 'install-test.yml',
      name: 'Install Script E2E Test', head_sha: 'b'.repeat(40), status: 'success',
    }],
    ...callbacks(), ...overrides,
  };
}

test('records real Forgejo run/job fields without granting terminal authority', async () => {
  const evidence = await observeForgejoProviderCorrelation(input());
  assert.equal(evidence.operatorTerminalAuthority, false);
  assert.equal(evidence.queries[0].complete, true);
  assert.deepEqual(evidence.queries[0].runs, [{
    runId: '14338', repositoryRunNumber: '10085', workflowId: 'install-test.yml',
    commit: COMMIT, status: 'cancelled', runAttempt: null,
    jobs: [{
      jobId: '181377', taskId: '0', name: QUERY.jobName, status: 'skipped',
      attempt: 1, handle: 'd7b54f27-d8fd-4f3d-b3b3-2028bb3898cb',
    }],
  }]);
  assert.deepEqual(evidence.taskSnapshot, [{
    taskId: '99604', repositoryRunNumber: '5053', workflowId: 'install-test.yml',
    jobName: 'Install Script E2E Test', commit: 'b'.repeat(40), status: 'success',
  }]);
  assert.equal(evidence.queryResultCoreDigest, canonicalSha256(providerCorrelationCore(evidence)));
  assert.equal(validateProviderCorrelationEvidence(evidence, { now: OBSERVED }), evidence);
});

test('stable core excludes the temporal envelope and diagnostic task snapshot', async () => {
  const first = await observeForgejoProviderCorrelation(input());
  const second = await observeForgejoProviderCorrelation(input({
    now: () => new Date(OBSERVED.getTime() + 1_000), taskSnapshot: [],
  }));
  assert.notEqual(canonicalSha256(first), canonicalSha256(second));
  assert.equal(first.queryResultCoreDigest, second.queryResultCoreDigest);
});

test('revalidation accepts fresh timestamps and refuses exact-result drift', async () => {
  const prior = await observeForgejoProviderCorrelation(input({ freshnessMs: 60_000 }));
  const fresh = await revalidateForgejoProviderCorrelation(prior, input({
    now: () => new Date(OBSERVED.getTime() + 10_000), taskSnapshot: [],
  }));
  assert.equal(fresh.queryResultCoreDigest, prior.queryResultCoreDigest);
  assert.notEqual(fresh.observedAt, prior.observedAt);

  await assert.rejects(revalidateForgejoProviderCorrelation(prior, input({
    now: () => new Date(OBSERVED.getTime() + 61_000), taskSnapshot: [],
  })), /expired/);
  const recovered = await revalidateForgejoProviderCorrelation(prior, input({
    now: () => new Date(OBSERVED.getTime() + 61_000), taskSnapshot: [],
    allowExpiredPrior: true,
  }));
  assert.equal(recovered.queryResultCoreDigest, prior.queryResultCoreDigest);

  await assert.rejects(revalidateForgejoProviderCorrelation(prior, input({
    now: () => new Date(OBSERVED.getTime() + 10_000),
    ...callbacks({ jobs: [job({ status: 'success' })] }),
  })), /stable core drifted/);
});

test('rejects run/task namespace substitution and GitHub-shaped run fields', async () => {
  await assert.rejects(observeForgejoProviderCorrelation(input({
    ...callbacks({ runs: [{
      id: 99604, path: 'install-test.yml', head_sha: COMMIT,
      status: 'completed', conclusion: 'failure', run_attempt: 1,
    }] }),
  })), /Forgejo run (?:response|attempt)/);
  await assert.rejects(observeForgejoProviderCorrelation(input({
    ...callbacks({ runs: [run({ run_attempt: 1 })] }),
  })), /run attempt is unsupported/);
});

test('rejects server-filter mismatches, duplicate identities, and incomplete pages', async () => {
  for (const changed of [
    { commit_sha: 'c'.repeat(40) }, { workflow_id: 'quality.yml' },
  ]) {
    await assert.rejects(observeForgejoProviderCorrelation(input({
      ...callbacks({ runs: [run(changed)] }),
    })), /server-filter mismatch/);
  }
  await assert.rejects(observeForgejoProviderCorrelation(input({
    ...callbacks({ runs: [run(), run()] }),
  })), /duplicate Forgejo run/);
  await assert.rejects(observeForgejoProviderCorrelation(input({
    fetchRunsPage: async () => page([], { complete: false, nextCursor: null }),
  })), /incomplete page lacks a cursor/);
});

test('enforces page and repeated-cursor bounds', async () => {
  let calls = 0;
  await assert.rejects(observeForgejoProviderCorrelation(input({
    fetchRunsPage: async () => {
      calls += 1;
      return page([], { complete: false, nextCursor: 'again' });
    },
  })), /repeated pagination cursor/);
  assert.equal(calls, 2);

  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { maxPages: 1 },
    fetchRunsPage: async () => page([], { complete: false, nextCursor: '2' }),
  })), /page bound/);
});

test('enforces run, job, and decoded-byte bounds', async () => {
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { maxRuns: 1 }, ...callbacks({ runs: [run(), run({ id: 14339 })] }),
  })), /run bound/);
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { maxJobsPerRun: 1 }, ...callbacks({
      jobs: [job(), job({ id: 181378, handle: 'another-handle' })],
    }),
  })), /job bound/);
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { maxDecodedBytes: 64 },
  })), /decoded-byte bound/);

  const secondQuery = { ...QUERY, commit: 'd'.repeat(40) };
  await assert.rejects(observeForgejoProviderCorrelation(input({
    queries: [QUERY, secondQuery], limits: { maxRuns: 1 },
    fetchRunsPage: async ({ commit }) => page([run({ commit_sha: commit })]),
    fetchRunDetail: async ({ runId }) => run({ id: Number(runId) }),
  })), /run bound/);
});

test('rejects duplicate job identities even when the duplicate is unrelated', async () => {
  const unrelated = job({ name: 'Other Job' });
  await assert.rejects(observeForgejoProviderCorrelation(input({
    ...callbacks({ jobs: [unrelated, unrelated] }),
  })), /duplicate Forgejo job/);
});

test('uses one shared deadline across later pages and job queries', async () => {
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { deadlineMs: 20 },
    fetchRunsPage: async () => page([run()]),
    fetchJobsPage: async () => new Promise(() => {}),
  })), /shared deadline/);
});

test('sanitizes provider failures and rejects excessive configured limits', async () => {
  await assert.rejects(observeForgejoProviderCorrelation(input({
    fetchRunsPage: async () => { throw new Error('secret response body'); },
  })), (error) => error.message === 'Forgejo provider correlation query is unavailable');
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { deadlineMs: 120_001 },
  })), /deadlineMs is invalid/);
});

test('cross-checks run detail under the shared deadline', async () => {
  await assert.rejects(observeForgejoProviderCorrelation(input({
    fetchRunDetail: async () => run({ status: 'success' }),
  })), /detail mismatch/);
  await assert.rejects(observeForgejoProviderCorrelation(input({
    limits: { deadlineMs: 20 },
    fetchRunDetail: async () => new Promise(() => {}),
  })), /shared deadline/);
});

test('passes exact filters and cursors and canonically sorts multipage results', async () => {
  const calls = [];
  const listed = [run({ id: 14339, index_in_repo: 10086 }), run()];
  const evidence = await observeForgejoProviderCorrelation(input({
    fetchRunsPage: async (request) => {
      calls.push({ kind: 'runs', ...request, signal: Boolean(request.signal) });
      return request.cursor === null
        ? page([listed[0]], { complete: false, nextCursor: 'page-2' })
        : page([listed[1]]);
    },
    fetchRunDetail: async (request) => {
      calls.push({ kind: 'detail', ...request, signal: Boolean(request.signal) });
      return listed.find((entry) => String(entry.id) === request.runId);
    },
    fetchJobsPage: async (request) => {
      calls.push({ kind: 'jobs', ...request, signal: Boolean(request.signal) });
      return page([job({ id: Number(request.runId) + 100_000,
        handle: `handle-${request.runId}` })]);
    },
  }));
  assert.deepEqual(evidence.queries[0].runs.map((entry) => entry.runId), ['14338', '14339']);
  assert.deepEqual(calls[0], {
    kind: 'runs', providerInstance: 'http://forgejo.test', repository: 'owner/repository',
    commit: COMMIT, workflowId: QUERY.workflowId, jobName: QUERY.jobName,
    cursor: null, pageSize: 50, signal: true,
  });
  assert.equal(calls[1].cursor, 'page-2');
  assert.equal(calls.filter((entry) => entry.kind === 'detail').length, 2);
  assert.equal(calls.filter((entry) => entry.kind === 'jobs').length, 2);
});

test('represents a complete zero-result filtered query without detail or job calls', async () => {
  let detailCalls = 0;
  let jobCalls = 0;
  const evidence = await observeForgejoProviderCorrelation(input({
    fetchRunsPage: async () => page([]),
    fetchRunDetail: async () => { detailCalls += 1; },
    fetchJobsPage: async () => { jobCalls += 1; },
  }));
  assert.deepEqual(evidence.queries[0].runs, []);
  assert.equal(detailCalls, 0);
  assert.equal(jobCalls, 0);
});

test('validates exact evidence shape, freshness, completeness, and core digest', async () => {
  const evidence = await observeForgejoProviderCorrelation(input({ freshnessMs: 60_000 }));
  assert.throws(() => validateProviderCorrelationEvidence({
    ...evidence, operatorTerminalAuthority: true,
  }, { now: OBSERVED }), /must be false/);
  assert.throws(() => validateProviderCorrelationEvidence({
    ...evidence, queryResultCoreDigest: 'f'.repeat(64),
  }, { now: OBSERVED }), /core digest/);
  assert.throws(() => validateProviderCorrelationEvidence({ ...evidence, extra: null }), /fields/);
  assert.throws(() => validateProviderCorrelationEvidence(evidence, {
    now: new Date(OBSERVED.getTime() + 60_000),
  }), /expired/);
});
