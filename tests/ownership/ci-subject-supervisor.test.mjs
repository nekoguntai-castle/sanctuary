import assert from 'node:assert/strict';
import test from 'node:test';
import { runSubject } from '../../scripts/ownership/ci-subject-supervisor.mjs';

test('zero remaining budget refuses even an invalid executable without spawning', async () => {
  assert.equal(await runSubject('no-such-deadline-subject', [], {}, {
    graceMs: 25, killWaitMs: 1000, remainingMs: 0,
  }), 124);
});

test('subject-only deadline preserves timeout status when TERM handler exits zero', async () => {
  const status = await runSubject(process.execPath, ['-e', 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)'], {}, {
    graceMs: 100, killWaitMs: 1000, remainingMs: 500,
  });
  assert.equal(status, 124);
});

test('subject deadline kills TERM-resistant process group', async () => {
  const status = await runSubject(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {}, {
    graceMs: 25, killWaitMs: 1000, remainingMs: 500,
  });
  assert.equal(status, 124);
});

test('ordinary subject exit remains unchanged and clears deadline timer', async () => {
  assert.equal(await runSubject(process.execPath, ['-e', 'process.exit(7)'], {}, {
    graceMs: 25, killWaitMs: 1000, remainingMs: 5000,
  }), 7);
});
