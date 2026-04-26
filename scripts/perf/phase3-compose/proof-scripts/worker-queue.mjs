export function getWorkerQueueProofScript() {
  return `
import { Queue, QueueEvents } from 'bullmq';

const proofId = process.env.PHASE3_QUEUE_PROOF_ID || String(Date.now());
const safeProofId = proofId.replace(/[^a-zA-Z0-9_-]/g, '-');
const jobTimeoutMs = Number(process.env.PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS || '60000');
const repeatCount = Math.max(1, Number(process.env.PHASE3_WORKER_QUEUE_PROOF_REPEATS || '1'));
const prefix = 'sanctuary:worker';

function connectionFromEnv() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker queue proof');
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

async function readWorkerMetrics() {
  const response = await fetch('http://127.0.0.1:3002/metrics', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error('worker metrics returned ' + response.status + ': ' + body.slice(0, 200));
  }
  return JSON.parse(body);
}

const connection = connectionFromEnv();
const queueNames = ['sync', 'confirmations', 'notifications', 'maintenance'];
const queues = new Map();
const events = new Map();

for (const queueName of queueNames) {
  const queue = new Queue(queueName, { connection, prefix });
  const queueEvents = new QueueEvents(queueName, { connection, prefix });
  await queueEvents.waitUntilReady();
  queues.set(queueName, queue);
  events.set(queueName, queueEvents);
}

const jobDefinitions = [
  {
    category: 'sync',
    queue: 'sync',
    name: 'check-stale-wallets',
    data: {
      staleThresholdMs: 0,
      maxWallets: 0,
      priority: 'low',
      staggerDelayMs: 0,
      reason: 'phase3-worker-queue-proof',
    },
  },
  {
    category: 'confirmations',
    queue: 'confirmations',
    name: 'update-all-confirmations',
    data: {},
  },
  {
    category: 'notifications',
    queue: 'notifications',
    name: 'confirmation-notify',
    data: {
      walletId: '00000000-0000-4000-8000-000000000000',
      txid: 'phase3-worker-queue-proof',
      confirmations: 2,
      previousConfirmations: 1,
    },
  },
  {
    category: 'maintenance',
    queue: 'maintenance',
    name: 'cleanup:expired-tokens',
    data: {},
  },
  {
    category: 'autopilot',
    queue: 'maintenance',
    name: 'autopilot:evaluate',
    data: {},
  },
  {
    category: 'intelligence',
    queue: 'maintenance',
    name: 'intelligence:cleanup',
    data: {},
  },
];

const proofStartedAt = Date.now();
const jobs = [];

try {
  const metricsBefore = await readWorkerMetrics();

  for (let repeat = 0; repeat < repeatCount; repeat += 1) {
    for (const definition of jobDefinitions) {
      const queue = queues.get(definition.queue);
      const queueEvents = events.get(definition.queue);
      const job = await queue.add(definition.name, {
        ...definition.data,
        phase3ProofRepeat: repeat,
      }, {
        attempts: 1,
        jobId: ['phase3', safeProofId, definition.category, String(repeat), definition.name.replace(/[^a-zA-Z0-9_-]/g, '-')].join('-'),
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      const startedAt = Date.now();
      const returnvalue = await job.waitUntilFinished(queueEvents, jobTimeoutMs);
      const state = await job.getState();

      jobs.push({
        repeat,
        category: definition.category,
        queue: definition.queue,
        name: definition.name,
        id: job.id,
        state,
        durationMs: Date.now() - startedAt,
        returnvalue,
      });
    }
  }

  const metricsAfter = await readWorkerMetrics();
  console.log(JSON.stringify({
    proofId,
    repeatCount,
    totalDurationMs: Date.now() - proofStartedAt,
    metricsBefore,
    metricsAfter,
    jobs,
  }));
} finally {
  await Promise.all([...events.values()].map((queueEvents) => queueEvents.close()));
  await Promise.all([...queues.values()].map((queue) => queue.close()));
}
`;
}
