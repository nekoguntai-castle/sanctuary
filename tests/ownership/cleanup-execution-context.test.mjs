import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCleanupExecutionContext, buildHostCleanupExecutionContext, observeDockerDaemonContext,
  dockerDaemonDriftOperation, observeResolvedDockerDaemonEvidence, resolveDockerDaemonContext,
} from '../../scripts/ownership/cleanup-execution-context.mjs';

const HASH = 'a'.repeat(64);

test('daemon authority hashes canonical Docker and Podman contexts without exposing output', () => {
  const calls = [];
  const runCommand = (engine, args) => {
    calls.push([engine, ...args]);
    if (args.join(' ') === 'context show') return 'default\n';
    if (args.join(' ') === 'system connection list --format json') {
      return JSON.stringify([{ Name: 'fixture', Default: true, URI: 'unix:///run/private.sock' }]);
    }
    if (args[0] === 'context' && args[1] === 'inspect') return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/private.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    return JSON.stringify({ engine, args, privateHost: '/var/run/private.sock' });
  };
  const docker = observeDockerDaemonContext({ engine: 'docker', runCommand });
  const podman = observeDockerDaemonContext({ engine: 'podman', runCommand });
  assert.match(docker, /^[a-f0-9]{64}$/);
  assert.match(podman, /^[a-f0-9]{64}$/);
  assert.notEqual(docker, podman);
  assert.doesNotMatch(`${docker}${podman}`, /private|sock/);
  assert.ok(calls.some((call) => call.join(' ').includes('docker context inspect default')));
  assert.ok(calls.some((call) => call.join(' ').includes('podman system connection list')));
  assert.ok(calls.some((call) => call.join(' ').includes('docker --host unix:///run/private.sock version')));
  assert.ok(calls.some((call) => call.join(' ').includes('podman --url unix:///run/private.sock version')));
});

test('daemon authority ignores runtime counters and clock while retaining endpoint drift', () => {
  let daemonId = 'runner-request-one';
  let systemTime = '2026-08-31T00:00:00Z';
  let containers = 1;
  let openFileDescriptors = 20;
  let runtimeStatus = [['Data Space Used', '1GB']];
  let warnings = ['runtime pressure'];
  let dockerRootDir = '/var/lib/docker';
  let swarmClusterId = 'swarm-cluster-one';
  let host = 'unix:///run/docker.sock';
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (effectiveArgs[0] === 'version') return JSON.stringify({ Server: { Version: '29.0.0' } });
    if (effectiveArgs[0] === 'info') return JSON.stringify({
      ID: daemonId, DockerRootDir: dockerRootDir,
      Swarm: { Cluster: { ID: swarmClusterId } },
      SystemTime: systemTime, Containers: containers,
      ContainersRunning: containers, Images: 4, DriverStatus: [['Data Space Used', '1GB']],
      NFd: openFileDescriptors, NGoroutines: openFileDescriptors + 1,
      SystemStatus: runtimeStatus, Warnings: warnings,
    });
    return JSON.stringify({ Name: 'default', Endpoints: { docker: { Host: host, SkipTLSVerify: false } }, TLSMaterial: {} });
  };
  const first = observeDockerDaemonContext({ runCommand });
  daemonId = 'runner-request-two';
  systemTime = '2026-08-31T00:00:10Z';
  containers = 2;
  openFileDescriptors = 40;
  runtimeStatus = [['Data Space Used', '2GB']];
  warnings = ['different runtime pressure'];
  assert.equal(observeDockerDaemonContext({ runCommand }), first);
  swarmClusterId = 'swarm-cluster-two';
  assert.notEqual(observeDockerDaemonContext({ runCommand }), first);
  swarmClusterId = 'swarm-cluster-one';
  dockerRootDir = '/srv/docker';
  assert.notEqual(observeDockerDaemonContext({ runCommand }), first);
  dockerRootDir = '/var/lib/docker';
  host = 'unix:///run/other.sock';
  assert.notEqual(observeDockerDaemonContext({ runCommand }), first);
});

