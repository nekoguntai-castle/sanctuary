const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT_DIR = 'test-results';
const DEFAULT_JSON_FILE = 'playwright-timing.json';
const DEFAULT_MARKDOWN_FILE = 'playwright-timing.md';

function normalizePath(filePath) {
  if (!filePath) {
    return 'unknown';
  }

  const relativePath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath;

  return relativePath.split(path.sep).join('/');
}

function resolveOutputPath(outputDir, fileName) {
  if (path.isAbsolute(fileName)) {
    return fileName;
  }

  return path.join(outputDir, fileName);
}

function safeProjectName(test) {
  try {
    const project = test.parent?.project?.();
    return project?.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function safeTitlePath(test) {
  if (typeof test.titlePath === 'function') {
    return test.titlePath().filter(Boolean).join(' > ');
  }

  return test.title || 'unknown';
}

function statusCountsText(statusCounts) {
  return Object.entries(statusCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ');
}

function durationText(durationMs) {
  const safeDurationMs = Math.max(0, Math.round(durationMs || 0));
  if (safeDurationMs < 1000) {
    return `${safeDurationMs}ms`;
  }

  const totalSeconds = Math.round(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|');
}

function emptySpecSummary(file) {
  return {
    file,
    durationMs: 0,
    duration: '0ms',
    testRuns: 0,
    projects: [],
    statuses: {},
    slowestTest: null,
  };
}

function addRecordToSpec(spec, record) {
  spec.durationMs += record.durationMs;
  spec.testRuns += 1;
  spec.statuses[record.status] = (spec.statuses[record.status] || 0) + 1;

  if (!spec.projects.includes(record.project)) {
    spec.projects.push(record.project);
    spec.projects.sort();
  }

  if (!spec.slowestTest || record.durationMs > spec.slowestTest.durationMs) {
    spec.slowestTest = {
      title: record.title,
      project: record.project,
      status: record.status,
      retry: record.retry,
      durationMs: record.durationMs,
      duration: durationText(record.durationMs),
    };
  }
}

function finalizeSpec(spec) {
  return {
    ...spec,
    duration: durationText(spec.durationMs),
  };
}

function buildTimingReport(records, generatedAt = new Date().toISOString()) {
  const specsByFile = new Map();
  let totalDurationMs = 0;

  for (const record of records) {
    totalDurationMs += record.durationMs;
    const spec = specsByFile.get(record.file) || emptySpecSummary(record.file);
    addRecordToSpec(spec, record);
    specsByFile.set(record.file, spec);
  }

  const specs = [...specsByFile.values()]
    .map(finalizeSpec)
    .sort((left, right) => right.durationMs - left.durationMs || left.file.localeCompare(right.file));

  const slowestTests = [...records]
    .sort((left, right) => right.durationMs - left.durationMs || left.title.localeCompare(right.title))
    .slice(0, 10)
    .map((record) => ({
      file: record.file,
      title: record.title,
      project: record.project,
      status: record.status,
      retry: record.retry,
      durationMs: record.durationMs,
      duration: durationText(record.durationMs),
    }));

  return {
    generatedAt,
    total: {
      specCount: specs.length,
      testRuns: records.length,
      durationMs: totalDurationMs,
      duration: durationText(totalDurationMs),
    },
    specs,
    slowestTests,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Playwright Timing',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Specs | ${report.total.specCount} |`,
    `| Test runs | ${report.total.testRuns} |`,
    `| Total runner time | ${report.total.duration} |`,
    '',
    '## Slowest Specs',
    '',
    '| Spec | Duration | Test runs | Projects | Statuses | Slowest test |',
    '| --- | ---: | ---: | --- | --- | --- |',
  ];

  for (const spec of report.specs.slice(0, 20)) {
    const slowestTest = spec.slowestTest
      ? `${spec.slowestTest.duration} ${spec.slowestTest.title}`
      : 'none';
    lines.push(
      `| ${escapeMarkdown(spec.file)} | ${spec.duration} | ${spec.testRuns} | ${escapeMarkdown(spec.projects.join(', '))} | ${escapeMarkdown(statusCountsText(spec.statuses))} | ${escapeMarkdown(slowestTest)} |`,
    );
  }

  lines.push('', '## Slowest Tests', '');
  lines.push('| Spec | Test | Project | Status | Retry | Duration |');
  lines.push('| --- | --- | --- | --- | ---: | ---: |');

  for (const test of report.slowestTests) {
    lines.push(
      `| ${escapeMarkdown(test.file)} | ${escapeMarkdown(test.title)} | ${escapeMarkdown(test.project)} | ${escapeMarkdown(test.status)} | ${test.retry} | ${test.duration} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

class PlaywrightTimingReporter {
  constructor(options = {}) {
    this.records = [];
    this.outputDir = path.resolve(
      process.cwd(),
      options.outputDir || process.env.PLAYWRIGHT_TIMING_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    );
    this.jsonPath = resolveOutputPath(
      this.outputDir,
      options.jsonFile || process.env.PLAYWRIGHT_TIMING_JSON_FILE || DEFAULT_JSON_FILE,
    );
    this.markdownPath = resolveOutputPath(
      this.outputDir,
      options.markdownFile || process.env.PLAYWRIGHT_TIMING_MARKDOWN_FILE || DEFAULT_MARKDOWN_FILE,
    );
  }

  onTestEnd(test, result) {
    this.records.push({
      file: normalizePath(test.location?.file),
      title: safeTitlePath(test),
      project: safeProjectName(test),
      status: result.status || 'unknown',
      retry: Number.isInteger(result.retry) ? result.retry : 0,
      durationMs: Math.max(0, Math.round(result.duration || 0)),
    });
  }

  onEnd() {
    const report = buildTimingReport(this.records);
    fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(this.markdownPath), { recursive: true });
    fs.writeFileSync(this.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(this.markdownPath, renderMarkdown(report));
  }
}

module.exports = PlaywrightTimingReporter;
module.exports.buildTimingReport = buildTimingReport;
module.exports.durationText = durationText;
module.exports.renderMarkdown = renderMarkdown;
