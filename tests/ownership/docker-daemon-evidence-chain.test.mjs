import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDockerDaemonContext } from '../../scripts/ownership/cleanup-execution-context.mjs';
import {
  createDaemonEvidenceChain,
  observeDockerResources,
} from '../../scripts/ownership/docker-observation.mjs';

// R5-B phase 2b (tasks/ci-install-lane-speedup-design-2026-09-29.md): within
// one runtime, an observation may reuse the immediately preceding matching
// after-check as its before-check. Every observation still ends with its own
// after-check, so a daemon swapped between observations fails closed.

function fakeEngine() {
  const state = { versionCalls: 0, infoCalls: 0, rootDir: '/var/lib/docker' };
  const runCommand = (_engine, args) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    const joined = effective.join(' ');
    if (joined === 'context show') return 'default\n';
    if (joined.startsWith('context inspect default --format')) return JSON.stringify({
      Name: 'default',
      Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    if (joined.startsWith('version --format')) {
      state.versionCalls += 1;
      return JSON.stringify({ Server: { Version: '29.0.0' } });
    }
    if (joined.startsWith('info --format')) {
      state.infoCalls += 1;
      return JSON.stringify({ DockerRootDir: state.rootDir });
    }
    throw new Error(`unexpected command: ${joined}`);
  };
  return { state, runCommand };
}

function checks(state) {
  assert.equal(state.versionCalls, state.infoCalls);
  return state.versionCalls;
}

test('without a chain every pinned observation brackets the daemon before and after', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const baseline = checks(state);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(observeDockerResources({ runCommand, daemonAuthority: authority }).complete, true);
  }
  assert.equal(checks(state) - baseline, 6);
});

test('a chained observation reuses the preceding matching after-check as its before-check', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  const baseline = checks(state);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(observeDockerResources({
      runCommand, daemonAuthority: authority, daemonEvidenceChain: chain,
    }).complete, true);
  }
  // 2 for the first observation, then only the after-check for each later one.
  assert.equal(checks(state) - baseline, 4);
});

test('a daemon swapped between chained observations is caught by the after-check', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  assert.equal(observeDockerResources({
    runCommand, daemonAuthority: authority, daemonEvidenceChain: chain,
  }).complete, true);
  state.rootDir = '/var/lib/other-daemon';
  const swapped = observeDockerResources({
    runCommand, daemonAuthority: authority, daemonEvidenceChain: chain,
  });
  assert.equal(swapped.complete, false);
  assert.equal(swapped.ambiguities[0].category, 'inventory_drift');
  // The swapped observation consumed the record and its failed after-check
  // did not re-arm it: the next observation re-proves the daemon first and
  // refuses the changed identity.
  const baseline = checks(state);
  const next = observeDockerResources({
    runCommand, daemonAuthority: authority, daemonEvidenceChain: chain,
  });
  assert.equal(next.complete, false);
  assert.equal(next.ambiguities[0].category, 'identity_changed');
  assert.equal(checks(state) - baseline, 1);
});

test('a stale chained after-check is not reused', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  let clock = 0;
  const chain = createDaemonEvidenceChain({ maxAgeMs: 2000, now: () => clock, wallNow: () => clock });
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  clock += 2001;
  const baseline = checks(state);
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(checks(state) - baseline, 2);
});

test('a chained after-check is single use and bound to the pinned daemon fingerprint', () => {
  const chain = createDaemonEvidenceChain({ now: () => 0, wallNow: () => 0 });
  chain.record('a'.repeat(64), chain.stamp());
  assert.equal(chain.claim('b'.repeat(64)), false);
  assert.equal(chain.claim('a'.repeat(64)), false, 'a mismatched claim consumes the entry');
  chain.record('a'.repeat(64), chain.stamp());
  assert.equal(chain.claim('a'.repeat(64)), true);
  assert.equal(chain.claim('a'.repeat(64)), false);
});

test('an unpinned observation never records for a later pinned one', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  assert.equal(observeDockerResources({ runCommand, daemonEvidenceChain: chain }).complete, true);
  const baseline = checks(state);
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(checks(state) - baseline, 2, 'the pinned observation must bracket fully');
});

