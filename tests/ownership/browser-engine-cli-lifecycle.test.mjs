import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const moduleUrl = process.env.BROWSER_CLI_TEST_MODULE
  ? pathToFileURL(process.env.BROWSER_CLI_TEST_MODULE)
  : new URL('../../scripts/ci/lib/browser-container-security.mjs', import.meta.url);
const { runBrowserEngineCli } = await import(moduleUrl);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'browser-cli-lifecycle-'));
  const oldPath = process.env.PATH;
  const pidFile = path.join(root, 'pid');
  await writeFile(path.join(root, 'docker'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM', () => {});\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nif (process.argv.includes('output')) { process.stdout.write('ok'); process.stderr.write('diagnostic'); process.exit(0); }\nif (process.argv.includes('overflow')) process.stdout.write('x'.repeat(4096));\nif (process.argv.includes('unicode')) process.stdout.write('é'.repeat(100));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  process.env.PATH = `${root}:${oldPath}`;
  let pid;
  const waitReady = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { pid = Number(await readFile(pidFile, 'utf8')); return pid; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(10);
    }
    throw new Error('fixture child never started');
  };
  try { await run(waitReady, pidFile); }
  finally {
    if (!pid) { try { pid = Number(await readFile(pidFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
}

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'promise must not settle while its CLI child is alive');
}

for (const cause of ['abort', 'abort-zero', 'overflow', 'unicode', 'timeout']) {
  test(`CLI ${cause} escalates a TERM-resistant child and waits for close`, async () => fixture(async waitReady => {
    const controller = new AbortController();
    const pending = runBrowserEngineCli('/unused-test-socket', [cause], {
      signal: controller.signal, maxBuffer: 128, timeoutMs: cause === 'timeout' ? 1_000 : 10_000,
    }).then(() => ({ success: true }), error => ({ error }));
    const pid = await waitReady();
    if (cause === 'abort') controller.abort(new Error('fixture cancellation'));
    if (cause === 'abort-zero') controller.abort(0);
    let deadline;
    const result = await Promise.race([pending, new Promise(resolve => { deadline = setTimeout(() => resolve({ deadline: true }), 4500); })]);
    clearTimeout(deadline);
    assert.equal(result.deadline, undefined, 'cancellation must not wait for the unrelated command timeout');
    assertGone(pid);
    assert.match(result.error?.message ?? '', cause.startsWith('abort') ? /cancel/ : ['overflow', 'unicode'].includes(cause) ? /output exceeded/ : /timed out/);
  }));
}

test('CLI preserves successful stdout and stderr', async () => fixture(async () => {
  assert.deepEqual(await runBrowserEngineCli('/unused-test-socket', ['output']), { stdout: 'ok', stderr: 'diagnostic' });
}));

test('pre-aborted CLI rejects without executing the command', async () => fixture(async (_waitReady, pidFile) => {
  const controller = new AbortController(); controller.abort(new Error('already cancelled'));
  await assert.rejects(runBrowserEngineCli('/unused-test-socket', ['abort'], { signal: controller.signal }), /already cancelled|operation was aborted/);
  await assert.rejects(readFile(pidFile), { code: 'ENOENT' });
}));
