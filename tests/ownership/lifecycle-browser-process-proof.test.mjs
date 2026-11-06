import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { browserProcessOwnershipProof } from '../../scripts/ownership/lifecycle-browser-process-proof.mjs';

const CLI = 'scripts/ci/lib/browser-container-security.mjs';
const WRAPPER = 'scripts/ci/run-sandboxed-playwright.mjs';
const ADAPTER = 'scripts/ci/lib/browser-container-ownership.mjs';
const sources = new Map([CLI, WRAPPER].map(relativePath => [relativePath, readFileSync(relativePath, 'utf8')]));
const adapterSource = readFileSync(ADAPTER, 'utf8');
const proof = (relativePath, source = sources.get(relativePath), adapter = adapterSource) => browserProcessOwnershipProof({ relativePath, source, adapterSource: adapter });

for (const relativePath of sources.keys()) {
  test(`${relativePath} has structurally supervised process ownership`, () => {
    assert.equal(proof(relativePath).proven, true);
    assert.match(proof(relativePath).reason, /not crash registration/);
  });
}

const mutations = [
  [CLI, "child.kill('SIGKILL');", "child.kill('SIGTERM');"],
  [CLI, "child.kill('SIGKILL');", "if (false) { child.kill('SIGKILL'); }"],
  [WRAPPER, "signalProcessGroup(child, 'SIGTERM');", "if (false) { signalProcessGroup(child, 'SIGTERM'); }"],
  [CLI, "child.kill('SIGTERM');", "otherChild.kill('SIGTERM');"],
  [CLI, "child.once('close', code =>", "child.once('exit', code =>"],
  [CLI, "signal?.addEventListener('abort', abort, { once: true });", ''],
  [CLI, "signal?.addEventListener('abort', abort, { once: true });", "if (false) { signal?.addEventListener('abort', abort, { once: true }); }"],
  [CLI, "signal?.addEventListener('abort', abort, { once: true });", "if (false) signal?.addEventListener('abort', abort, { once: true });"],
  [CLI, "signal?.addEventListener('abort', abort, { once: true });", "false && signal?.addEventListener('abort', abort, { once: true });"],
  [CLI, "const timeout = setTimeout(() => stop(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`)), timeoutMs);", "if (false) { const timeout = setTimeout(() => stop(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`)), timeoutMs); }"],
  [CLI, "child.once('error', stop);", "child.once('error', reject);"],
  [CLI, 'if (failure) return current;', 'if (failure) return current + value;'],
  [CLI, '        return current;', '        return current + value;'],
  [CLI, 'clearTimeout(closeDeadline);', ''],
  [CLI, "child.kill('SIGTERM');", `void "child.kill('SIGTERM');";`],
  [WRAPPER, 'process.kill(-child.pid, signalName)', 'process.kill(child.pid, signalName)'],
  [WRAPPER, "detached: true", 'detached: false'],
  [WRAPPER, "signalProcessGroup(child, 'SIGKILL');", "signalProcessGroup(child, 'SIGTERM');"],
  [WRAPPER, "signal?.addEventListener('abort', abort, { once: true });", ''],
  [WRAPPER, "const timeout = setTimeout(() => cancel(new Error('test command exceeded the 45 minute deadline')), 45 * 60_000);", "if (false) { const timeout = setTimeout(() => cancel(new Error('test command exceeded the 45 minute deadline')), 45 * 60_000); }"],
  [ADAPTER, "await waitBounded(context.attachPromise, 5_000, 'attached browser server')", 'await Promise.resolve()'],
  [ADAPTER, 'return await Promise.race([', 'return promise;'],
  [ADAPTER, 'context.attachPromise.cancel?.();', 'Promise.resolve();'],
  [ADAPTER, 'if (ownershipVerified) {', 'if (true) {'],
  [WRAPPER, "child.once('close', (code, childSignal) =>", "child.once('exit', (code, childSignal) =>"],
];
for (const [relativePath, before, after] of mutations) {
  test(`rejects ${relativePath}: ${before}`, () => {
    if (relativePath === ADAPTER) {
      assert.ok(adapterSource.includes(before), 'mutation must alter real adapter source');
      assert.equal(proof(WRAPPER, sources.get(WRAPPER), adapterSource.replace(before, after)).proven, false);
      return;
    }
    assert.ok(sources.get(relativePath).includes(before), 'mutation must alter real source');
    assert.equal(proof(relativePath, sources.get(relativePath).replace(before, after)).proven, false);
  });
}

test('known pathname, comments, and quoted source are insufficient', () => {
  assert.equal(proof(CLI, `// ${sources.get(CLI).replaceAll('\n', '\n// ')}\n`).proven, false);
  assert.equal(proof(CLI, `const quoted = ${JSON.stringify(sources.get(CLI))};`).proven, false);
  assert.equal(proof('scripts/unreviewed.mjs', sources.get(CLI)).proven, false);
  assert.equal(proof(CLI, sources.get(CLI) + '\nspawn("unowned");').proven, false);
});


test('proof runs after checkout in an isolated directory without node_modules', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-proof-dependency-free-'));
  try {
    writeFileSync(path.join(root, 'proof.mjs'), readFileSync('scripts/ownership/lifecycle-browser-process-proof.mjs'));
  writeFileSync(path.join(root, 'sources.json'), JSON.stringify({ sources: [...sources], adapterSource }));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { browserProcessOwnershipProof } from './proof.mjs';
      const fixture = JSON.parse(readFileSync('./sources.json', 'utf8'));
      for (const [relativePath, source] of fixture.sources) {
        assert.equal(browserProcessOwnershipProof({ relativePath, source, adapterSource: fixture.adapterSource }).proven, true);
      }
    `], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(run.status, 0, run.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('literal and comment substitutions cannot impersonate executable cleanup', () => {
  const call = "signal?.addEventListener('abort', abort, { once: true });";
  for (const replacement of [JSON.stringify(call) + ';', `/* ${call} */`, '`' + call + '`;']) {
    assert.equal(proof(CLI, sources.get(CLI).replace(call, replacement)).proven, false);
  }
  assert.equal(proof(CLI, sources.get(CLI) + "\nconst escapedOwner = `${spawn('unowned')}`;").proven, false);
  assert.equal(proof(CLI, sources.get(CLI) + '}').proven, false);
});

test('wrapper proof fails closed when adapter source is missing or bypasses attachment cleanup', () => {
  assert.equal(browserProcessOwnershipProof({ relativePath: WRAPPER, source: sources.get(WRAPPER) }).proven, false);
  assert.equal(proof(WRAPPER, sources.get(WRAPPER), adapterSource.replace(
    'context.attachPromise.cancel?.();', 'Promise.resolve();',
  )).proven, false);
  assert.equal(proof(WRAPPER, sources.get(WRAPPER), adapterSource.replace(
    'if (ownershipVerified) {', 'if (true) {',
  )).proven, false);
});
