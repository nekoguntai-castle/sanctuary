import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { provesBrowserContainerLifecycle } from '../../scripts/ownership/lifecycle-browser-container-proof.mjs';

const read = relative => readFileSync(path.resolve(relative), 'utf8');
const sources = () => ({
  wrapper: read('scripts/ci/run-sandboxed-playwright.mjs'),
  adapter: read('scripts/ci/lib/browser-container-ownership.mjs'),
  coordinator: read('scripts/ownership/ci-cleanup-coordinator.mjs'),
  workflow: read('.github/workflows/test.yml'),
});

test('proves canonical exact-identity browser sibling lifecycle and Docker recovery wiring', () => {
  assert.deepEqual(provesBrowserContainerLifecycle(sources()), {
    proven: true,
    reason: 'coordinated exact-identity browser container lifecycle is source-proven',
  });
});

test('rejects missing coordinator authority, create labels, or registration', () => {
  const original = sources();
  assert.equal(provesBrowserContainerLifecycle({ ...original, wrapper: original.wrapper.replaceAll('ownershipLoader = loadBrowserContainerOwnership', 'ownershipLoader = loadMissing') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, wrapper: original.wrapper.replaceAll('browserContainerOwnershipLabels(', 'missingLabels(') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replaceAll('register(context.ownership, context.containerId)', 'skipRegistration()') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replace("createdByCommit: 'io.sanctuary.created-by-commit'", "createdByCommit: 'missing-label'") }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replace('[OWNERSHIP_LABELS.ownerId]: ownership.ownerId', '[OWNERSHIP_LABELS.ownerId]: ownership.project') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replace("if (env.SANCTUARY_CLEANUP_ENGINE !== 'docker') {", 'if (false) {') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, wrapper: original.wrapper.replace('if (ownership.engineEndpoint !== `unix://${socket}`) {', 'if (false) {') }).proven, false);
});

test('rejects unsafe recovery, incomplete retirement, engine drift, and host inventory lanes', () => {
  const original = sources();
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replaceAll('assertBrowserContainerOwnership(recovered, context.ownership, { name: context.name })', 'recovered.Id') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replaceAll("['rm', '--force', context.containerId]", "['destroy', '--all']") }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, coordinator: original.coordinator.replace('request.engine', '"host"') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, workflow: original.workflow.replace('--engine docker', '--engine host') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, workflow: original.workflow.replace('--engine docker --lane render-regression-e2e', '--engine host --lane render-regression-e2e') }).proven, false);
  const callsReversed = original.wrapper.replace(
    'await createOwnedBrowserContainer(context, api, command, signal, registerContainer);\n    await startBrowserServer(context, attach, signal);',
    'await startBrowserServer(context, attach, signal);\n    await createOwnedBrowserContainer(context, api, command, signal, registerContainer);'
  );
  assert.equal(provesBrowserContainerLifecycle({ ...original, wrapper: callsReversed }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replace('if (ownershipVerified) {', 'if (true) {') }).proven, false);
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: original.adapter.replaceAll("['rm', '--force', context.containerId]", "['rm', '--force', context.name]") }).proven, false);
  const retirementMutations = [
    ['failure = await retireVerifiedContainer(context, { api, command }, failure);', 'failure = failure;'],
    ['failure = await stopBrowserContainer(context, command, failure);', 'failure = failure;'],
    ['failure = await stopBrowserContainer(context, command, failure);', 'stopBrowserContainer;'],
    ['failure = await stopBrowserContainer(context, command, failure);', 'if (false) { failure = await stopBrowserContainer(context, command, failure); }'],
    ['failure = await stopBrowserContainer(context, command, failure);', 'const unused = () => { failure = await stopBrowserContainer(context, command, failure); };'],
    ['return confirmBrowserContainerAbsent(context, api, failure);', 'return failure;'],
    ['return confirmBrowserContainerAbsent(context, api, failure);', 'void confirmBrowserContainerAbsent; return failure;'],
    ['return new Error(`browser container remained present after exact-ID removal${detail}`);', 'return failure;'],
  ];
  for (const [before, after] of retirementMutations) {
    assert.ok(original.adapter.includes(before), `fixture must contain ${before}`);
    assert.equal(provesBrowserContainerLifecycle({
      ...original, adapter: original.adapter.replace(before, after),
    }).proven, false, before);
  }
});

test('comments cannot satisfy missing lifecycle guarantees', () => {
  const original = sources();
  const broken = original.adapter.replaceAll("['rm', '--force', context.containerId]", "['delete', '--all']");
  assert.equal(provesBrowserContainerLifecycle({ ...original, adapter: `${broken}\nconst inert = "command(context.socket, ['rm', '--force', context.containerId]);"` }).proven, false);
});
