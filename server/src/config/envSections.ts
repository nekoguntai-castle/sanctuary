const parseIntegerEnvFrom = (names: string[], fallback: number): number => {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') {
      return parseInt(value, 10);
    }
  }
  return fallback;
};

export const parseIntegerEnv = (name: string, fallback: number): number =>
  parseInt(process.env[name] || String(fallback), 10);

const parseBooleanEnv = (name: string): boolean => process.env[name] === 'true';

export const parseStringEnv = (name: string, fallback = ''): string =>
  process.env[name] || fallback;

export function buildRateLimitConfig() {
  return {
    loginAttempts: parseIntegerEnv('RATE_LIMIT_LOGIN', 5),
    loginWindowSeconds: parseIntegerEnv('RATE_LIMIT_LOGIN_WINDOW', 900),
    registerAttempts: parseIntegerEnv('RATE_LIMIT_REGISTER', 10),
    registerWindowSeconds: parseIntegerEnv('RATE_LIMIT_REGISTER_WINDOW', 3600),
    twoFaAttempts: parseIntegerEnv('RATE_LIMIT_2FA', 10),
    twoFaWindowSeconds: parseIntegerEnv('RATE_LIMIT_2FA_WINDOW', 900),
    passwordChangeAttempts: parseIntegerEnv('RATE_LIMIT_PASSWORD_CHANGE', 5),
    passwordChangeWindowSeconds: parseIntegerEnv('RATE_LIMIT_PASSWORD_CHANGE_WINDOW', 900),
    emailVerifyAttempts: parseIntegerEnv('RATE_LIMIT_EMAIL_VERIFY', 10),
    emailVerifyWindowSeconds: parseIntegerEnv('RATE_LIMIT_EMAIL_VERIFY_WINDOW', 900),
    emailResendAttempts: parseIntegerEnv('RATE_LIMIT_EMAIL_RESEND', 5),
    emailResendWindowSeconds: parseIntegerEnv('RATE_LIMIT_EMAIL_RESEND_WINDOW', 3600),
    emailUpdateAttempts: parseIntegerEnv('RATE_LIMIT_EMAIL_UPDATE', 3),
    emailUpdateWindowSeconds: parseIntegerEnv('RATE_LIMIT_EMAIL_UPDATE_WINDOW', 3600),
    apiDefaultLimit: parseIntegerEnv('RATE_LIMIT_API_DEFAULT', 1000),
    apiHeavyLimit: parseIntegerEnv('RATE_LIMIT_API_HEAVY', 100),
    apiPublicLimit: parseIntegerEnv('RATE_LIMIT_API_PUBLIC', 60),
    syncTriggerLimit: parseIntegerEnv('RATE_LIMIT_SYNC_TRIGGER', 10),
    syncBatchLimit: parseIntegerEnv('RATE_LIMIT_SYNC_BATCH', 5),
    txCreateLimit: parseIntegerEnv('RATE_LIMIT_TX_CREATE', 30),
    txBroadcastLimit: parseIntegerEnv('RATE_LIMIT_TX_BROADCAST', 20),
    aiAnalyzeLimit: parseIntegerEnv('RATE_LIMIT_AI_ANALYZE', 20),
    aiSummarizeLimit: parseIntegerEnv('RATE_LIMIT_AI_SUMMARIZE', 10),
    aiWindowSeconds: parseIntegerEnv('RATE_LIMIT_AI_WINDOW', 60),
    adminDefaultLimit: parseIntegerEnv('RATE_LIMIT_ADMIN_DEFAULT', 500),
    payjoinCreateLimit: parseIntegerEnv('RATE_LIMIT_PAYJOIN_CREATE', 10),
    wsConnectLimit: parseIntegerEnv('RATE_LIMIT_WS_CONNECT', 10),
    wsMessageLimit: parseIntegerEnv('RATE_LIMIT_WS_MESSAGE', 100),
  };
}

export function buildMaintenanceConfig() {
  return {
    auditLogRetentionDays: parseIntegerEnv('AUDIT_LOG_RETENTION_DAYS', 90),
    priceDataRetentionDays: parseIntegerEnv('PRICE_DATA_RETENTION_DAYS', 30),
    feeEstimateRetentionDays: parseIntegerEnv('FEE_ESTIMATE_RETENTION_DAYS', 7),
    diskWarningThresholdPercent: parseIntegerEnv('DISK_WARNING_THRESHOLD_PERCENT', 80),
    dailyCleanupIntervalMs: parseIntegerEnv('MAINTENANCE_DAILY_INTERVAL_MS', 24 * 60 * 60 * 1000),
    hourlyCleanupIntervalMs: parseIntegerEnv('MAINTENANCE_HOURLY_INTERVAL_MS', 60 * 60 * 1000),
    initialDelayMs: parseIntegerEnv('MAINTENANCE_INITIAL_DELAY_MS', 60 * 1000),
    weeklyMaintenanceIntervalMs: parseIntegerEnv('MAINTENANCE_WEEKLY_INTERVAL_MS', 7 * 24 * 60 * 60 * 1000),
    monthlyMaintenanceIntervalMs: parseIntegerEnv('MAINTENANCE_MONTHLY_INTERVAL_MS', 30 * 24 * 60 * 60 * 1000),
  };
}

