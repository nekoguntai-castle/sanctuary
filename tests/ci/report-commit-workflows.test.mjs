import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observationTimeoutMs, reportCommitWorkflows,
} from '../../scripts/ci/report-commit-workflows.mjs';

const sha = 'a'.repeat(40);
const manifest = { event: 'push', workflows: [{ workflow_id: 'quality.yml', required_jobs: ['Quality'] }] };
const run = (id, status = 'success') => ({ id, workflow_id: 'quality.yml', commit_sha: sha, event: 'push', status });
const job = (status = 'success', attempt = 1) => ({ id: 100, name: 'Quality', status, attempt });
function getter(runs = [run(1)], jobs = [job()]) {
  return async (url) => {
    if (url.endsWith('/jobs')) return structuredClone(jobs);
    const detail = url.match(/^actions\/runs\/([0-9]+)$/);
    if (detail) return structuredClone(runs.find(({ id }) => id === Number(detail[1])));
    return { total_count: runs.length, workflow_runs: structuredClone(runs) };
  };
}

test('exact commit and aggregate success required; latest run dominates', async () => {
  assert.equal((await reportCommitWorkflows(sha, manifest, getter())).state, 'success');
  const result = await reportCommitWorkflows(sha, manifest, getter([run(1), run(2, 'running')], [job('running')]));
  assert.equal(result.state, 'running');
  assert.equal(result.progress, 'not_measured');
  assert.equal(result.workflows[0].run_id, 2);
  const recovered = await reportCommitWorkflows(sha, manifest, getter(
    [run(1, 'failure'), run(2)], [job('success', 2)],
  ));
  assert.equal(recovered.state, 'success');
  assert.equal(recovered.workflows[0].attempt, 2);
});

test('missing run or aggregate, ambiguous aggregate, failed aggregate never succeed', async () => {
  for (const [runs, jobs, expected] of [
    [[], [], 'unknown'], [[run(1)], [], 'unknown'],
    [[run(1)], [job(), { ...job(), id: 101 }], 'unknown'],
    [[run(1)], [job('failure')], 'failure'], [[run(1)], [job('skipped')], 'failure'],
    [[run(1, 'failure')], [job('running')], 'failure'],
    [[run(1, 'blocked')], [job('blocked')], 'running'],
  ]) assert.equal((await reportCommitWorkflows(sha, manifest, getter(runs, jobs))).state, expected);
});

test('malformed identity, duplicate IDs and unsafe counters fail closed', async () => {
  for (const runs of [[{ ...run(1), commit_sha: 'b'.repeat(40) }], [{ ...run(1), event: 'pull_request' }],
    [run(1), run(1)], [{ ...run(1), status: 'completed' }]]) {
    assert.equal((await reportCommitWorkflows(sha, manifest, getter(runs))).state, 'unknown');
  }
  for (const total_count of [-1, 1.1, 1001, '1']) {
    assert.equal((await reportCommitWorkflows(sha, manifest, async () => ({ total_count, workflow_runs: [run(1)] }))).state, 'unknown');
  }
});

test('bounded pagination checks stable total and entire repeated snapshots', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => run(index + 1));
  let calls = 0;
  const get = async (url) => {
    if (url.includes('/jobs')) return [job()];
    const detail = url.match(/^actions\/runs\/([0-9]+)$/);
    if (detail) return rows.find(({ id }) => id === Number(detail[1]));
    calls += 1;
    return { total_count: 51, workflow_runs: url.includes('page=1&') ? rows.slice(0, 50) : rows.slice(50) };
  };
  assert.equal((await reportCommitWorkflows(sha, manifest, get)).state, 'success');
  assert.equal(calls, 4);
  let snapshots = 0;
  const moving = async (url) => {
    if (url.includes('/jobs')) return [job()];
    if (/^actions\/runs\/[0-9]+$/.test(url)) return run(snapshots);
    return { total_count: 1, workflow_runs: [run(++snapshots)] };
  };
  assert.equal((await reportCommitWorkflows(sha, manifest, moving)).reason, 'runs_changed_during_observation');

  let pages = 0;
  const unstableTotal = async (url) => {
    if (url.includes('/jobs')) return [job()];
    if (/^actions\/runs\/[0-9]+$/.test(url)) return run(51);
    pages += 1;
    return pages === 1
      ? { total_count: 51, workflow_runs: rows.slice(0, 50) }
      : { total_count: 52, workflow_runs: rows.slice(50) };
  };
  assert.equal((await reportCommitWorkflows(sha, manifest, unstableTotal)).reason, 'unstable_run_count');
});

