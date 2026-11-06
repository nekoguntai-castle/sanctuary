import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  browserContainerOwnershipLabels,
  recoverBrowserContainerId,
  retireBrowserContainer,
} from '../../scripts/ci/lib/browser-container-ownership.mjs';

const ownership = {
  project: 'sanctuary-run-1', deploymentId: 'deployment-1', ownerId: 'owner-1',
  operationRunId: 'run-1', createdAt: '2026-11-04T12:00:00.000Z',
  createdByRelease: 'unreleased', createdByCommit: 'a'.repeat(40),
  lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
};
const id = 'b'.repeat(64);

function browserInspect({ runnerId = 'run-1', ownershipLabels = browserContainerOwnershipLabels(ownership) } = {}) {
  return {
    Id: id, Name: '/sanctuary-browser-run-1',
    Config: { Labels: { ...ownershipLabels,
      'com.example.sanctuary.sandboxed-playwright': 'v1',
      'com.example.sanctuary.run-id': runnerId } },
  };
}

function retirementContext(overrides = {}) {
  return {
    ownership, containerId: id, name: 'sanctuary-browser-run-1', runId: 'run-1', socket: '/run/docker.sock',
    profilePath: '/profile.json', outerId: 'outer', image: { id: 'image-id' },
    reportDirectory: '/unused', ...overrides,
  };
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected promise to reject');
}

test('does not retry destructive removal when identity recheck fails and attach is unresolved', async () => {
  const inspect = browserInspect({ runnerId: 'foreign-run' });
  const commands = [];
  const context = retirementContext({ attachPromise: Promise.reject(new Error('attach unresolved')) });
  const failure = await retireBrowserContainer(context, {
    api: async () => inspect,
    command: async (_socket, args) => { commands.push(args); return ''; },
    assertBrowserChild: () => {},
  });
  assert.ok(failure instanceof AggregateError);
  assert.match(failure.errors.map(error => error.message).join(' '), /ownership could not be reverified/);
  assert.deepEqual(commands, []);
});

test('retires the exact owned ID but returns policy failure when child security changed', async () => {
  const reportDirectory = await mkdtemp(path.join(os.tmpdir(), 'browser-retirement-policy-'));
  try {
    const commands = [];
    let inspections = 0;
    const failure = await retireBrowserContainer(retirementContext({ reportDirectory }), {
      api: async () => {
        inspections++;
        if (inspections === 1) return browserInspect();
        throw new Error('engine API GET returned 404');
      },
      command: async (_socket, args) => { commands.push(args); return ''; },
      assertBrowserChild: () => { throw new Error('seccomp changed'); },
    });
    assert.match(failure.message, /policy changed before retirement.*seccomp changed/);
    assert.ok(commands.some(args => args[0] === 'stop' && args.at(-1) === id));
    assert.ok(commands.some(args => args[0] === 'rm' && args[1] === '--force' && args[2] === id));
    assert.equal(inspections, 2);
  } finally {
    await rm(reportDirectory, { recursive: true, force: true });
  }
});

test('treats an already-absent exact ID as clean when the attach process is closed', async () => {
  const commands = [];
  const failure = await retireBrowserContainer(retirementContext({ attachPromise: Promise.resolve(0) }), {
    api: async () => { throw new Error('engine API GET returned 404'); },
    command: async (_socket, args) => { commands.push(args); return ''; },
    assertBrowserChild: () => {},
  });
  assert.equal(failure, undefined);
  assert.deepEqual(commands, []);
});

test('recovery rejects mismatched run labels and aggregates non-404 lookup errors', async () => {
  const cause = new Error('create response lost');
  const context = retirementContext();
  const mismatch = await rejection(recoverBrowserContainerId(context, async () => browserInspect({ runnerId: 'foreign-run' }), cause));
  assert.ok(mismatch instanceof AggregateError);
  assert.match(mismatch.message, /exact-name recovery lookup failed/);
  assert.match(mismatch.errors.map(error => error.message).join(' '), /mismatched run labels/);
  const notFound = await rejection(recoverBrowserContainerId(context, async () => { throw new Error('engine API GET returned 404'); }, cause));
  assert.equal(notFound, cause);
  const unavailable = await rejection(recoverBrowserContainerId(context, async () => { throw new Error('engine API GET returned 503'); }, cause));
  assert.ok(unavailable instanceof AggregateError);
  assert.match(unavailable.message, /exact-name recovery lookup failed/);
  assert.equal(unavailable.errors[0], cause);
});
