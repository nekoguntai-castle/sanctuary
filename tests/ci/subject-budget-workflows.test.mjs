import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from './lib/yaml.mjs';

const jobs = {
  'install-test': ['fresh-install-test', 'install-stack-smoke', 'container-health-test',
    'auth-flow-test', 'upgrade-baseline-test', 'upgrade-extended-fixture-test'],
  'release-candidate': ['wallet-sync-replay-images', 'wallet-sync-live-shape',
    'wallet-sync-maximum-shapes', 'fresh-install-test'],
  'verify-vectors': ['verify-vectors', 'verify-trezor-emulator', 'verify-ledger-emulator',
    'verify-jade-emulator', 'regenerate-psbt-vectors'],
};
const bounded = {
  'install-test': ['Run baseline upgrades in one signed isolated workspace',
    'Run extended upgrade fixtures sequentially'],
  'verify-vectors': ['Run pinned Jade vendor protocol harness',
    'Run cross-implementation address verifier', 'Run receipt-bound live Bitcoin Core PSBT proof',
    'Run pinned Trezor emulator proof', 'Run pinned Ledger emulator proof',
    'Run pinned Jade QEMU proof', 'Run receipt-bound regenerated Bitcoin Core PSBT proof'],
};

for (const [workflowName, jobIds] of Object.entries(jobs)) {
  const workflow = YAML.parse(readFileSync(`.github/workflows/${workflowName}.yml`, 'utf8'));
  for (const jobId of jobIds) {
    test(`${workflowName}/${jobId} captures origin before checkout and initializes exactly once`, () => {
      const job = workflow.jobs[jobId];
      const checkout = job.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'));
      const capture = job.steps[0];
      assert.equal(capture.name, 'Capture job budget origin');
      assert.match(capture.run, /date \+%s/);
      assert.match(capture.run, /SANCTUARY_CI_JOB_STARTED_EPOCH_MS/);
      assert.match(capture.run, /FORGEJO_ENV/);
      assert.match(capture.run, /GITHUB_ENV/);
      const initializers = job.steps.filter((step) => step.run?.includes('subject-budget.mjs initialize'));
      assert.equal(initializers.length, 1);
      assert.equal(job.steps[checkout + 1], initializers[0]);
      assert.equal(initializers[0].if, job.steps[checkout].if);
      assert.equal(capture.if, job.steps[checkout].if);
      const reserve = job['timeout-minutes'] >= 90 ? 600 : job['timeout-minutes'] <= 25 ? 180 : 300;
      assert.match(initializers[0].run, new RegExp(`initialize ${job['timeout-minutes'] * 60} ${reserve}$`));
    });
  }
  for (const stepName of bounded[workflowName] ?? []) {
    test(`${workflowName}/${stepName} narrows once before its subject without masking errors`, () => {
      const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
      const step = steps.find((candidate) => candidate.name === stepName);
      assert.ok(step, `missing subject step ${stepName}`);
      const reserve = step['timeout-minutes'] <= 10 ? 120 : 300;
      assert.match(step.run, new RegExp(`subject-budget.mjs" step-deadline ${step['timeout-minutes'] * 60} ${reserve}`));
      assert.equal(step.run.match(/subject-budget.mjs" step-deadline/g)?.length, 1);
      assert.match(step.run, /node "\$GITHUB_WORKSPACE\/scripts\/ci\/subject-budget.mjs"/);
      assert.match(step.run, /^set -euo pipefail\nSANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS="\$\(node .*\)"\nexport SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS\n/);
      assert.doesNotMatch(step.run, /export .*\$\(/);
      assert.doesNotMatch(step.run, /subject-budget.mjs initialize/);
    });
  }
}