test('changing jobs and transport exceptions cannot yield green or leak raw errors', async () => {
  let jobs = 0;
  const get = async (url) => {
    if (url.includes('/jobs')) return [job(++jobs === 1 ? 'success' : 'running')];
    if (/^actions\/runs\/[0-9]+$/.test(url)) return run(1);
    return { total_count: 1, workflow_runs: [run(1)] };
  };
  assert.equal((await reportCommitWorkflows(sha, manifest, get)).reason, 'jobs_changed_during_observation');
  const failed = await reportCommitWorkflows(sha, manifest, async () => { throw new Error('secret-token /private/path'); });
  assert.equal(failed.state, 'unknown');
  assert.doesNotMatch(JSON.stringify(failed), /secret-token|private/);
  const nonError = await reportCommitWorkflows(sha, manifest, async () => { throw 'secret-token'; });
  assert.equal(nonError.reason, 'unavailable_or_malformed');
});

test('run detail drift and mixed job attempts fail closed', async () => {
  const detailDrift = async (url) => {
    if (url.endsWith('/jobs')) return [job()];
    if (/^actions\/runs\/[0-9]+$/.test(url)) return { ...run(1), status: 'running' };
    return { total_count: 1, workflow_runs: [run(1)] };
  };
  assert.equal((await reportCommitWorkflows(sha, manifest, detailDrift)).reason, 'run_detail_mismatch');
  assert.equal((await reportCommitWorkflows(
    sha, { event: 'push', workflows: [{ workflow_id: 'quality.yml', required_jobs: ['Quality', 'Other'] }] },
    getter([run(1)], [job(), { id: 101, name: 'Other', status: 'success', attempt: 2 }]),
  )).reason, 'mixed_job_attempts');
});

test('invalid manifests and SHA are rejected before fetching', async () => {
  let calls = 0;
  const get = async () => { calls += 1; return {}; };
  for (const input of [null, {}, { event: 'push', workflows: [] },
    { event: 'push', workflows: [{ workflow_id: 'x', required_jobs: [] }] },
    { event: 'x'.repeat(41), workflows: [{ workflow_id: 'x', required_jobs: ['Job'] }] },
    { event: 'push', extra: true, workflows: [{ workflow_id: 'x', required_jobs: ['Job'] }] },
    { event: 'push', workflows: [{ workflow_id: 'x', required_jobs: ['Job'], extra: true }] },
    { event: 'push', workflows: [{ workflow_id: 'x', required_jobs: Array.from(
      { length: 101 }, (_, index) => `Job ${index}`,
    ) }] },
  ]) {
    assert.equal((await reportCommitWorkflows(sha, input, get)).state, 'unknown');
  }
  assert.equal((await reportCommitWorkflows('short', manifest, get)).state, 'unknown');
  assert.equal(calls, 0);
});

test('transport timeout cannot overrun the whole observation budget', () => {
  assert.equal(observationTimeoutMs(1_000, 1_000), 65_000);
  assert.equal(observationTimeoutMs(1_000, 235_001), 65_000);
  assert.equal(observationTimeoutMs(1_000, 300_999), 1);
  assert.throws(() => observationTimeoutMs(1_000, 301_000), /observation_budget_exhausted/);
});
