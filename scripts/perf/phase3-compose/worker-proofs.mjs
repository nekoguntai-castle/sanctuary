
import { summarizeDurations } from './common.mjs';
import { getWorkerQueueProofScript } from './proof-scripts/worker-queue.mjs';
import { getWorkerScaleOutProofScript } from './proof-scripts/worker-scale-out.mjs';

export function createWorkerProofRunners(context) {
  const {
    timestamp,
    workerQueueProofTimeoutMs,
    workerQueueProofRepeats,
    workerScaleOutReplicas,
    workerScaleOutProofTimeoutMs,
    workerScaleOutJobCount,
    workerScaleOutJobDelayMs,
    runCompose,
    runDocker,
    waitForServiceReplicaHealth,
    getServiceContainers,
  } = context;

  function runWorkerQueueProof() {
    const output = runCompose([
      'exec',
      '-T',
      '-e',
      `PHASE3_QUEUE_PROOF_ID=${timestamp}`,
      '-e',
      `PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS=${workerQueueProofTimeoutMs}`,
      '-e',
      `PHASE3_WORKER_QUEUE_PROOF_REPEATS=${workerQueueProofRepeats}`,
      'worker',
      'node',
      '--input-type=module',
      '--eval',
      getWorkerQueueProofScript(),
    ]);
  
    const proof = parseLastJsonLine(output);
    const failedJobs = proof.jobs.filter((job) => job.state !== 'completed');
    if (failedJobs.length > 0) {
      throw new Error(`Worker queue proof recorded non-completed jobs: ${JSON.stringify(failedJobs)}`);
    }
  
    return proof;
  }
  
  function parseLastJsonLine(output) {
    const lines = output.trim().split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines.toReversed()) {
      if (!line.startsWith('{')) continue;
      return JSON.parse(line);
    }
  
    throw new Error(`Worker queue proof did not emit JSON output:\n${output}`);
  }
  
  function summarizeWorkerQueueProof(proof) {
    const categories = [...new Set(proof.jobs.map((job) => job.category))];
    const durations = summarizeDurations(proof.jobs.map((job) => job.durationMs));
    const repeatLabel = proof.repeatCount && proof.repeatCount > 1 ? ` (${proof.repeatCount}x profile)` : '';
    return `${proof.jobs.length} jobs${repeatLabel} completed across ${categories.join(', ')}; p95=${durations.p95Ms}ms`;
  }
  
  async function runWorkerScaleOutProof() {
    if (workerScaleOutReplicas < 2) {
      throw new Error(`PHASE3_WORKER_SCALE_OUT_REPLICAS must be at least 2, got ${workerScaleOutReplicas}`);
    }
  
    runCompose(['up', '-d', '--scale', `worker=${workerScaleOutReplicas}`, 'worker']);
    const workerPs = await waitForServiceReplicaHealth('worker', workerScaleOutReplicas);
    const workers = getServiceContainers('worker');
    if (workers.length < 2) {
      throw new Error(`Expected at least two worker containers after scale-out, found ${workers.length}`);
    }
  
    const output = runDocker([
      'exec',
      '-e',
      `PHASE3_WORKER_SCALE_OUT_TARGETS=${JSON.stringify(workers)}`,
      '-e',
      `PHASE3_WORKER_SCALE_OUT_PROOF_ID=${timestamp}`,
      '-e',
      `PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS=${workerScaleOutProofTimeoutMs}`,
      '-e',
      `PHASE3_WORKER_SCALE_OUT_JOB_COUNT=${workerScaleOutJobCount}`,
      '-e',
      `PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS=${workerScaleOutJobDelayMs}`,
      workers[0].id,
      'node',
      '--input-type=module',
      '--eval',
      getWorkerScaleOutProofScript(),
    ]);
  
    const proof = parseLastJsonLine(output);
    const failedJobs = proof.jobs.filter((job) => job.state !== 'completed');
    if (failedJobs.length > 0) {
      throw new Error(`Worker scale-out proof recorded non-completed jobs: ${JSON.stringify(failedJobs)}`);
    }
  
    const diagnosticJobs = proof.jobs.filter((job) => job.name === 'diagnostics:worker-ping');
    const processorIds = new Set(
      diagnosticJobs
        .map((job) => job.returnvalue?.worker?.hostname)
        .filter(Boolean)
    );
    if (processorIds.size < Math.min(2, workerScaleOutReplicas)) {
      throw new Error(`Worker scale-out proof did not observe multiple job processors: ${JSON.stringify([...processorIds])}`);
    }
  
    const seenSequences = new Set();
    for (const job of diagnosticJobs) {
      const sequence = job.returnvalue?.sequence;
      if (sequence === null || sequence === undefined) {
        throw new Error(`Worker diagnostic job did not return a sequence: ${JSON.stringify(job)}`);
      }
      if (seenSequences.has(sequence)) {
        throw new Error(`Worker diagnostic sequence processed more than once: ${sequence}`);
      }
      seenSequences.add(sequence);
    }
  
    const lockedExecuted = proof.lockProof.jobs.filter((job) => job.returnvalue?.success);
    const lockedSkipped = proof.lockProof.jobs.filter((job) => job.returnvalue?.skipped);
    if (lockedExecuted.length !== 1 || lockedSkipped.length !== 1) {
      throw new Error(`Worker locked diagnostic proof expected one executed job and one lock-held skip: ${JSON.stringify(proof.lockProof.jobs)}`);
    }
  
    const ownerMetrics = proof.metricsAfter.filter((entry) => (
      entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
    ));
    if (ownerMetrics.length !== 1) {
      throw new Error(`Expected exactly one worker to own Electrum subscriptions, found ${ownerMetrics.length}: ${JSON.stringify(ownerMetrics)}`);
    }
  
    const repeatableDuplicates = (proof.repeatableJobs || []).filter((job) => job.count > 1);
    if (repeatableDuplicates.length > 0) {
      throw new Error(`Worker scale-out proof found duplicate repeatable jobs: ${JSON.stringify(repeatableDuplicates)}`);
    }
  
    return {
      ...proof,
      workerPs,
    };
  }
  
  function summarizeWorkerScaleOutProof(proof) {
    const processorIds = [...new Set(
      proof.jobs
        .filter((job) => job.name === 'diagnostics:worker-ping')
        .map((job) => job.returnvalue?.worker?.hostname)
        .filter(Boolean)
    )];
    const owner = proof.metricsAfter.find((entry) => (
      entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
    ));
    const lockedSkipped = proof.lockProof.jobs.filter((job) => job.returnvalue?.skipped).length;
    return `${proof.workers.length} workers healthy; processors=${processorIds.join(', ')}; electrumOwner=${owner?.target?.name || 'unknown'}; lockedSkips=${lockedSkipped}`;
  }

  return {
    runWorkerQueueProof,
    runWorkerScaleOutProof,
    summarizeWorkerQueueProof,
    summarizeWorkerScaleOutProof,
  };
}