test('an observation with any ambiguity does not record, even when the daemon matched', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  const failing = (engine, args, options) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    if (effective[0] === 'network') throw new Error('listing failed');
    return runCommand(engine, args, options);
  };
  const selectors = { compose_network: [{ locator: 'a'.repeat(64) }] };
  const ambiguous = observeDockerResources({
    runCommand: failing, daemonAuthority: authority, daemonEvidenceChain: chain, selectors,
  });
  assert.equal(ambiguous.complete, false);
  const baseline = checks(state);
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(checks(state) - baseline, 2);
});

test('an after-check that fails leaves the chain unarmed', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  let failNextInfo = true;
  const flaky = (engine, args, options) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    if (effective[0] === 'info' && failNextInfo) { failNextInfo = false; throw new Error('daemon busy'); }
    return runCommand(engine, args, options);
  };
  // Claims the record, then its own after-check fails.
  const unproven = observeDockerResources({ runCommand: flaky, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(unproven.complete, false);
  // The failed info call never reached the counting engine, so count versions.
  const baseline = state.versionCalls;
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(state.versionCalls - baseline, 2);
});

test('a listing that throws after a claim leaves the chain empty', () => {
  const { state, runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  const chain = createDaemonEvidenceChain();
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  const throwing = (engine, args, options) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    if (effective[0] === 'network') throw new Error('listing failed');
    return runCommand(engine, args, options);
  };
  observeDockerResources({
    runCommand: throwing, daemonAuthority: authority, daemonEvidenceChain: chain,
    selectors: { compose_network: [{ locator: 'a'.repeat(64) }] },
  });
  const baseline = checks(state);
  observeDockerResources({ runCommand, daemonAuthority: authority, daemonEvidenceChain: chain });
  assert.equal(checks(state) - baseline, 2);
});

test('a record is fresh only on both the monotonic and the wall clock', () => {
  let monotonic = 0;
  let wall = 1_000_000;
  const chain = createDaemonEvidenceChain({ maxAgeMs: 2000, now: () => monotonic, wallNow: () => wall });
  chain.record('a'.repeat(64), { monotonic: 0, wall: 1_000_000 });
  // A host suspend: the monotonic clock stood still while wall time moved on.
  wall += 60_000;
  assert.equal(chain.claim('a'.repeat(64)), false);
  chain.record('a'.repeat(64), { monotonic: 0, wall });
  monotonic += 2001;
  assert.equal(chain.claim('a'.repeat(64)), false);
  chain.record('a'.repeat(64), { monotonic, wall });
  assert.equal(chain.claim('a'.repeat(64)), true);
});

test('a record is stamped before its after-check queries, not after', () => {
  const { runCommand } = fakeEngine();
  const authority = resolveDockerDaemonContext({ runCommand });
  let clock = 0;
  const chain = createDaemonEvidenceChain({ maxAgeMs: 2000, now: () => clock, wallNow: () => clock });
  const slowAfterCheck = (engine, args, options) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    if (effective[0] === 'info') clock += 1500;
    return runCommand(engine, args, options);
  };
  observeDockerResources({ runCommand: slowAfterCheck, daemonAuthority: authority, daemonEvidenceChain: chain });
  // The after-check started at 1500 and took 1500 ms; at 3600 the record is
  // 2100 ms old, measured from when that check began.
  clock = 3600;
  assert.equal(chain.claim(authority.daemonFingerprint), false);
});

test('the chain rejects an invalid maximum age', () => {
  for (const maxAgeMs of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createDaemonEvidenceChain({ maxAgeMs }), TypeError);
  }
});

test('the cleanup CLI forwards the pinned authority and the evidence chain to inventory loads', async () => {
  const { dockerInventoryOptions } = await import('../../scripts/ownership/cleanup-cli.mjs');
  const chain = createDaemonEvidenceChain();
  const authority = { daemonFingerprint: 'a'.repeat(64) };
  const options = dockerInventoryOptions(
    { timeoutMs: 5000, maxOutputBytes: 1024, dataVolumeNames: ['data'] },
    { daemonAuthority: authority, daemonEvidenceChain: chain },
    'docker',
  );
  assert.equal(options.daemonAuthority, authority);
  assert.equal(options.daemonEvidenceChain, chain);
  assert.equal(options.engine, 'docker');
  assert.deepEqual(options.commandOptions, { timeoutMs: 5000, maxOutputBytes: 1024 });
  const unpinned = dockerInventoryOptions({}, {}, 'podman');
  assert.equal(unpinned.daemonAuthority, undefined);
  assert.equal(unpinned.daemonEvidenceChain, undefined);
});