test('daemon authority canonicalizes unordered metadata arrays without losing members', () => {
  let plugins = ['bridge', 'host'];
  let firewallInfo = [['Driver', 'iptables']];
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (effectiveArgs[0] === 'version') return JSON.stringify({
      Server: { Components: plugins.map((name) => ({ Name: name, Version: '1' })) },
    });
    if (effectiveArgs[0] === 'info') return JSON.stringify({
      ID: 'daemon-1', Plugins: { Network: plugins }, FirewallBackend: { Info: firewallInfo },
    });
    return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
  };
  const first = observeDockerDaemonContext({ runCommand });
  plugins = [...plugins].reverse();
  assert.equal(observeDockerDaemonContext({ runCommand }), first);
  plugins = ['bridge', 'overlay'];
  assert.notEqual(observeDockerDaemonContext({ runCommand }), first);
  plugins = ['bridge', 'host'];
  firewallInfo = [['iptables', 'Driver']];
  assert.notEqual(observeDockerDaemonContext({ runCommand }), first);
});

test('Podman top-level ID remains authoritative', () => {
  let daemonId = 'podman-daemon-one';
  const runCommand = (_engine, args) => {
    const effectiveArgs = args[0] === '--url' ? args.slice(2) : args;
    if (effectiveArgs.join(' ') === 'system connection list --format json') {
      return JSON.stringify([{ Name: 'fixture', Default: true, URI: 'unix:///run/podman.sock' }]);
    }
    if (effectiveArgs[0] === 'version') return JSON.stringify({ Server: { Version: '5.0.0' } });
    return JSON.stringify({ ID: daemonId, graphRoot: '/var/lib/containers' });
  };
  const first = observeDockerDaemonContext({ engine: 'podman', runCommand });
  daemonId = 'podman-daemon-two';
  assert.notEqual(observeDockerDaemonContext({ engine: 'podman', runCommand }), first);
});

test('Podman omits only exact native runtime telemetry paths', () => {
  const info = {
    ID: 'podman-daemon',
    host: { memTotal: 64, swapTotal: 32, memFree: 12, swapFree: 8, uptime: '1h',
      cpuUtilization: { userPercent: 7.84, systemPercent: 1.96, idlePercent: 90.2 } },
    store: { graphRoot: '/var/lib/containers', graphRootAllocated: 931,
      graphRootUsed: 50, containerStore: { number: 4, paused: 1, running: 2, stopped: 1 },
      imageStore: { number: 9 } },
    stable: { option: 'one' },
  };
  let current = structuredClone(info);
  let currentVersion = '5.4.2';
  let connectionName = 'fixture';
  let connectionUri = 'unix:///run/podman.sock';
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'system connection list --format json') return JSON.stringify([
      { Name: connectionName, Default: true, URI: connectionUri },
    ]);
    const effective = args[0] === '--url' ? args.slice(2) : args;
    if (effective[0] === 'version') return JSON.stringify({ Version: currentVersion });
    if (effective[0] === 'info') return JSON.stringify(current);
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const first = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
    engineGlobalArgs: ['--url', connectionUri] });
  for (const field of ['uptime', 'warnings', 'containers']) {
    current = { ...structuredClone(info), config: { nested: { [field]: 1 } } };
    const firstInteger = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
      engineGlobalArgs: ['--url', connectionUri] });
    current.config.nested[field] = 2;
    const changedInteger = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
      engineGlobalArgs: ['--url', connectionUri] });
    assert.notEqual(changedInteger.fingerprint, firstInteger.fingerprint, `config.nested.${field}`);
    current.config.nested[field] = 0.25;
    assert.throws(() => observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
      engineGlobalArgs: ['--url', connectionUri] }), /safe integer/, `config.nested.${field}`);
  }
  current = structuredClone(info);
  current.host.memFree = 2;
  current.host.swapFree = 3;
  current.host.uptime = '2h';
  current.host.cpuUtilization = { userPercent: 21.23, systemPercent: 4.56, idlePercent: 74.21 };
  current.store.graphRootUsed = 60;
  current.store.containerStore = { number: 5, paused: 0, running: 3, stopped: 2 };
  current.store.imageStore.number = 10;
  const telemetry = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
    engineGlobalArgs: ['--url', connectionUri] });
  assert.equal(telemetry.fingerprint, first.fingerprint);
  assert.deepEqual(telemetry.fields, first.fields);
  for (const [path, mutate] of [
    ['ID', (value) => { value.ID += '-changed'; }],
    ['host.memTotal', (value) => { value.host.memTotal += 1; }],
    ['host.swapTotal', (value) => { value.host.swapTotal += 1; }],
    ['store.graphRootAllocated', (value) => { value.store.graphRootAllocated += 1; }],
    ['store.graphRoot', (value) => { value.store.graphRoot += '/changed'; }],
    ['stable.option', (value) => { value.stable.option = 'two'; }],
    ['host.cpuUtilizationExtra', (value) => { value.host.cpuUtilizationExtra = 1; }],
    ['host.cpuUtilization.userPercent', (value) => { value.host['cpuUtilization.userPercent'] = 1; }],
    ['host.memFree', (value) => { value['host.memFree'] = 1; }],
    ['store.containerStore.number', (value) => { value.store['containerStore.number'] = 1; }],
  ]) {
    current = structuredClone(info);
    mutate(current);
    const changed = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
      engineGlobalArgs: ['--url', connectionUri] });
    assert.notEqual(changed.fingerprint, first.fingerprint, path);
    if (path === 'host.memFree') assert.notEqual(changed.fields['info.host.memFree'], first.fields['info.host.memFree'], path);
    else if (path === 'ID') assert.notEqual(changed.fields['info.ID'], first.fields['info.ID'], path);
    else if (path.startsWith('host.')) assert.notEqual(changed.fields['info.host'], first.fields['info.host'], path);
    if (path.startsWith('store.')) assert.notEqual(changed.fields['info.store'], first.fields['info.store'], path);
    if (path.startsWith('stable.')) assert.notEqual(changed.fields['info.stable'], first.fields['info.stable'], path);
  }
  current = structuredClone(info);
  currentVersion = '5.4.3';
  const versionChanged = observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
    engineGlobalArgs: ['--url', connectionUri] });
  assert.notEqual(versionChanged.fingerprint, first.fingerprint);
  assert.notEqual(versionChanged.fields['version.Version'], first.fields['version.Version']);
  currentVersion = '5.4.2';
  connectionName = 'fixture-renamed';
  assert.notEqual(resolveDockerDaemonContext({ engine: 'podman', runCommand }).fingerprint,
    resolveDockerDaemonContext({ engine: 'podman', runCommand: (_engine, args) => {
      if (args.join(' ') === 'system connection list --format json') return JSON.stringify([
        { Name: 'fixture', Default: true, URI: connectionUri },
      ]);
      const effective = args[0] === '--url' ? args.slice(2) : args;
      return effective[0] === 'version' ? JSON.stringify({ Version: '5.4.2' }) : JSON.stringify(info);
    } }).fingerprint);
  connectionName = 'fixture';
  connectionUri = 'unix:///run/other-podman.sock';
  assert.notEqual(resolveDockerDaemonContext({ engine: 'podman', runCommand }).fingerprint,
    resolveDockerDaemonContext({ engine: 'podman', runCommand: (_engine, args) => {
      if (args.join(' ') === 'system connection list --format json') return JSON.stringify([
        { Name: 'fixture', Default: true, URI: 'unix:///run/podman.sock' },
      ]);
      const effective = args[0] === '--url' ? args.slice(2) : args;
      return effective[0] === 'version' ? JSON.stringify({ Version: '5.4.2' }) : JSON.stringify(info);
    } }).fingerprint);
  connectionUri = 'unix:///run/podman.sock';
  current.extraFraction = 0.25;
  assert.throws(() => observeResolvedDockerDaemonEvidence({ engine: 'podman', runCommand,
    engineGlobalArgs: ['--url', connectionUri] }), /safe integer/);
});

