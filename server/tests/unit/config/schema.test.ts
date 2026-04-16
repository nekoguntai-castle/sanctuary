import { describe, expect, it, vi } from 'vitest';
import { assertValidConfig, validateConfigSchema } from '../../../src/config/schema';

function buildValidConfig() {
  return {
    server: {
      nodeEnv: 'test',
      port: 3001,
      apiUrl: 'http://localhost:3001',
      clientUrl: 'http://localhost:3000',
    },
    database: {
      url: 'postgresql://user:pass@localhost:5432/sanctuary',
    },
    redis: {
      url: 'redis://localhost:6379',
      enabled: true,
    },
    security: {
      jwt: {
        secret: 'x'.repeat(32),
        expiresIn: '1h',
        refreshExpiresIn: '7d',
      },
      gatewaySecret: 'g'.repeat(32),
      corsAllowedOrigins: ['http://localhost:3000'],
      encryptionKey: 'e'.repeat(32),
      encryptionSalt: 'salt',
    },
    rateLimit: {
      loginAttempts: 5,
      loginWindowSeconds: 900,
      registerAttempts: 10,
      registerWindowSeconds: 3600,
      twoFaAttempts: 10,
      twoFaWindowSeconds: 900,
      passwordChangeAttempts: 5,
      passwordChangeWindowSeconds: 900,
      emailVerifyAttempts: 10,
      emailVerifyWindowSeconds: 900,
      emailResendAttempts: 5,
      emailResendWindowSeconds: 3600,
      emailUpdateAttempts: 3,
      emailUpdateWindowSeconds: 3600,
      apiDefaultLimit: 1000,
      apiHeavyLimit: 100,
      apiPublicLimit: 60,
      syncTriggerLimit: 10,
      syncBatchLimit: 5,
      txCreateLimit: 30,
      txBroadcastLimit: 20,
      aiAnalyzeLimit: 20,
      aiSummarizeLimit: 10,
      aiWindowSeconds: 60,
      adminDefaultLimit: 500,
      payjoinCreateLimit: 10,
      wsConnectLimit: 10,
      wsMessageLimit: 100,
    },
    bitcoin: {
      network: 'mainnet',
      rpc: {
        host: 'localhost',
        port: 8332,
        user: 'user',
        password: 'pass',
      },
      electrum: {
        host: 'electrum.blockstream.info',
        port: 50002,
        protocol: 'ssl',
      },
    },
    priceApis: {
      mempool: 'https://mempool.space/api/v1',
      coingecko: 'https://api.coingecko.com/api/v3',
      kraken: 'https://api.kraken.com/0/public',
    },
    ai: {
      containerUrl: 'http://ai:3100',
      configSecret: 'ai-secret',
    },
    maintenance: {
      auditLogRetentionDays: 90,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
      diskWarningThresholdPercent: 80,
      dailyCleanupIntervalMs: 86400000,
      hourlyCleanupIntervalMs: 3600000,
      initialDelayMs: 60000,
      weeklyMaintenanceIntervalMs: 604800000,
      monthlyMaintenanceIntervalMs: 2592000000,
    },
    sync: {
      intervalMs: 300000,
      confirmationUpdateIntervalMs: 120000,
      staleThresholdMs: 600000,
      staleBatchSize: 50,
      maxConcurrentSyncs: 5,
      syncStaggerDelayMs: 2000,
      startupCatchUpBatchSize: 100,
      startupCatchUpDelayMs: 5000,
      startupCatchUpStaggerDelayMs: 500,
      maxRetryAttempts: 3,
      retryDelaysMs: [5000, 15000, 45000],
      maxSyncDurationMs: 1800000,
      transactionBatchSize: 100,
      electrumSubscriptionsEnabled: true,
      workerHealthPollIntervalMs: 30000,
    },
    electrumClient: {
      requestTimeoutMs: 30000,
      batchRequestTimeoutMs: 60000,
      connectionTimeoutMs: 10000,
      torTimeoutMultiplier: 3,
    },
    websocket: {
      maxConnections: 10000,
      maxPerUser: 10,
    },
    push: {
      fcm: {
        serviceAccountPath: '/tmp/firebase-service-account.json',
      },
      apns: {
        keyId: 'APNSKEY',
        teamId: 'APNSTEAM',
        keyPath: '/tmp/apns.p8',
        bundleId: 'com.example.sanctuary',
        isProduction: false,
      },
    },
    payjoin: {
      publicUrl: '',
    },
    mcp: {
      enabled: false,
      host: '127.0.0.1',
      port: 3003,
      allowedHosts: ['localhost', '127.0.0.1'],
      rateLimitPerMinute: 120,
      defaultPageSize: 100,
      maxPageSize: 500,
      maxDateRangeDays: 365,
    },
    docker: {
      proxyUrl: 'http://docker-proxy:2375',
    },
    worker: {
      healthPort: 3002,
      healthUrl: 'http://localhost:3002/health',
      healthTimeoutMs: 3000,
      healthCheckIntervalMs: 10000,
      concurrency: 5,
    },
    logging: {
      level: 'info',
    },
    monitoring: {
      grafanaPort: 3000,
      prometheusPort: 9090,
      jaegerPort: 16686,
      tracingEnabled: false,
    },
    features: {
      hardwareWalletSigning: true,
      qrCodeSigning: true,
      multisigWallets: true,
      batchSync: true,
      payjoinSupport: true,
      batchTransactions: true,
      rbfTransactions: true,
      priceAlerts: false,
      aiAssistant: false,
      telegramNotifications: false,
      treasuryAutopilot: false,
      treasuryIntelligence: false,
      websocketV2Events: false,
      experimental: {
        taprootAddresses: false,
        silentPayments: false,
        coinJoin: false,
      },
    },
    // Legacy fields (still required by CombinedConfigSchema)
    nodeEnv: 'test',
    port: 3001,
    apiUrl: 'http://localhost:3001',
    clientUrl: 'http://localhost:3000',
    databaseUrl: 'postgresql://user:pass@localhost:5432/sanctuary',
    jwtSecret: 'x'.repeat(32),
    jwtExpiresIn: '1h',
    jwtRefreshExpiresIn: '7d',
    gatewaySecret: 'g'.repeat(32),
    corsAllowedOrigins: ['http://localhost:3000'],
  };
}

describe('Config Schema Validation', () => {
  it('accepts valid combined config', () => {
    const result = validateConfigSchema(buildValidConfig());

    expect(result).toEqual({
      success: true,
      errors: [],
    });
  });

  it('returns readable issue paths for invalid config', () => {
    const invalidConfig = buildValidConfig();
    invalidConfig.server.port = 70000;
    invalidConfig.security.jwt.secret = '';

    const result = validateConfigSchema(invalidConfig);

    expect(result.success).toBe(false);
    expect(result.errors.some(error => error.includes('server.port'))).toBe(true);
    expect(result.errors.some(error => error.includes('security.jwt.secret'))).toBe(true);
  });

  it('assertValidConfig does not throw for valid config', () => {
    expect(() => assertValidConfig(buildValidConfig())).not.toThrow();
  });

  it('assertValidConfig logs validation details and throws for invalid config', () => {
    const invalidConfig = buildValidConfig();
    invalidConfig.server.port = 0;
    invalidConfig.database.url = '';

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(() => assertValidConfig(invalidConfig)).toThrowError(
        /Configuration validation failed:/
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith('CONFIGURATION VALIDATION FAILED');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Please check your .env file')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('  • ')
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
