import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { reinspectBeforeMutation, runCleanupActions } from '../../scripts/ownership/cleanup-action-runner.mjs';
import { validateCheckpointPayload } from '../../scripts/ownership/cleanup-journal-protocol.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function ownership(resourceClass, immutableIdentity) {
  return {
    project: 'fixture', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass, lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-31T00:00:00.000Z', createdByRelease: 'unreleased',
    createdByCommit: 'f'.repeat(40), creationRunId: 'create-1', immutableIdentity,
  };
}

function action(sequence, resourceClass, mutation, identity = A, overrides = {}) {
  return {
    sequence, resourceClass, immutableIdentity: identity, action: mutation,
    locatorKind: 'engine_id', locator: identity,
    ownershipDigest: canonicalSha256(ownership(resourceClass, identity)), observationDigest: C,
    dependencyIdentities: [],
    ...overrides,
  };
}

function row(candidate, observationDigest = candidate.observationDigest) {
  const authority = ownership(candidate.resourceClass, candidate.immutableIdentity);
  return {
    resourceClass: candidate.resourceClass, immutableIdentity: candidate.immutableIdentity,
    locatorKind: candidate.locatorKind, locator: candidate.locator,
    ownership: authority, ownershipDigest: canonicalSha256(authority), observationDigest,
    disposition: 'eligible', failureClasses: [], active: false, protected: false, data: false,
    running: candidate.resourceClass === 'compose_container' ? true : null,
    references: [], contentDigests: [], dependencyIdentities: [],
  };
}

function reconciliation(candidate, state = 'absent', failureClass = 'none') {
  return {
    state, resourceClass: candidate.resourceClass, immutableIdentity: candidate.immutableIdentity,
    postconditionDigest: ['absent', 'satisfied'].includes(state) ? A : null,
    failureClass,
  };
}

function checkpointRecorder(events) {
  let sequence = 0;
  return async (record) => {
    validateCheckpointPayload(record.checkpointType, record.payload);
    events.push(`checkpoint:${record.checkpointType}:${record.payload.actionSequence}`);
    sequence += 1;
    return { checkpointDigest: canonicalSha256({ sequence, record }), signed: true, synced: true };
  };
}

test('serial execution permits only explicit immediate container stop to remove derivation', async () => {
  const actions = [action(1, 'compose_container', 'stop'), action(2, 'compose_container', 'remove')];
  const events = [];
  let stopResultDigest = null;
  const result = await runCleanupActions({
    actions,
    appendCheckpoint: async (record) => {
      const ack = await checkpointRecorder(events)(record);
      if (record.checkpointType === 'result' && record.payload.actionSequence === 1) stopResultDigest = ack.checkpointDigest;
      return ack;
    },
    reloadAuthority: async ({ action: candidate, phase, predecessorResultDigest }) => {
      events.push(`reload:${candidate.sequence}:${phase}`);
      if (candidate.sequence === 1) return { state: 'eligible', row: row(candidate), derivedFromResultDigest: null };
      const dependencyDigest = canonicalSha256([{
        sequence: 1, resourceClass: 'compose_container', immutableIdentity: A,
        action: 'stop', resultCheckpointDigest: stopResultDigest,
      }]);
      assert.equal(predecessorResultDigest, dependencyDigest);
      return { state: 'eligible', row: row(candidate, 'd'.repeat(64)), derivedFromResultDigest: dependencyDigest };
    },
    mutate: async ({ action: candidate }) => { events.push(`mutate:${candidate.sequence}`); return { outcome: 'success', raw: 'secret' }; },
    reconcile: async ({ action: candidate }) => { events.push(`reconcile:${candidate.sequence}`); return reconciliation(candidate, 'satisfied'); },
  });
  assert.equal(result.terminalState, 'completed');
  assert.equal(result.processedActionCount, 2);
  assert.deepEqual(result.results.map((entry) => entry.result), ['cleaned', 'cleaned']);
  assert.doesNotMatch(JSON.stringify(result), /secret|raw/);
  // The runner reloads once per mutated action; the fenced reinspection belongs to mutate.
  assert.equal(events.filter((event) => event.endsWith(':pre_mutation_reinspection')).length, 0);
  for (const candidate of actions) {
    const prefix = [
      `reload:${candidate.sequence}:fresh_eligibility`, `checkpoint:intent:${candidate.sequence}`,
      `mutate:${candidate.sequence}`,
      `reconcile:${candidate.sequence}`, `checkpoint:result:${candidate.sequence}`,
    ];
    let cursor = -1;
    for (const event of prefix) { cursor = events.indexOf(event, cursor + 1); assert.notEqual(cursor, -1, event); }
  }
});

