import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAX_RUNTIME_MS = 120_000;
const MAX_PROBE_MS = 1_000;
const MAX_P99_PROBE_MS = 250;
const MAX_MEMORY_DELTA_BYTES = 512 * 1024 * 1024;
const MAX_MEMORY_BYTES = 768 * 1024 * 1024;
const POLL_MS = 100;

const run = (args, options = {}) =>
  execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...options,
  });

const sourceCommit = run(['git', 'rev-parse', 'HEAD']).trim();
const imageLockSha = createHash('sha256').update(readFileSync('config/container-image-lock.json')).digest('hex');
const image = process.env.WALLET_SYNC_REPLAY_IMAGE ?? `sanctuary-wallet-sync-replay:${sourceCommit.slice(0, 12)}`;
const container = `sanctuary-wallet-sync-replay-${process.pid}`;

const buildImage = () => {
  if (process.env.WALLET_SYNC_REPLAY_IMAGE) return;
  run(
    [
      'docker',
      'buildx',
      'build',
      '--file',
      'server/Dockerfile',
      '--load',
      '--tag',
      image,
      '--build-arg',
      `SANCTUARY_SOURCE_COMMIT=${sourceCommit}`,
      '--build-arg',
      `SANCTUARY_IMAGE_LOCK_SHA256=${imageLockSha}`,
      '.',
    ],
    { stdio: 'inherit' },
  );
};

const verifyImage = () => {
  const revision = run([
    'docker', 'image', 'inspect', '--format',
    '{{index .Config.Labels "org.opencontainers.image.revision"}}', image,
  ]).trim();
  const lockSha = run([
    'docker', 'image', 'inspect', '--format',
    '{{index .Config.Labels "dev.sanctuary.image-lock-sha256"}}', image,
  ]).trim();
  if (revision !== sourceCommit || lockSha !== imageLockSha) {
    throw new Error(`Replay image identity mismatch: revision=${revision} lock=${lockSha}`);
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const inspect = format => {
  try {
    return run(['docker', 'inspect', '--format', format, container]).trim();
  } catch {
    return '';
  }
};

const parseMemory = value => {
  const match = value.match(/^([0-9.]+)([KMGT]iB)$/);
  if (!match) return 0;
  const powers = { KiB: 1, MiB: 2, GiB: 3, TiB: 4 };
  return Number(match[1]) * 1024 ** powers[match[2]];
};

const memoryUsage = () => {
  const usage = run(['docker', 'stats', '--no-stream', '--format', '{{.MemUsage}}', container]);
  const parsed = parseMemory(usage.split('/')[0].trim());
  if (!(parsed > 0)) {
    if (inspect('{{.State.Running}}') === 'false') return undefined;
    throw new Error(`Could not parse replay memory usage: ${usage.trim()}`);
  }
  return parsed;
};

const mappedPort = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const output = inspect('{{(index (index .NetworkSettings.Ports "3002/tcp") 0).HostPort}}');
    if (/^[0-9]+$/.test(output)) return Number(output);
    if (inspect('{{.State.Running}}') === 'false') break;
    await sleep(100);
  }
  throw new Error('Replay health port was not published');
};

const waitForReplayReady = async () => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const logs = run(['docker', 'logs', container]);
    if (parseEvent(logs, 'replay_ready')) return;
    if (inspect('{{.State.Running}}') === 'false') break;
    await sleep(100);
  }
  throw new Error('Replay did not enter the measured phase');
};

const probe = async (port, path) => {
  const started = performance.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(MAX_PROBE_MS),
    });
    await response.arrayBuffer();
    return {
      ok: response.status === 200,
      elapsedMs: performance.now() - started,
    };
  } catch {
    return { ok: false, elapsedMs: performance.now() - started };
  }
};

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

