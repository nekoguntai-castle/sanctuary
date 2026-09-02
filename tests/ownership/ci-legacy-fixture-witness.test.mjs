import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLegacyFixtureWitness, registerLegacyFixtureResources,
} from '../../scripts/ownership/ci-legacy-fixture-witness.mjs';
import { readRegistrations } from '../../scripts/ownership/registration.mjs';

const CONTAINER = 'a'.repeat(64);
const NETWORK = 'b'.repeat(64);
const PROJECT = 'ci-42-1-upgrade';

function dockerFixture({ populated = false } = {}) {
  const present = { container: populated, network: populated, volume: populated };
  const mutations = [];
  const control = { host: 'unix:///run/docker-fixture.sock', secondHost: null,
    contextInspections: 0, networkDependencies: '', volumeDependencies: '' };
  const compose = { 'com.docker.compose.project': PROJECT };
  const records = {
    container: { Id: CONTAINER, Config: { Labels: { ...compose, 'com.docker.compose.service': 'backend' } }, State: { Running: true } },
    network: { Id: NETWORK, Labels: { ...compose, 'com.docker.compose.network': 'default' } },
    volume: { Name: `${PROJECT}_postgres_data`, Driver: 'local', Scope: 'local',
      Mountpoint: `/var/lib/docker/volumes/${PROJECT}_postgres_data/_data`,
      CreatedAt: '2026-08-31T00:00:00Z', Options: null,
      Labels: { ...compose, 'com.docker.compose.volume': 'postgres_data' } },
  };
  const stripAuthority = (args) => args[0] === '--host' ? args.slice(2) : args;
  const contextResult = (joined) => {
    if (joined === 'context show') return 'default\n';
    if (joined.startsWith('context inspect default --format')) {
      control.contextInspections += 1;
      return JSON.stringify({
        Name: 'default', Endpoints: { docker: {
          Host: control.contextInspections > 1 && control.secondHost ? control.secondHost : control.host,
          SkipTLSVerify: false,
        } }, TLSMaterial: {},
      });
    }
    if (joined.startsWith('version --format') || joined.startsWith('info --format')) return '{"authority":"fixture"}\n';
    return null;
  };
  const listResult = (joined) => {
    if (joined.startsWith('container ls') && joined.includes('network=')) return control.networkDependencies;
    if (joined.startsWith('container ls') && joined.includes('volume=')) return control.volumeDependencies;
    if (joined.startsWith('container ls') && joined.includes(`label=com.docker.compose.project=${PROJECT}`)) {
      return present.container ? `${CONTAINER}\n` : '';
    }
    if (joined.startsWith('network ls')) return present.network ? `${NETWORK}\n` : '';
    if (joined.startsWith('volume ls')) return present.volume ? `${PROJECT}_postgres_data\n` : '';
    return null;
  };
  const inspectResult = (joined) => {
    if (joined === `container inspect ${CONTAINER}`) {
      if (!present.container) throw Object.assign(new Error('No such container'), { resourceAbsent: true });
      return JSON.stringify([records.container]);
    }
    if (joined === `network inspect ${NETWORK}`) {
      if (!present.network) throw Object.assign(new Error('No such network'), { resourceAbsent: true });
      return JSON.stringify([records.network]);
    }
    if (joined === `volume inspect ${PROJECT}_postgres_data`) {
      if (!present.volume) throw Object.assign(new Error('No such volume'), { resourceAbsent: true });
      return JSON.stringify([records.volume]);
    }
    return null;
  };
  const mutationResult = (joined) => {
    if (joined === `container stop ${CONTAINER}`) { mutations.push(joined); records.container.State.Running = false; return CONTAINER; }
    if (joined === `container rm ${CONTAINER}`) { mutations.push(joined); present.container = false; return CONTAINER; }
    if (joined === `network rm ${NETWORK}`) { mutations.push(joined); present.network = false; return NETWORK; }
    if (joined === `volume rm ${PROJECT}_postgres_data`) { mutations.push(joined); present.volume = false; return records.volume.Name; }
    return null;
  };
  const run = (_engine, rawArgs) => {
    const joined = stripAuthority(rawArgs).join(' ');
    for (const handler of [contextResult, listResult, inspectResult, mutationResult]) {
      const result = handler(joined);
      if (result !== null) return result;
    }
    throw new Error(`unexpected Docker command: ${joined}`);
  };
  return { run, present, mutations, control };
}