test('missing predecessor digest refuses derived state before a second mutation', async () => {
  const actions = [action(1, 'compose_container', 'stop'), action(2, 'compose_container', 'remove')];
  const mutations = [];
  const events = [];
  const result = await runCleanupActions({
    actions, appendCheckpoint: checkpointRecorder(events),
    reloadAuthority: async ({ action: candidate }) => ({
      state: 'eligible', row: row(candidate, candidate.sequence === 1 ? C : 'd'.repeat(64)),
      derivedFromResultDigest: null,
    }),
    mutate: async ({ action: candidate }) => { mutations.push(candidate.sequence); return { outcome: 'success' }; },
    reconcile: async ({ action: candidate }) => reconciliation(candidate, 'satisfied'),
  });
  assert.deepEqual(mutations, [1]);
  assert.equal(result.results[1].result, 'refused');
  assert.equal(result.results[1].failureClass, 'identity_changed');
});

test('dependency actions derive authority from every signed successful container result', async () => {
  const actions = [
    action(1, 'compose_container', 'stop'),
    action(2, 'compose_container', 'remove'),
    action(3, 'compose_network', 'remove', A, { dependencyIdentities: [A] }),
  ];
  const predecessorDigests = [];
  const mutatedWith = [];
  const result = await runCleanupActions({
    actions, appendCheckpoint: checkpointRecorder([]),
    reloadAuthority: async ({ action: candidate, predecessorResultDigest }) => {
      predecessorDigests.push([candidate.sequence, predecessorResultDigest]);
      return {
        state: 'eligible', row: row(candidate, candidate.sequence === 1 ? C : 'd'.repeat(64)),
        derivedFromResultDigest: predecessorResultDigest,
      };
    },
    mutate: async ({ action: candidate, predecessorResultDigest }) => {
      mutatedWith.push([candidate.sequence, predecessorResultDigest]);
      return { outcome: 'success' };
    },
    reconcile: async ({ action: candidate }) => reconciliation(candidate, 'satisfied'),
  });
  assert.equal(result.terminalState, 'completed');
  assert.deepEqual(result.results.map((entry) => entry.result), ['cleaned', 'cleaned', 'cleaned']);
  const reloadedDependency = predecessorDigests.filter(([sequence]) => sequence === 3);
  assert.equal(reloadedDependency.length, 1);
  assert.match(reloadedDependency[0][1], /^[a-f0-9]{64}$/);
  // mutate's fenced reinspection is bound to the same derived predecessor.
  assert.deepEqual(mutatedWith.find(([sequence]) => sequence === 3), reloadedDependency[0]);
});

test('stable proven absence is intent-bound and journaled without mutation', async () => {
  const events = [];
  let mutations = 0;
  let reconciliations = 0;
  const candidate = action(1, 'compose_network', 'remove');
  const result = await runCleanupActions({
    actions: [candidate], appendCheckpoint: checkpointRecorder(events),
    reloadAuthority: async () => ({
      state: 'absent', postconditionDigest: C, derivedFromResultDigest: null,
    }),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async () => { reconciliations += 1; return reconciliation(candidate); },
  });
  assert.equal(result.terminalState, 'completed');
  assert.equal(result.processedActionCount, 1);
  assert.equal(result.results[0].result, 'absent');
  assert.equal(result.results[0].failureClass, 'none');
  assert.equal(result.results[0].reconciliationState, 'absent');
  assert.equal(result.results[0].postconditionDigest, C);
  assert.deepEqual(events.map((entry) => entry.split(':').slice(0, 2).join(':')),
    ['checkpoint:intent', 'checkpoint:result']);
  assert.equal(mutations, 0);
  assert.equal(reconciliations, 0);
});

