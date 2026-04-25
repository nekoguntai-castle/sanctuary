import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TimingReporter from '../../scripts/ci/playwright-timing-reporter.cjs';

const { buildTimingReport, durationText } = TimingReporter;

function fakeTest(file, project, titleParts) {
  return {
    location: { file: path.join(process.cwd(), file) },
    parent: {
      project: () => ({ name: project }),
    },
    titlePath: () => titleParts,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runReporterFixture() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-timing-reporter-'));
  const reporter = new TimingReporter({ outputDir });

  reporter.onTestEnd(
    fakeTest('e2e/wallet-flow.spec.ts', 'chromium', ['chromium', 'wallet flow', 'creates wallet']),
    { status: 'passed', retry: 0, duration: 1250 },
  );
  reporter.onTestEnd(
    fakeTest('e2e/wallet-flow.spec.ts', 'chromium', ['chromium', 'wallet flow', 'sends payment']),
    { status: 'failed', retry: 1, duration: 2750 },
  );
  reporter.onTestEnd(
    fakeTest('e2e/settings.spec.ts', 'chromium', ['chromium', 'settings', 'updates profile']),
    { status: 'passed', retry: 0, duration: 5000 },
  );
  reporter.onEnd();

  return outputDir;
}

function assertReporterOutputs() {
  const outputDir = runReporterFixture();

  try {
    const report = readJson(path.join(outputDir, 'playwright-timing.json'));
    const markdown = fs.readFileSync(path.join(outputDir, 'playwright-timing.md'), 'utf8');

    assert.equal(report.total.specCount, 2);
    assert.equal(report.total.testRuns, 3);
    assert.equal(report.total.durationMs, 9000);
    assert.equal(report.total.duration, '9s');

    assert.equal(report.specs[0].file, 'e2e/settings.spec.ts');
    assert.equal(report.specs[0].duration, '5s');
    assert.deepEqual(report.specs[0].projects, ['chromium']);
    assert.deepEqual(report.specs[1].statuses, { failed: 1, passed: 1 });
    assert.equal(report.specs[1].slowestTest.retry, 1);
    assert.equal(report.slowestTests[0].title, 'chromium > settings > updates profile');

    assert.match(markdown, /# Playwright Timing/);
    assert.match(markdown, /\| e2e\/settings\.spec\.ts \| 5s \| 1 \| chromium \| passed: 1 \|/);
    assert.match(markdown, /3s chromium > wallet flow > sends payment/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function assertPureReportHelpers() {
  assert.equal(durationText(0), '0ms');
  assert.equal(durationText(-1), '0ms');
  assert.equal(durationText(999), '999ms');
  assert.equal(durationText(61_000), '1m 1s');

  const emptyReport = buildTimingReport([], '2026-04-25T00:00:00.000Z');
  assert.equal(emptyReport.total.specCount, 0);
  assert.equal(emptyReport.total.testRuns, 0);
  assert.deepEqual(emptyReport.specs, []);
  assert.deepEqual(emptyReport.slowestTests, []);

  const report = buildTimingReport([
    {
      file: 'e2e/a.spec.ts',
      title: 'a passes',
      project: 'chromium',
      status: 'passed',
      retry: 0,
      durationMs: 100,
    },
  ], '2026-04-25T00:00:00.000Z');

  assert.equal(report.generatedAt, '2026-04-25T00:00:00.000Z');
  assert.equal(report.specs[0].duration, '100ms');
  assert.equal(report.slowestTests[0].file, 'e2e/a.spec.ts');
}

function assertReporterDefaults() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-timing-reporter-defaults-'));
  const reporter = new TimingReporter({ outputDir });

  try {
    reporter.onTestEnd({ location: {}, parent: {} }, {});
    reporter.onEnd();

    const report = readJson(path.join(outputDir, 'playwright-timing.json'));
    assert.equal(report.specs[0].file, 'unknown');
    assert.equal(report.specs[0].statuses.unknown, 1);
    assert.equal(report.slowestTests[0].duration, '0ms');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

assertReporterOutputs();
assertPureReportHelpers();
assertReporterDefaults();
console.log('playwright timing reporter regression checks passed');
