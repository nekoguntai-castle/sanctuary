#!/usr/bin/env node
// Summarize the opt-in cleanup engine trace written by
// scripts/ownership/cleanup-command.mjs (SANCTUARY_CLEANUP_ENGINE_TRACE_FILE).
// R5-B phase 1 of tasks/ci-install-lane-speedup-design-2026-09-29.md: attribute
// cleanup wall time to the operations that spawn the container engine.
//
// Usage: node scripts/ci/summarize-cleanup-engine-trace.mjs TRACE_FILE
// Prints a Markdown table and never fails the calling step.
import { existsSync, readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main-module.mjs';

const seconds = (ms) => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;

export function summarizeCleanupEngineTrace(file) {
  if (!existsSync(file)) {
    return { invocations: 0, totalMs: 0, skippedLines: 0, rows: [], markdown: 'No cleanup engine trace was written.\n' };
  }
  const groups = new Map();
  let invocations = 0;
  let totalMs = 0;
  let skippedLines = 0;
  for (const text of readFileSync(file, 'utf8').split('\n')) {
    if (text.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      skippedLines += 1;
      continue;
    }
    const operation = String(record.operation ?? 'unknown');
    const command = Array.isArray(record.command) ? record.command.join(' ') : '';
    const durationMs = Number.isFinite(record.durationMs) ? record.durationMs : 0;
    const key = `${operation}\u0000${command}`;
    const row = groups.get(key) ?? { operation, command, count: 0, totalMs: 0, failures: 0 };
    row.count += 1;
    row.totalMs += durationMs;
    if (record.outcome !== 'success') row.failures += 1;
    groups.set(key, row);
    invocations += 1;
    totalMs += durationMs;
  }
  const rows = [...groups.values()].sort((left, right) => right.totalMs - left.totalMs
    || left.operation.localeCompare(right.operation));
  if (invocations === 0) {
    return { invocations, totalMs, skippedLines, rows, markdown: 'No cleanup engine trace was written.\n' };
  }
  const lines = [
    '### Cleanup engine invocations',
    '',
    `${invocations} engine invocations, ${seconds(totalMs)} summed (concurrent calls overlap).`,
    '',
    '| Operation | Command | Count | Summed | Failures |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.operation} | \`${row.command}\` | ${row.count} | ${seconds(row.totalMs)} | ${row.failures} |`),
  ];
  if (skippedLines > 0) lines.push('', `${skippedLines} unparseable trace line(s) skipped.`);
  return { invocations, totalMs, skippedLines, rows, markdown: `${lines.join('\n')}\n` };
}

if (isMainModule(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: summarize-cleanup-engine-trace.mjs TRACE_FILE\n');
    process.exit(0);
  }
  process.stdout.write(summarizeCleanupEngineTrace(file).markdown);
}