test('unstable absence proof fails closed before mutation', async () => {
  const candidate = action(1, 'compose_network', 'remove');
  let reloads = 0;
  let mutations = 0;
  const result = await runCleanupActions({
    actions: [candidate], appendCheckpoint: checkpointRecorder([]),
    reloadAuthority: async () => {
      reloads += 1;
      return reloads === 1
        ? { state: 'absent', postconditionDigest: C, derivedFromResultDigest: null }
        : { state: 'eligible', row: row(candidate), derivedFromResultDigest: null };
    },
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async () => reconciliation(candidate),
  });
  assert.equal(result.results[0].result, 'refused');
  assert.equal(result.results[0].failureClass, 'identity_changed');
  assert.equal(mutations, 0);
});

test('refusal and second-inspection drift stop all later actions', async () => {
  for (const mode of ['refused', 'drift']) {
    const actions = [action(1, 'compose_network', 'remove'), action(2, 'oci_image', 'remove', `sha256:${A}`)];
    let reloads = 0;
    let mutations = 0;
    const result = await runCleanupActions({
      actions, appendCheckpoint: checkpointRecorder([]),
      reloadAuthority: async ({ action: candidate }) => {
        reloads += 1;
        if (mode === 'refused') return { state: 'refused', failureClass: 'current' };
        return { state: 'eligible', row: { ...row(candidate), marker: reloads }, derivedFromResultDigest: null };
      },
      mutate: async () => { mutations += 1; return { outcome: 'success' }; },
      reconcile: async ({ action: candidate }) => reconciliation(candidate),
    });
    assert.equal(mutations, 0);
    assert.equal(result.processedActionCount, 1);
    assert.ok(['refused', 'ambiguous'].includes(result.results[0].result));
  }
});

test('clean mutation failures and cancellation stop even if postcondition is satisfied', async () => {
  for (const outcome of ['command_failed', 'command_unavailable', 'permission_denied', 'spawn_failed', 'cancelled', 'quiescence_failed']) {
    const actions = [action(1, 'compose_network', 'remove'), action(2, 'compose_network', 'remove', 'e'.repeat(64))];
    let mutations = 0;
    const result = await runCleanupActions({
      actions, appendCheckpoint: checkpointRecorder([]),
      reloadAuthority: async ({ action: candidate }) => ({ state: 'eligible', row: row(candidate), derivedFromResultDigest: null }),
      mutate: async () => { mutations += 1; return { outcome }; },
      reconcile: async ({ action: candidate }) => reconciliation(candidate),
    });
    assert.equal(mutations, 1);
    assert.equal(result.processedActionCount, 1);
    assert.equal(result.results[0].result, outcome === 'quiescence_failed' ? 'ambiguous' : 'failed');
  }
});

test('timeout, output loss, or unknown outcome advances only after exact reconciliation and never retries', async () => {
  for (const outcome of ['timeout', 'output_limit', 'unknown']) {
    for (const reconciled of [true, false]) {
      const actions = [action(1, 'compose_network', 'remove'), action(2, 'compose_network', 'remove', 'e'.repeat(64))];
      const mutationCounts = new Map();
      const result = await runCleanupActions({
        actions, appendCheckpoint: checkpointRecorder([]),
        reloadAuthority: async ({ action: candidate }) => ({ state: 'eligible', row: row(candidate), derivedFromResultDigest: null }),
        mutate: async ({ action: candidate }) => {
          mutationCounts.set(candidate.sequence, (mutationCounts.get(candidate.sequence) ?? 0) + 1);
          return candidate.sequence === 1 ? { outcome } : { outcome: 'success' };
        },
        reconcile: async ({ action: candidate }) => candidate.sequence === 1 && !reconciled
          ? reconciliation(candidate, 'ambiguous', 'query_failed') : reconciliation(candidate),
      });
      assert.equal(mutationCounts.get(1), 1);
      assert.equal(result.processedActionCount, reconciled ? 2 : 1);
      assert.equal(mutationCounts.get(2) ?? 0, reconciled ? 1 : 0);
    }
  }
});

