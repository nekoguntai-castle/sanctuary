import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPositiveInt } from './common.mjs';

const BACKEND_MAX_PER_USER_CONFIG_LIMIT = 100;

export const PHASE3_COMPOSE_DEFAULTS = Object.freeze({
  outputSubpath: 'docs/plans',
  timeoutMs: 360000,
  retryMs: 2000,
  ports: {
    httpStart: 18080,
    httpsStart: 18443,
    gatewayStart: 14000,
  },
  workerQueueProofTimeoutMs: 60000,
  workerQueueProofRepeats: 1,
  workerScaleOutReplicas: 2,
  workerScaleOutProofTimeoutMs: 60000,
  workerScaleOutJobCount: 8,
  workerScaleOutJobDelayMs: 300,
  workerConcurrency: '1',
  backendScaleOutReplicas: 2,
  backendScaleOutProofTimeoutMs: 60000,
  backendScaleOutWsClients: 8,
  largeWalletTransactionCount: 1000,
  largeWalletHistoryRequests: 20,
  largeWalletHistoryConcurrency: 4,
  largeWalletHistoryPageSize: 50,
  largeWalletHistoryP95BudgetMs: 2000,
  benchmarkRequests: '5',
  benchmarkConcurrency: '2',
  benchmarkWsClients: '2',
  benchmarkTimeoutMs: '20000',
});

export async function readPhase3ComposeBenchmarkConfig({ env = process.env, repoRoot, startedAt, findAvailablePort }) {
  const runIdentity = resolveRunIdentity(env, startedAt);
  const ports = await resolvePorts(env, findAvailablePort);
  const urls = resolveUrls(ports);
  const runtime = resolveRuntimeConfig({ env, repoRoot, projectName: runIdentity.projectName });
  const worker = resolveWorkerConfig(env);
  const backend = resolveBackendScaleOutConfig(env);
  const largeWallet = resolveLargeWalletConfig(env);
  const featureFlags = resolveFeatureFlags(env);

  const composeEnv = buildComposeEnv({
    env,
    postgresUser: runtime.postgresUser,
    postgresDb: runtime.postgresDb,
    httpPort: ports.httpPort,
    httpsPort: ports.httpsPort,
    gatewayPort: ports.gatewayPort,
    sslDir: runtime.sslDir,
    composeWorkerConcurrency: worker.composeWorkerConcurrency,
    backendScaleOutPerUserLimit: backend.backendScaleOutPerUserLimit,
    backendScaleOutTotalLimit: backend.backendScaleOutTotalLimit,
  });
  const benchmarkEnv = buildBenchmarkEnv({
    env,
    composeEnv,
    apiUrl: urls.apiUrl,
    gatewayUrl: urls.gatewayUrl,
    wsUrl: urls.wsUrl,
    sslDir: runtime.sslDir,
    adminUsername: runtime.adminUsername,
    adminPassword: runtime.adminPassword,
  });

  return {
    ...runIdentity,
    ...runtime,
    ...worker,
    ...backend,
    ...largeWallet,
    ...featureFlags,
    ...ports,
    ...urls,
    startedAt,
    composeArgs: ['compose', '-p', runIdentity.projectName, '-f', 'docker-compose.yml'],
    composeEnv,
    benchmarkEnv,
  };
}

function resolveRunIdentity(env, startedAt) {
  const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
  return {
    timestamp,
    projectName: env.PHASE3_COMPOSE_BENCHMARK_PROJECT
      || `sanctuary-phase3-benchmark-${timestamp.toLowerCase()}`,
  };
}

async function resolvePorts(env, findAvailablePort) {
  return {
    httpPort: env.PHASE3_COMPOSE_BENCHMARK_HTTP_PORT
      || env.HTTP_PORT
      || String(await findAvailablePort(PHASE3_COMPOSE_DEFAULTS.ports.httpStart)),
    httpsPort: env.PHASE3_COMPOSE_BENCHMARK_HTTPS_PORT
      || env.HTTPS_PORT
      || String(await findAvailablePort(PHASE3_COMPOSE_DEFAULTS.ports.httpsStart)),
    gatewayPort: env.PHASE3_COMPOSE_BENCHMARK_GATEWAY_PORT
      || env.GATEWAY_PORT
      || String(await findAvailablePort(PHASE3_COMPOSE_DEFAULTS.ports.gatewayStart)),
  };
}