function coordinatorState(witnessDigest) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'legacy-fixture-witness-'));
  const checkoutRoot = path.join(root, 'checkout');
  const runtimeDirectory = path.join(root, 'runtime');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  return {
    authority: {
      composeProjectName: PROJECT, runtimeDirectory, checkoutRoot,
      deploymentId: 'ci-42-1-upgrade-deploy', ownerId: 'ci-42-1-upgrade-owner',
      operationRunId: 'ci-42-1-upgrade-cleanup', checkoutCommit: 'c'.repeat(40),
    },
    resourceCreatedAt: '2026-08-31T00:00:00.000Z',
    legacyFixtureWitnessDigest: witnessDigest,
  };
}

test('legacy fixture witness refuses any preexisting exact-project resource', () => {
  const empty = dockerFixture();
  assert.match(createLegacyFixtureWitness({ composeProjectName: PROJECT, run: empty.run }).digest, /^[a-f0-9]{64}$/);
  const populated = dockerFixture({ populated: true });
  assert.throws(() => createLegacyFixtureWitness({ composeProjectName: PROJECT, run: populated.run }), /requires an empty exact Compose project/);
});

test('legacy fixture witness refuses daemon drift between its two empty snapshots', () => {
  const docker = dockerFixture();
  docker.control.secondHost = 'unix:///run/replaced-docker.sock';
  assert.throws(() => createLegacyFixtureWitness({
    composeProjectName: PROJECT, run: docker.run,
  }), /changed between complete snapshots/);
});

test('terminal witness registers exact observed identities without mutating Docker', () => {
  const docker = dockerFixture();
  const witness = createLegacyFixtureWitness({ composeProjectName: PROJECT, run: docker.run });
  docker.present.container = true;
  docker.present.network = true;
  docker.present.volume = true;
  docker.control.networkDependencies = `${CONTAINER}\n`;
  docker.control.volumeDependencies = `${CONTAINER}\n`;
  const state = coordinatorState(witness.digest);
  const result = registerLegacyFixtureResources({ state, run: docker.run });
  assert.deepEqual(docker.mutations, []);
  assert.equal(result.registrations.length, 3);
  assert.deepEqual(docker.present, { container: true, network: true, volume: true });
  const registrations = readRegistrations(path.join(state.authority.runtimeDirectory, 'ownership'));
  assert.equal(registrations.length, 3);
  assert.ok(registrations.every((entry) => entry.metadataDigest === witness.digest
    && entry.cleanupPolicy === 'exact_delete'));
});

test('terminal witness refuses daemon drift before registration or mutation', () => {
  const docker = dockerFixture();
  const witness = createLegacyFixtureWitness({ composeProjectName: PROJECT, run: docker.run });
  docker.present.container = true;
  docker.control.host = 'unix:///run/different-docker.sock';
  assert.throws(() => registerLegacyFixtureResources({
    state: coordinatorState(witness.digest), run: docker.run,
  }), /Docker authority changed/);
  assert.deepEqual(docker.mutations, []);
});

test('terminal witness preflights every dependency before registration or mutation', () => {
  const docker = dockerFixture();
  const witness = createLegacyFixtureWitness({ composeProjectName: PROJECT, run: docker.run });
  docker.present.container = true;
  docker.present.network = true;
  docker.present.volume = true;
  docker.control.networkDependencies = `${'d'.repeat(64)}\n`;
  const state = coordinatorState(witness.digest);
  assert.throws(() => registerLegacyFixtureResources({
    state, run: docker.run,
  }), /foreign live dependencies/);
  assert.deepEqual(docker.mutations, []);
  assert.equal(existsSync(path.join(state.authority.runtimeDirectory, 'ownership', 'registrations')), false);
  assert.equal(docker.present.network, true);
  assert.equal(docker.present.volume, true);
});

test('registration failure remains mutation-free after complete preflight', () => {
  const docker = dockerFixture();
  const witness = createLegacyFixtureWitness({ composeProjectName: PROJECT, run: docker.run });
  docker.present.container = true;
  docker.present.network = true;
  let calls = 0;
  assert.throws(() => registerLegacyFixtureResources({
    state: coordinatorState(witness.digest), run: docker.run,
    register: () => {
      calls += 1;
      if (calls === 2) throw new Error('registration write failed');
      return { registrationId: '1'.repeat(64) };
    },
  }), /registration write failed/);
  assert.equal(calls, 2);
  assert.deepEqual(docker.mutations, []);
});