test('an unsynced intent or caught callback error cannot mutate or leak raw output', async () => {
  let mutations = 0;
  const result = await runCleanupActions({
    actions: [action(1, 'compose_network', 'remove'), action(2, 'compose_network', 'remove', 'e'.repeat(64))],
    reloadAuthority: async ({ action: candidate }) => ({ state: 'eligible', row: row(candidate), derivedFromResultDigest: null }),
    appendCheckpoint: async () => ({ checkpointDigest: A, signed: true, synced: false, raw: 'journal-secret' }),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async () => { throw new Error('reconcile-secret'); },
  });
  assert.equal(mutations, 0);
  assert.equal(result.results[0].result, 'ambiguous');
  assert.doesNotMatch(JSON.stringify(result), /secret|raw/);
});

test('cancellation after the durable intent stops before mutation', async () => {
  const controller = new AbortController();
  let mutations = 0;
  const events = [];
  const record = checkpointRecorder(events);
  const result = await runCleanupActions({
    actions: [action(1, 'compose_network', 'remove')], signal: controller.signal,
    appendCheckpoint: async (checkpoint) => {
      const ack = await record(checkpoint);
      if (checkpoint.checkpointType === 'intent') controller.abort();
      return ack;
    },
    reloadAuthority: async ({ action: candidate }) => (
      { state: 'eligible', row: row(candidate), derivedFromResultDigest: null }
    ),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async ({ action: candidate }) => reconciliation(candidate),
  });
  assert.equal(mutations, 0);
  assert.equal(result.results[0].result, 'failed');
  assert.equal(result.results[0].failureClass, 'cancelled');
  assert.deepEqual(events.map((entry) => entry.split(':')[1]), ['intent', 'result']);
});

test('action bounds leave journal capacity and missing trailing checkpoints block finalization', async () => {
  await assert.rejects(runCleanupActions({
    actions: Array.from({ length: 3_001 }, (_, index) => action(index + 1, 'compose_network', 'remove')),
    reloadAuthority: async () => {}, appendCheckpoint: async () => {}, mutate: async () => {},
    reconcile: async () => {},
  }), /bounded array/);

  const actions = [
    action(1, 'compose_network', 'remove'),
    action(2, 'compose_network', 'remove', 'e'.repeat(64)),
    action(3, 'compose_network', 'remove', 'f'.repeat(64)),
  ];
  const recorded = [];
  const result = await runCleanupActions({
    actions,
    reloadAuthority: async () => ({ state: 'refused', failureClass: 'current' }),
    appendCheckpoint: async (checkpoint) => {
      recorded.push(checkpoint.payload.actionSequence);
      if (checkpoint.payload.actionSequence === 2) throw new Error('simulated journal outage');
      return { checkpointDigest: canonicalSha256(checkpoint), signed: true, synced: true };
    },
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action: candidate }) => reconciliation(candidate),
  });
  assert.equal(result.processedActionCount, 1);
  assert.equal(result.journalComplete, false);
  assert.deepEqual(recorded, [1, 2]);
  assert.equal(result.results.length, 2);
});

test('an approved no-op action list is immediately journal-complete', async () => {
  const result = await runCleanupActions({
    actions: [],
    reloadAuthority: async () => { throw new Error('not called'); },
    appendCheckpoint: async () => { throw new Error('not called'); },
    mutate: async () => { throw new Error('not called'); },
    reconcile: async () => { throw new Error('not called'); },
  });
  assert.equal(result.journalComplete, true);
  assert.equal(result.terminalState, 'completed');
  assert.deepEqual(result.results, []);
});

