import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeCleanupEngineTrace } from '../../scripts/ci/summarize-cleanup-engine-trace.mjs';

function traceFile(t, lines) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-trace-summary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'trace.jsonl');
  writeFileSync(file, lines.join('\n'));
  return file;
}

const line = (operation, command, durationMs, outcome = 'success') => JSON.stringify({
  executable: 'docker', operation, command, outcome, durationMs,
});

test('aggregates invocations by operation and subcommand, heaviest first', (t) => {
  const file = traceFile(t, [
    line('compose_volume list', ['volume', 'ls'], 400),
    line('compose_volume list', ['volume', 'ls'], 600),
    line('docker daemon ping', ['version'], 50),
    line('compose_container remove', ['container', 'rm'], 3000, 'timeout'),
    'not json',
    '',
  ]);
  const summary = summarizeCleanupEngineTrace(file);
  assert.equal(summary.invocations, 4);
  assert.equal(summary.totalMs, 4050);
  assert.equal(summary.skippedLines, 1);
  assert.deepEqual(summary.rows.map((row) => [row.operation, row.command, row.count, row.totalMs, row.failures]), [
    ['compose_container remove', 'container rm', 1, 3000, 1],
    ['compose_volume list', 'volume ls', 2, 1000, 0],
    ['docker daemon ping', 'version', 1, 50, 0],
  ]);
  assert.match(summary.markdown, /\| compose_volume list \| `volume ls` \| 2 \| 1\.0 s \|/);
  assert.match(summary.markdown, /4 engine invocations, 4\.1 s summed/);
});

test('reports an absent or empty trace without failing', (t) => {
  const missing = summarizeCleanupEngineTrace(path.join(os.tmpdir(), 'no-such-cleanup-trace.jsonl'));
  assert.equal(missing.invocations, 0);
  assert.match(missing.markdown, /No cleanup engine trace/);
  const empty = summarizeCleanupEngineTrace(traceFile(t, []));
  assert.equal(empty.invocations, 0);
});