test('daemon evidence identifies changed configuration fields without retaining values', () => {
  let daemonRoot = '/private/daemon-one';
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (effectiveArgs[0] === 'version') return JSON.stringify({ Server: { Version: '29.0.0' } });
    if (effectiveArgs[0] === 'info') return JSON.stringify({ DockerRootDir: daemonRoot, Containers: 1 });
    return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
  };
  const authority = resolveDockerDaemonContext({ runCommand });
  daemonRoot = '/private/daemon-two';
  const current = observeResolvedDockerDaemonEvidence({
    runCommand, engineGlobalArgs: authority.engineGlobalArgs,
  });
  assert.notEqual(current.fields['info.DockerRootDir'], authority.daemonEvidence.fields['info.DockerRootDir']);
  assert.doesNotMatch(JSON.stringify(authority.daemonEvidence), /private\/daemon/);
});

test('daemon evidence bounds hostile keys and selects fields deterministically', () => {
  const hostileKey = `private-token\n${'x'.repeat(2_000)}`;
  const names = [...Array.from({ length: 140 }, (_, index) => `Field${String(index).padStart(3, '0')}`), 'ä'];
  const evidence = (orderedNames, hostileValue) => observeResolvedDockerDaemonEvidence({
    engineGlobalArgs: ['--host', 'unix:///run/docker.sock'],
    runCommand(_engine, args) {
      const effectiveArgs = args.slice(2);
      if (effectiveArgs[0] === 'version') return JSON.stringify({ Server: { Version: '29.0.0' } });
      return JSON.stringify(Object.fromEntries([
        ...orderedNames.map((name) => [name, name]), [hostileKey, hostileValue],
      ]));
    },
  });
  const first = evidence(names, 'one');
  const reordered = evidence([...names].reverse(), 'one');
  assert.deepEqual(first.fields, reordered.fields);
  const hostileFirst = evidence([], 'one');
  const hostileChanged = evidence([], 'two');
  const operation = dockerDaemonDriftOperation({ daemonEvidence: hostileFirst }, hostileChanged);
  assert.match(operation, /info\.\[sha256:[a-f0-9]{64}\]/);
  assert.doesNotMatch(operation, /private-token|\n|x{20}/);
  assert.ok(operation.length < 700);
});

