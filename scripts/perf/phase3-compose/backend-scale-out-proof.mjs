
import { parseLastJsonLine } from './common.mjs';
import { getBackendScaleOutProofScript } from './proof-scripts/backend-scale-out.mjs';

export function createBackendScaleOutProofRunner(context) {
  const {
    timestamp,
    backendScaleOutReplicas,
    backendScaleOutProofTimeoutMs,
    backendScaleOutWsClients,
    workerScaleOutReplicas,
    adminUsername,
    adminPassword,
    runCompose,
    runDocker,
    waitForServiceReplicaHealth,
    getServiceContainers,
  } = context;

  async function runBackendScaleOutProof() {
    if (backendScaleOutReplicas < 2) {
      throw new Error(`PHASE3_BACKEND_SCALE_OUT_REPLICAS must be at least 2, got ${backendScaleOutReplicas}`);
    }
  
    runCompose(['up', '-d', '--scale', `backend=${backendScaleOutReplicas}`, '--scale', `worker=${workerScaleOutReplicas}`, 'backend', 'worker']);
    const backendPs = await waitForServiceReplicaHealth('backend', backendScaleOutReplicas);
    const backends = getServiceContainers('backend');
    if (backends.length < 2) {
      throw new Error(`Expected at least two backend containers after scale-out, found ${backends.length}`);
    }
  
    const output = runDocker([
      'exec',
      '-e',
      `PHASE3_BACKEND_SCALE_OUT_TARGETS=${JSON.stringify(backends)}`,
      '-e',
      `PHASE3_BACKEND_SCALE_OUT_PROOF_ID=${timestamp}`,
      '-e',
      `PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS=${backendScaleOutProofTimeoutMs}`,
      '-e',
      `PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS=${backendScaleOutWsClients}`,
      '-e',
      `SANCTUARY_BENCHMARK_USERNAME=${adminUsername}`,
      '-e',
      `SANCTUARY_BENCHMARK_PASSWORD=${adminPassword}`,
      backends[0].id,
      'node',
      '--input-type=module',
      '--eval',
      getBackendScaleOutProofScript(),
    ]);
  
    const proof = parseLastJsonLine(output);
    const fanoutEvents = proof.fanout?.events || [];
    const failedFanoutEvents = fanoutEvents.filter((event) => !event.ok);
    if (fanoutEvents.length !== proof.fanout?.clientCount || failedFanoutEvents.length > 0) {
      throw new Error(`Backend scale-out proof did not receive the sync event on every WebSocket client: ${JSON.stringify(proof.fanout || null)}`);
    }
  
    const fanoutTargetNames = new Set(
      (proof.websocket?.targets || [])
        .map((target) => target.target?.name)
        .filter(Boolean)
    );
    if (fanoutTargetNames.size < Math.min(2, backendScaleOutReplicas)) {
      throw new Error(`Backend scale-out fanout proof did not cover multiple backend replicas: ${JSON.stringify([...fanoutTargetNames])}`);
    }
  
    return {
      ...proof,
      backendPs,
    };
  }
  
  function summarizeBackendScaleOutProof(proof) {
    const clientCount = proof.fanout?.clientCount || 0;
    const successes = proof.fanout?.successes || 0;
    const targetCount = new Set(
      (proof.websocket?.targets || [])
        .map((target) => target.target?.name)
        .filter(Boolean)
    ).size;
    const p95 = proof.fanout?.latency?.p95Ms ?? 'n/a';
    return `sync event from ${proof.triggerTarget.name} reached ${successes}/${clientCount} WebSockets across ${targetCount} backend replicas via Redis; p95=${p95}ms`;
  }

  return {
    runBackendScaleOutProof,
    summarizeBackendScaleOutProof,
  };
}