export function buildSyncConfig() {
  return {
    intervalMs: parseIntegerEnv('SYNC_INTERVAL_MS', 5 * 60 * 1000),
    confirmationUpdateIntervalMs: parseIntegerEnv('SYNC_CONFIRMATION_INTERVAL_MS', 2 * 60 * 1000),
    staleThresholdMs: parseIntegerEnv('SYNC_STALE_THRESHOLD_MS', 10 * 60 * 1000),
    staleBatchSize: parseIntegerEnv('SYNC_STALE_BATCH_SIZE', 50),
    maxConcurrentSyncs: parseIntegerEnv('SYNC_MAX_CONCURRENT', 5),
    syncStaggerDelayMs: parseIntegerEnv('SYNC_STAGGER_DELAY_MS', 2000),
    startupCatchUpBatchSize: parseIntegerEnv('SYNC_STARTUP_CATCH_UP_BATCH_SIZE', 250),
    startupCatchUpDelayMs: parseIntegerEnv('SYNC_STARTUP_CATCH_UP_DELAY_MS', 10000),
    startupCatchUpStaggerDelayMs: parseIntegerEnv('SYNC_STARTUP_CATCH_UP_STAGGER_DELAY_MS', 1000),
    maxRetryAttempts: parseIntegerEnv('SYNC_MAX_RETRIES', 3),
    retryDelaysMs: parseRetryDelays(),
    maxSyncDurationMs: parseIntegerEnv('SYNC_MAX_DURATION_MS', 30 * 60 * 1000),
    transactionBatchSize: parseIntegerEnv('SYNC_TRANSACTION_BATCH_SIZE', 100),
    electrumSubscriptionsEnabled: process.env.SYNC_ELECTRUM_SUBSCRIPTIONS_ENABLED !== 'false',
    workerHealthPollIntervalMs: parseIntegerEnv('SYNC_WORKER_HEALTH_POLL_MS', 30000),
  };
}

function parseRetryDelays(): number[] {
  return parseStringEnv('SYNC_RETRY_DELAYS_MS', '5000,15000,45000')
    .split(',')
    .map(s => parseInt(s.trim(), 10));
}

export function buildElectrumClientConfig() {
  return {
    requestTimeoutMs: parseIntegerEnv('ELECTRUM_REQUEST_TIMEOUT_MS', 30000),
    batchRequestTimeoutMs: parseIntegerEnv('ELECTRUM_BATCH_TIMEOUT_MS', 60000),
    connectionTimeoutMs: parseIntegerEnv('ELECTRUM_CONNECTION_TIMEOUT_MS', 10000),
    torTimeoutMultiplier: parseIntegerEnv('ELECTRUM_TOR_TIMEOUT_MULTIPLIER', 3),
  };
}

export function buildWebsocketConfig() {
  return {
    maxConnections: parseIntegerEnv('MAX_WEBSOCKET_CONNECTIONS', 10000),
    maxPerUser: parseIntegerEnv('MAX_WEBSOCKET_PER_USER', 10),
  };
}

export function buildPushConfig() {
  return {
    fcm: { serviceAccountPath: parseStringEnv('FCM_SERVICE_ACCOUNT') },
    apns: {
      keyId: parseStringEnv('APNS_KEY_ID'),
      teamId: parseStringEnv('APNS_TEAM_ID'),
      keyPath: parseStringEnv('APNS_KEY_PATH'),
      bundleId: parseStringEnv('APNS_BUNDLE_ID'),
      isProduction: parseBooleanEnv('APNS_PRODUCTION'),
    },
  };
}

export function buildMcpConfig() {
  return {
    enabled: parseBooleanEnv('MCP_ENABLED'),
    host: parseStringEnv('MCP_HOST', '127.0.0.1'),
    port: parseIntegerEnv('MCP_PORT', 3003),
    allowedHosts: parseCsvEnv('MCP_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]'),
    rateLimitPerMinute: parseIntegerEnvFrom(['MCP_RATE_LIMIT_PER_MINUTE', 'MCP_RATE_LIMIT'], 120),
    defaultPageSize: parseIntegerEnv('MCP_DEFAULT_PAGE_SIZE', 100),
    maxPageSize: parseIntegerEnv('MCP_MAX_PAGE_SIZE', 500),
    maxDateRangeDays: parseIntegerEnv('MCP_MAX_DATE_RANGE_DAYS', 365),
  };
}

function parseCsvEnv(name: string, fallback: string): string[] {
  return parseStringEnv(name, fallback)
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

export function buildWorkerHealthConfig(
  nodeEnv: 'development' | 'production' | 'test',
  workerHealthPort: number
) {
  const defaultWorkerHost = nodeEnv === 'production' ? 'worker' : 'localhost';
  return {
    healthUrl: parseStringEnv('WORKER_HEALTH_URL', `http://${defaultWorkerHost}:${workerHealthPort}/health`),
    healthTimeoutMs: parseIntegerEnv('WORKER_HEALTH_TIMEOUT_MS', 3000),
    healthCheckIntervalMs: parseIntegerEnv('WORKER_HEALTH_CHECK_INTERVAL_MS', 10000),
  };
}

export function buildMonitoringConfig() {
  return {
    grafanaPort: parseIntegerEnv('GRAFANA_PORT', 3000),
    prometheusPort: parseIntegerEnv('PROMETHEUS_PORT', 9090),
    jaegerPort: parseIntegerEnv('JAEGER_UI_PORT', 16686),
    tracingEnabled: parseBooleanEnv('OTEL_TRACING_ENABLED'),
  };
}
