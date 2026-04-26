function getWorkerScaleOutProofConfigScript() {
  return `
import { Queue, QueueEvents } from 'bullmq';

const proofId = process.env.PHASE3_WORKER_SCALE_OUT_PROOF_ID || String(Date.now());
const safeProofId = proofId.replace(/[^a-zA-Z0-9_-]/g, '-');
const workers = JSON.parse(process.env.PHASE3_WORKER_SCALE_OUT_TARGETS || '[]');
const jobTimeoutMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');
const requestedJobCount = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_COUNT || '8');
const jobDelayMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS || '300');
const prefix = 'sanctuary:worker';
const proofStartedAt = Date.now();

if (workers.length < 2) {
  throw new Error('At least two worker targets are required for worker scale-out proof');
}

function connectionFromEnv() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker scale-out proof');
  }

  const parsed = new URL(redisUrl);
  const db = parsed.pathname && parsed.pathname !== '/'
    ? Number.parseInt(parsed.pathname.slice(1), 10)
    : 0;

  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
`;
}

function getWorkerScaleOutProofMetricsScript() {
  return `
async function readWorkerMetrics(target) {
  const response = await fetch('http://' + target.ip + ':3002/metrics', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error('worker metrics for ' + target.name + ' returned ' + response.status + ': ' + body.slice(0, 200));
  }
  return {
    target,
    metrics: parseJson(body),
  };
}

async function readAllWorkerMetrics() {
  return Promise.all(workers.map((target) => readWorkerMetrics(target)));
}

async function waitForElectrumOwner() {
  const deadline = Date.now() + jobTimeoutMs;
  let latest = [];

  while (Date.now() < deadline) {
    latest = await readAllWorkerMetrics();
    const owners = latest.filter((entry) => (
      entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
    ));
    if (owners.length === 1) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return latest;
}
`;
}

function getWorkerScaleOutProofQueueScript() {
  return `
const connection = connectionFromEnv();
const queueNames = ['sync', 'confirmations', 'maintenance'];
const queues = new Map();
for (const queueName of queueNames) {
  queues.set(queueName, new Queue(queueName, { connection, prefix }));
}
const maintenanceQueue = queues.get('maintenance');
const maintenanceEvents = new QueueEvents('maintenance', { connection, prefix });
await maintenanceEvents.waitUntilReady();

async function readRepeatableJobs() {
  const expected = {
    sync: ['check-stale-wallets'],
    confirmations: ['update-all-confirmations'],
    maintenance: [
      'cleanup:expired-drafts',
      'cleanup:expired-transfers',
      'cleanup:audit-logs',
      'cleanup:price-data',
      'cleanup:fee-estimates',
      'cleanup:expired-tokens',
      'maintenance:weekly-vacuum',
      'maintenance:monthly-cleanup',
      'backup:scheduled',
    ],
  };
  const records = [];

  for (const [queueName, names] of Object.entries(expected)) {
    const queue = queues.get(queueName);
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const name of names) {
      const matches = repeatableJobs.filter((job) => job.name === name);
      records.push({
        queue: queueName,
        name,
        count: matches.length,
        keys: matches.map((job) => job.key),
      });
    }
  }

  return records;
}

async function waitForJob(job, category) {
  const startedAt = Date.now();
  const returnvalue = await job.waitUntilFinished(maintenanceEvents, jobTimeoutMs);
  const state = await job.getState();
  return {
    category,
    queue: 'maintenance',
    name: job.name,
    id: job.id,
    state,
    durationMs: Date.now() - startedAt,
    returnvalue,
  };
}
`;
}

function getWorkerScaleOutProofExecutionScript() {
  return `
const metricsBefore = await readAllWorkerMetrics();
const repeatableJobs = await readRepeatableJobs();
const jobCount = Math.max(workers.length * 2, requestedJobCount);

const diagnosticJobs = [];
for (let sequence = 0; sequence < jobCount; sequence += 1) {
  const job = await maintenanceQueue.add('diagnostics:worker-ping', {
    proofId,
    sequence,
    delayMs: jobDelayMs,
  }, {
    attempts: 1,
    jobId: ['phase3-worker-scaleout', safeProofId, 'ping', String(sequence)].join('-'),
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  diagnosticJobs.push(job);
}

const jobs = await Promise.all(diagnosticJobs.map((job) => waitForJob(job, 'worker-distribution')));

const lockKey = ['phase3-worker-scaleout', safeProofId, 'shared-lock'].join('-');
const lockedJobs = [];
for (let sequence = 0; sequence < 2; sequence += 1) {
  const job = await maintenanceQueue.add('diagnostics:locked-worker-ping', {
    proofId,
    sequence,
    lockKey,
    delayMs: Math.max(jobDelayMs, 500),
  }, {
    attempts: 1,
    jobId: ['phase3-worker-scaleout', safeProofId, 'locked', String(sequence)].join('-'),
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  lockedJobs.push(job);
}

const lockProof = {
  lockKey,
  jobs: await Promise.all(lockedJobs.map((job) => waitForJob(job, 'distributed-lock'))),
};
const metricsAfter = await waitForElectrumOwner();

console.log(JSON.stringify({
  proofId,
  totalDurationMs: Date.now() - proofStartedAt,
  workers,
  workerCount: workers.length,
  metricsBefore,
  metricsAfter,
  repeatableJobs,
  jobs,
  lockProof,
}));

await maintenanceEvents.close();
await Promise.all([...queues.values()].map((queue) => queue.close()));
`;
}

export function getWorkerScaleOutProofScript() {
  return [
    getWorkerScaleOutProofConfigScript(),
    getWorkerScaleOutProofMetricsScript(),
    getWorkerScaleOutProofQueueScript(),
    getWorkerScaleOutProofExecutionScript(),
  ].join('\n');
}