// R5-B phase 2a (tasks/ci-install-lane-speedup-design-2026-09-29.md): the only
// authorizing reinspection is the runtime's fenced one inside mutate. The
// runner no longer repeats it unfenced for eligible actions.
test('eligible actions are reinspected once, by the fenced mutate, not again by the runner', async () => {
  const actions = [action(1, 'compose_container', 'stop')];
  const phases = [];
  const result = await runCleanupActions({
    actions, appendCheckpoint: checkpointRecorder([]),
    reloadAuthority: async ({ action: candidate, phase }) => {
      phases.push(phase);
      return { state: 'eligible', row: row(candidate), derivedFromResultDigest: null };
    },
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action: candidate }) => reconciliation(candidate, 'satisfied'),
  });
  assert.deepEqual(phases, ['fresh_eligibility']);
  assert.equal(result.results[0].result, 'cleaned');
});

// Each fenced reinspection outcome must be journalled exactly as the former
// unfenced second-phase reinspection recorded the same authority response.
for (const [label, response, expected] of [
  ['refused', { state: 'refused', failureClass: 'shared' }, { result: 'refused', failureClass: 'shared' }],
  ['ambiguous', { state: 'ambiguous', failureClass: 'query_failed' }, { result: 'ambiguous', failureClass: 'query_failed' }],
  ['absent', 'absent', { result: 'ambiguous', failureClass: 'identity_changed' }],
  ['an eligible row with a changed observation', 'changed', { result: 'refused', failureClass: 'identity_changed' }],
  ['a valid eligible row with a different digest', 'drifted', { result: 'ambiguous', failureClass: 'identity_changed' }],
  ['malformed', { state: 'eligible' }, { result: 'ambiguous', failureClass: 'query_failed' }],
]) {
  test(`a fenced reinspection that is ${label} is journalled like the former second phase`, async () => {
    const candidate = action(1, 'compose_container', 'stop');
    const records = [];
    let mutations = 0;
    const fresh = response === 'absent'
      ? { state: 'absent', postconditionDigest: A, derivedFromResultDigest: null }
      : response === 'changed'
        ? { state: 'eligible', row: row(candidate, 'e'.repeat(64)), derivedFromResultDigest: null }
        : response === 'drifted'
          ? { state: 'eligible', row: { ...row(candidate), running: false }, derivedFromResultDigest: null }
          : response;
    const result = await runCleanupActions({
      actions: [candidate],
      appendCheckpoint: async (record) => {
        records.push(record);
        return checkpointRecorder([])(record);
      },
      reloadAuthority: async ({ action: current, phase }) => (phase === 'fresh_eligibility'
        ? { state: 'eligible', row: row(current), derivedFromResultDigest: null }
        : fresh),
      mutate: async ({ action: current, predecessorResultDigest, authorityRowDigest, signal }) => {
        const refusal = await reinspectBeforeMutation(async (request) => (request.phase === 'pre_mutation_reinspection'
          ? fresh : null), { action: current, predecessorResultDigest, authorityRowDigest, signal });
        if (refusal) return refusal;
        mutations += 1;
        return { outcome: 'success' };
      },
      reconcile: async ({ action: current }) => reconciliation(current, 'satisfied'),
    });
    assert.equal(mutations, 0);
    assert.equal(result.results[0].result, expected.result);
    assert.equal(result.results[0].failureClass, expected.failureClass);
    const resultRecord = records.find((record) => record.checkpointType === 'result');
    const intentIndex = records.findIndex((record) => record.checkpointType === 'intent');
    assert.notEqual(intentIndex, -1);
    // Exactly the payload the former unfenced second-phase branch recorded.
    assert.deepEqual(resultRecord.payload, {
      actionSequence: 1, resourceClass: candidate.resourceClass,
      immutableIdentity: candidate.immutableIdentity,
      result: expected.result, failureClass: expected.failureClass,
      mutationOutcome: 'not_started', reconciliationState: 'not_started',
      intentCheckpointDigest: canonicalSha256({ sequence: intentIndex + 1, record: records[intentIndex] }),
      postconditionDigest: null,
    });
  });
}