test('remote and TLS-bearing named authorities fail closed instead of losing connection identity', () => {
  const authority = (record) => (_engine, args) => {
    if (args.join(' ') === 'context show') return 'remote\n';
    if (args[0] === 'context') return JSON.stringify(record);
    throw new Error('daemon query must not run for unsupported context');
  };
  assert.throws(() => observeDockerDaemonContext({ runCommand: authority({
    Endpoints: { docker: { Host: 'ssh://operator@example.test/run/docker.sock' } }, TLSMaterial: {},
  }) }), /unsupported/);
  assert.throws(() => observeDockerDaemonContext({ runCommand: authority({
    Endpoints: { docker: { Host: 'tcp://127.0.0.1:2376' } }, TLSMaterial: { ca: ['secret'] },
  }) }), /unsupported/);
});

test('execution context binds every destructive selector and registration input', () => {
  const base = {
    engine: 'docker', daemonContextFingerprint: HASH,
    selectors: {
      compose_container: [{ locator: 'b'.repeat(64) }], compose_network: [],
      compose_volume: [], oci_image: [], buildkit_cache: [],
    },
    protectedProjects: ['zeta', 'alpha'], dataVolumeNames: ['data-1'],
    sharedImmutableIdentities: ['c'.repeat(64)],
    registrations: [{ registrationId: 'd'.repeat(64) }],
  };
  const first = buildCleanupExecutionContext(base);
  const reordered = buildCleanupExecutionContext({
    ...base, protectedProjects: ['alpha', 'zeta'],
  });
  assert.equal(first.fingerprint, reordered.fingerprint);
  for (const changed of [
    { engine: 'podman' },
    { daemonContextFingerprint: 'e'.repeat(64) },
    { dataVolumeNames: ['data-2'] },
    { sharedImmutableIdentities: [] },
    { registrations: [{ registrationId: 'f'.repeat(64) }] },
    { hostAuthorityDigest: '1'.repeat(64) },
  ]) assert.notEqual(buildCleanupExecutionContext({ ...base, ...changed }).fingerprint, first.fingerprint);
  assert.equal(Object.hasOwn(first.context, 'hostAuthorityDigest'), false);
  assert.equal(buildCleanupExecutionContext({
    ...base, hostAuthorityDigest: '1'.repeat(64),
  }).context.hostAuthorityDigest, '1'.repeat(64));
});

test('host-only execution context binds registrations and helper without daemon fields', () => {
  const registrations = [{ registrationId: 'b'.repeat(64) }, { registrationId: 'c'.repeat(64) }];
  const first = buildHostCleanupExecutionContext({ registrations, hostAuthorityDigest: HASH });
  const reordered = buildHostCleanupExecutionContext({
    registrations: [...registrations].reverse(), hostAuthorityDigest: HASH,
  });
  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.deepEqual(Object.keys(first.context).sort(), [
    'engine', 'hostAuthorityDigest', 'registrationSnapshotDigest',
  ]);
  assert.equal(first.context.engine, 'host');
  assert.notEqual(buildHostCleanupExecutionContext({
    registrations: registrations.slice(1), hostAuthorityDigest: HASH,
  }).fingerprint, first.fingerprint);
  assert.notEqual(buildHostCleanupExecutionContext({
    registrations, hostAuthorityDigest: 'd'.repeat(64),
  }).fingerprint, first.fingerprint);
  assert.throws(() => buildCleanupExecutionContext({
    engine: 'host', daemonContextFingerprint: HASH,
    selectors: { compose_container: [], compose_network: [], compose_volume: [], oci_image: [], buildkit_cache: [] },
  }), /docker or podman/);
  assert.throws(() => buildHostCleanupExecutionContext({ registrations }), /requires helper authority/);
});