function resolveUrls({ httpsPort, gatewayPort }) {
  return {
    apiUrl: `https://127.0.0.1:${httpsPort}`,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
    wsUrl: `wss://127.0.0.1:${httpsPort}/ws`,
  };
}

function resolveRuntimeConfig({ env, repoRoot, projectName }) {
  const sslDir = env.PHASE3_COMPOSE_SSL_DIR
    || mkdtempSync(path.join(tmpdir(), `${projectName}-ssl-`));
  return {
    outputDir: env.PHASE3_COMPOSE_BENCHMARK_OUTPUT_DIR || path.join(repoRoot, PHASE3_COMPOSE_DEFAULTS.outputSubpath),
    keepStack: env.PHASE3_COMPOSE_BENCHMARK_KEEP_STACK === 'true',
    timeoutMs: Number(env.PHASE3_COMPOSE_BENCHMARK_TIMEOUT_MS || PHASE3_COMPOSE_DEFAULTS.timeoutMs),
    retryMs: Number(env.PHASE3_COMPOSE_BENCHMARK_RETRY_MS || PHASE3_COMPOSE_DEFAULTS.retryMs),
    postgresUser: 'sanctuary',
    postgresDb: 'sanctuary_phase3_benchmark',
    adminUsername: env.SANCTUARY_BENCHMARK_USERNAME || 'admin',
    adminPassword: env.SANCTUARY_BENCHMARK_PASSWORD || 'sanctuary',
    sslDir,
    ownsSslDir: !env.PHASE3_COMPOSE_SSL_DIR,
  };
}

function resolveWorkerConfig(env) {
  return {
    workerQueueProofTimeoutMs: Number(
      env.PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS || PHASE3_COMPOSE_DEFAULTS.workerQueueProofTimeoutMs
    ),
    workerQueueProofRepeats: readPositiveInt(
      env.PHASE3_WORKER_QUEUE_PROOF_REPEATS,
      PHASE3_COMPOSE_DEFAULTS.workerQueueProofRepeats
    ),
    workerScaleOutReplicas: Number(env.PHASE3_WORKER_SCALE_OUT_REPLICAS || PHASE3_COMPOSE_DEFAULTS.workerScaleOutReplicas),
    workerScaleOutProofTimeoutMs: Number(
      env.PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS || PHASE3_COMPOSE_DEFAULTS.workerScaleOutProofTimeoutMs
    ),
    workerScaleOutJobCount: Number(env.PHASE3_WORKER_SCALE_OUT_JOB_COUNT || PHASE3_COMPOSE_DEFAULTS.workerScaleOutJobCount),
    workerScaleOutJobDelayMs: Number(env.PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS || PHASE3_COMPOSE_DEFAULTS.workerScaleOutJobDelayMs),
    composeWorkerConcurrency: env.PHASE3_COMPOSE_WORKER_CONCURRENCY
      || env.WORKER_CONCURRENCY
      || PHASE3_COMPOSE_DEFAULTS.workerConcurrency,
  };
}