const parseEvent = (logs, event) =>
  logs
    .split('\n')
    .flatMap(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.event === event ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .at(-1);

const cleanup = () => {
  if (!inspect('{{.Id}}')) return;
  try {
    run(['docker', 'rm', '--force', container]);
  } catch {
    // Preserve the original proof failure; the exact owned name is reported below.
  }
};

async function main() {
  buildImage();
  verifyImage();
  run([
    'docker',
    'run',
    '--detach',
    '--name',
    container,
    '--cpus',
    '1',
    '--memory',
    '1g',
    '--memory-swap',
    '1280m',
    '--publish',
    '127.0.0.1::3002',
    '--env',
    'NODE_OPTIONS=--max-old-space-size=1024',
    '--env',
    'JWT_SECRET=wallet-sync-replay-jwt-secret-32-characters',
    '--env',
    'ENCRYPTION_KEY=wallet-sync-replay-encryption-key-32-chars',
    '--env',
    'ENCRYPTION_SALT=wallet-sync-replay-salt',
    '--env',
    'WORKER_DIAGNOSTICS_SECRET=wallet-sync-replay-diagnostics-secret',
    '--env',
    'GATEWAY_SECRET=wallet-sync-replay-gateway-secret',
    '--env',
    'DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused',
    '--env',
    'REDIS_URL=redis://127.0.0.1:1',
    image,
    'node',
    'dist/server/src/perf/walletSyncHighFanoutReplay.js',
  ]);

  const port = await mappedPort();
  await waitForReplayReady();
  const samples = [await probe(port, '/live'), await probe(port, '/metrics/prometheus')];
  const preStartSamples = samples.length;
  const baselineMemoryBytes = memoryUsage();
  if (baselineMemoryBytes === undefined) throw new Error('Replay exited before baseline sampling');
  let peakMemoryBytes = baselineMemoryBytes;
  let memorySamples = 1;
  let nextMemorySampleAt = 0;
  let postCompletionSamples = 0;
  let completionReleased = false;
  run(['docker', 'kill', '--signal', 'USR1', container]);
  const observerStartedAt = Date.now();
  while (inspect('{{.State.Running}}') === 'true') {
    if (Date.now() - observerStartedAt > MAX_RUNTIME_MS + 30_000) {
      throw new Error('Replay observer watchdog expired');
    }
    const completionSeen = Boolean(parseEvent(run(['docker', 'logs', container]), 'replay_completed'));
    samples.push(await probe(port, samples.length % 2 === 0 ? '/live' : '/metrics/prometheus'));
    if (completionSeen) {
      postCompletionSamples++;
      if (postCompletionSamples >= 2 && !completionReleased) {
        completionReleased = true;
        run(['docker', 'kill', '--signal', 'USR2', container]);
      }
    }
    if (Date.now() >= nextMemorySampleAt) {
      const currentMemoryBytes = memoryUsage();
      if (currentMemoryBytes !== undefined) {
        peakMemoryBytes = Math.max(peakMemoryBytes, currentMemoryBytes);
        memorySamples++;
      }
      nextMemorySampleAt = Date.now() + 500;
    }
    await sleep(POLL_MS);
  }

  const exitCode = Number(inspect('{{.State.ExitCode}}'));
  const oomKilled = inspect('{{.State.OOMKilled}}') === 'true';
  const logs = run(['docker', 'logs', container]);
  const ready = parseEvent(logs, 'replay_ready');
  const completed = parseEvent(logs, 'replay_completed');
  const cancellation = parseEvent(logs, 'cancellation_completed');
  if (exitCode !== 0 || oomKilled || !ready || !completed || !cancellation) {
    throw new Error(`Replay failed: exit=${exitCode} oom=${oomKilled}\n${logs}`);
  }
  const failures = samples.filter(sample => !sample.ok).length;
  const latencies = samples.map(sample => sample.elapsedMs);
  const result = {
    elapsedMs: completed.elapsedMs,
    samples: samples.length,
    failedProbes: failures,
    maxProbeMs: Math.round(Math.max(...latencies)),
    p99ProbeMs: Math.round(percentile(latencies, 0.99)),
    baselineMemoryBytes,
    peakMemoryBytes,
    memoryDeltaBytes: peakMemoryBytes - baselineMemoryBytes,
    baselineThreads: ready.baselineThreads,
    finalThreads: completed.finalThreads,
    compiledWorker: ready.compiledWorker,
    preStartSamples,
    postCompletionSamples,
    memorySamples,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failuresFound = [
    completed.elapsedMs > MAX_RUNTIME_MS && `elapsed ${completed.elapsedMs}ms > ${MAX_RUNTIME_MS}ms`,
    samples.length < 20 && `only ${samples.length} active samples`,
    preStartSamples < 2 && 'observation did not begin before the measured phase',
    postCompletionSamples < 1 && 'observation did not continue through phase completion',
    memorySamples < 2 && 'insufficient memory samples',
    failures > 0 && `${failures} health/metrics probes failed`,
    result.maxProbeMs > MAX_PROBE_MS && `max probe ${result.maxProbeMs}ms`,
    result.p99ProbeMs > MAX_P99_PROBE_MS && `p99 probe ${result.p99ProbeMs}ms`,
    peakMemoryBytes > MAX_MEMORY_BYTES && `peak memory ${peakMemoryBytes} bytes`,
    result.memoryDeltaBytes > MAX_MEMORY_DELTA_BYTES && `memory delta ${result.memoryDeltaBytes} bytes`,
    ready.baselineThreads !== completed.finalThreads && 'evidence worker thread leaked',
    !ready.compiledWorker && 'source-runtime evidence worker ran',
    cancellation.activeProjectionCancelled !== true && 'active projection cancellation was not proven',
  ].filter(Boolean);
  if (failuresFound.length > 0) throw new Error(failuresFound.join('; '));
}

try {
  await main();
} finally {
  cleanup();
}