test('reinspectBeforeMutation authorizes only the normalized approved row', async () => {
  const candidate = action(1, 'compose_container', 'stop');
  const approved = row(candidate);
  const approvedDigest = canonicalSha256(approved);
  const eligible = async () => ({ state: 'eligible', row: approved, derivedFromResultDigest: null });
  assert.equal(await reinspectBeforeMutation(eligible, {
    action: candidate, predecessorResultDigest: null, authorityRowDigest: approvedDigest,
  }), null);
  assert.deepEqual(await reinspectBeforeMutation(eligible, {
    action: candidate, predecessorResultDigest: null, authorityRowDigest: 'b'.repeat(64),
  }), { outcome: 'not_started', reinspection: { state: 'eligible', failureClass: null } });
  const active = async () => ({ state: 'eligible', row: { ...approved, active: true }, derivedFromResultDigest: null });
  assert.deepEqual(await reinspectBeforeMutation(active, {
    action: candidate, predecessorResultDigest: null, authorityRowDigest: canonicalSha256({ ...approved, active: true }),
  }), { outcome: 'not_started', reinspection: { state: 'refused', failureClass: 'identity_changed' } });
  const thrown = async () => { throw new Error('daemon unavailable'); };
  assert.deepEqual(await reinspectBeforeMutation(thrown, {
    action: candidate, predecessorResultDigest: null, authorityRowDigest: approvedDigest,
  }), { outcome: 'not_started', reinspection: { state: 'ambiguous', failureClass: 'query_failed' } });
});

// A malformed reinspection value is not trusted as "nothing happened": like a
// bare not_started without a valid refusal class, it is treated as an unknown
// outcome and reconciled, so the journal records what was actually observed.
for (const [label, value] of [
  ['null', { outcome: 'not_started', reinspection: null }],
  ['unknown state', { outcome: 'not_started', reinspection: { state: 'vanished', failureClass: 'shared' } }],
  ['non-object', { outcome: 'not_started', reinspection: 'refused' }],
]) {
  test(`a malformed reinspection (${label}) is reconciled as an unknown mutation outcome`, async () => {
    const candidate = action(1, 'compose_container', 'stop');
    const reconciled = [];
    const result = await runCleanupActions({
      actions: [candidate], appendCheckpoint: checkpointRecorder([]),
      reloadAuthority: async ({ action: current }) => ({ state: 'eligible', row: row(current), derivedFromResultDigest: null }),
      mutate: async () => value,
      reconcile: async ({ action: current, mutationOutcome }) => {
        reconciled.push(mutationOutcome);
        return reconciliation(current, 'satisfied');
      },
    });
    assert.deepEqual(reconciled, ['unknown']);
    assert.equal(result.results[0].mutationOutcome, 'unknown');
  });
}

test('cancellation during an absent target stability reload mutates nothing and stops the next action', async () => {
  const controller = new AbortController();
  const actions = [action(1, 'compose_network', 'remove'), action(2, 'compose_network', 'remove', B)];
  const phases = [];
  let mutations = 0;
  const result = await runCleanupActions({
    actions, signal: controller.signal, appendCheckpoint: checkpointRecorder([]),
    reloadAuthority: async ({ action: candidate, phase }) => {
      phases.push(`${candidate.sequence}:${phase}`);
      if (candidate.sequence === 1) {
        if (phase === 'pre_mutation_reinspection') controller.abort();
        return { state: 'absent', postconditionDigest: A, derivedFromResultDigest: null };
      }
      return { state: 'eligible', row: row(candidate), derivedFromResultDigest: null };
    },
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async ({ action: candidate }) => reconciliation(candidate),
  });
  assert.equal(mutations, 0);
  assert.deepEqual(phases, ['1:fresh_eligibility', '1:pre_mutation_reinspection']);
  assert.deepEqual(result.results.map((entry) => [entry.result, entry.failureClass]), [
    ['absent', 'none'], ['failed', 'cancelled'],
  ]);
});