function resolveBackendScaleOutConfig(env) {
  const backendScaleOutWsClients = readPositiveInt(
    env.PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS,
    PHASE3_COMPOSE_DEFAULTS.backendScaleOutWsClients
  );
  const backendScaleOutReplicas = Number(
    env.PHASE3_BACKEND_SCALE_OUT_REPLICAS || PHASE3_COMPOSE_DEFAULTS.backendScaleOutReplicas
  );
  const backendScaleOutPerUserLimit = readPositiveInt(
    env.PHASE3_MAX_WEBSOCKET_PER_USER || env.MAX_WEBSOCKET_PER_USER,
    Math.max(10, backendScaleOutWsClients)
  );
  const backendScaleOutTotalLimit = readPositiveInt(
    env.PHASE3_MAX_WEBSOCKET_CONNECTIONS || env.MAX_WEBSOCKET_CONNECTIONS,
    Math.max(10000, backendScaleOutWsClients * backendScaleOutReplicas)
  );

  validateBackendScaleOutLimits({ backendScaleOutWsClients, backendScaleOutPerUserLimit });

  return {
    backendScaleOutReplicas,
    backendScaleOutProofTimeoutMs: Number(
      env.PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS || PHASE3_COMPOSE_DEFAULTS.backendScaleOutProofTimeoutMs
    ),
    backendScaleOutWsClients,
    backendScaleOutPerUserLimit,
    backendScaleOutTotalLimit,
  };
}

function resolveLargeWalletConfig(env) {
  return {
    largeWalletTransactionCount: readPositiveInt(
      env.PHASE3_LARGE_WALLET_TRANSACTION_COUNT,
      PHASE3_COMPOSE_DEFAULTS.largeWalletTransactionCount
    ),
    largeWalletHistoryRequests: readPositiveInt(
      env.PHASE3_LARGE_WALLET_HISTORY_REQUESTS,
      PHASE3_COMPOSE_DEFAULTS.largeWalletHistoryRequests
    ),
    largeWalletHistoryConcurrency: readPositiveInt(
      env.PHASE3_LARGE_WALLET_HISTORY_CONCURRENCY,
      PHASE3_COMPOSE_DEFAULTS.largeWalletHistoryConcurrency
    ),
    largeWalletHistoryPageSize: readPositiveInt(
      env.PHASE3_LARGE_WALLET_HISTORY_PAGE_SIZE,
      PHASE3_COMPOSE_DEFAULTS.largeWalletHistoryPageSize
    ),
    largeWalletHistoryP95BudgetMs: readPositiveInt(
      env.PHASE3_LARGE_WALLET_HISTORY_P95_MS,
      PHASE3_COMPOSE_DEFAULTS.largeWalletHistoryP95BudgetMs
    ),
  };
}

function resolveFeatureFlags(env) {
  return {
    sizedBackupRestoreProofEnabled: env.PHASE3_SIZED_BACKUP_RESTORE_PROOF !== 'false',
    capacitySnapshotsEnabled: env.PHASE3_CAPACITY_SNAPSHOTS !== 'false',
  };
}

function validateBackendScaleOutLimits({ backendScaleOutWsClients, backendScaleOutPerUserLimit }) {
  if (backendScaleOutWsClients > BACKEND_MAX_PER_USER_CONFIG_LIMIT) {
    throw new Error(
      `PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS=${backendScaleOutWsClients} exceeds the backend ` +
        `MAX_WEBSOCKET_PER_USER schema ceiling of ${BACKEND_MAX_PER_USER_CONFIG_LIMIT}. ` +
        'Use 100 or fewer clients, or change the backend config policy before raising this proof.'
    );
  }

  if (backendScaleOutPerUserLimit > BACKEND_MAX_PER_USER_CONFIG_LIMIT) {
    throw new Error(
      `PHASE3_MAX_WEBSOCKET_PER_USER=${backendScaleOutPerUserLimit} exceeds the backend ` +
        `MAX_WEBSOCKET_PER_USER schema ceiling of ${BACKEND_MAX_PER_USER_CONFIG_LIMIT}.`
    );
  }

  if (backendScaleOutPerUserLimit < backendScaleOutWsClients) {
    throw new Error(
      `PHASE3_MAX_WEBSOCKET_PER_USER=${backendScaleOutPerUserLimit} is lower than ` +
        `PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS=${backendScaleOutWsClients}.`
    );
  }
}

function buildComposeEnv({
  env,
  postgresUser,
  postgresDb,
  httpPort,
  httpsPort,
  gatewayPort,
  sslDir,
  composeWorkerConcurrency,
  backendScaleOutPerUserLimit,
  backendScaleOutTotalLimit,
}) {
  return {
    ...env,
    NODE_ENV: 'production',
    LOG_LEVEL: env.LOG_LEVEL || 'warn',
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: 'phase3ComposeBenchmarkPostgresPassword',
    POSTGRES_DB: postgresDb,
    REDIS_PASSWORD: 'phase3ComposeBenchmarkRedisPassword',
    JWT_SECRET: 'phase3-compose-benchmark-jwt-secret-32-characters',
    ENCRYPTION_KEY: 'phase3-compose-benchmark-encryption-key-32-chars',
    ENCRYPTION_SALT: 'phase3-compose-benchmark-encryption-salt',
    GATEWAY_SECRET: 'phase3-compose-benchmark-gateway-secret-32-characters',
    AI_CONFIG_SECRET: 'phase3-compose-benchmark-ai-config-secret-32-characters',
    HTTP_PORT: httpPort,
    HTTPS_PORT: httpsPort,
    SANCTUARY_SSL_DIR: sslDir,
    GATEWAY_PORT: gatewayPort,
    GATEWAY_TLS_ENABLED: 'false',
    TLS_ENABLED: 'false',
    WORKER_HEALTH_URL: 'http://worker:3002/ready',
    WORKER_CONCURRENCY: composeWorkerConcurrency,
    MAX_WEBSOCKET_PER_USER: String(backendScaleOutPerUserLimit),
    MAX_WEBSOCKET_CONNECTIONS: String(backendScaleOutTotalLimit),
    ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS: env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS
      || env.ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS
      || '15000',
    ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS: env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS
      || env.ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS
      || '5000',
    ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS: env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS
      || env.ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS
      || '5000',
  };
}

function buildBenchmarkEnv({ env, composeEnv, apiUrl, gatewayUrl, wsUrl, sslDir, adminUsername, adminPassword }) {
  return {
    ...composeEnv,
    SANCTUARY_API_URL: apiUrl,
    SANCTUARY_GATEWAY_URL: gatewayUrl,
    SANCTUARY_WS_URL: wsUrl,
    NODE_EXTRA_CA_CERTS: path.join(sslDir, 'fullchain.pem'),
    SANCTUARY_BENCHMARK_PROVISION: 'true',
    SANCTUARY_BENCHMARK_CREATE_BACKUP: 'true',
    SANCTUARY_BENCHMARK_STRICT: 'true',
    SANCTUARY_ALLOW_RESTORE: env.PHASE3_COMPOSE_ALLOW_RESTORE || 'true',
    SANCTUARY_BENCHMARK_USERNAME: adminUsername,
    SANCTUARY_BENCHMARK_PASSWORD: adminPassword,
    SANCTUARY_BENCHMARK_WALLET_NAME: env.SANCTUARY_BENCHMARK_WALLET_NAME || 'Phase 3 Compose Benchmark Wallet',
    SANCTUARY_OUTPUT_DIR: PHASE3_COMPOSE_DEFAULTS.outputSubpath,
    SANCTUARY_REQUESTS: env.SANCTUARY_REQUESTS || PHASE3_COMPOSE_DEFAULTS.benchmarkRequests,
    SANCTUARY_CONCURRENCY: env.SANCTUARY_CONCURRENCY || PHASE3_COMPOSE_DEFAULTS.benchmarkConcurrency,
    SANCTUARY_WS_CLIENTS: env.SANCTUARY_WS_CLIENTS || PHASE3_COMPOSE_DEFAULTS.benchmarkWsClients,
    SANCTUARY_WS_FANOUT_CLIENTS: env.SANCTUARY_WS_FANOUT_CLIENTS
      || env.SANCTUARY_WS_CLIENTS
      || PHASE3_COMPOSE_DEFAULTS.benchmarkWsClients,
    SANCTUARY_TIMEOUT_MS: env.SANCTUARY_TIMEOUT_MS || PHASE3_COMPOSE_DEFAULTS.benchmarkTimeoutMs,
  };
}
