import { expect, it } from 'vitest';
import {
  AGENT_ALERT_SEVERITIES,
  AGENT_ALERT_STATUSES,
  AGENT_FUNDING_OVERRIDE_STATUSES,
  WALLET_AGENT_STATUSES,
} from '@sanctuary/shared/constants/adminAgents';
import {
  DEFAULT_NODE_MEMPOOL_ESTIMATOR,
  NODE_MEMPOOL_ESTIMATOR_VALUES,
} from '@sanctuary/shared/constants/nodeConfig';

import {
  openApiSpec,
  expectDocumentedMethod,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
  FEATURE_FLAG_KEYS,
} from './openapi.helpers';

import type {
  OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiAdminCoreTests() {
  it('documents admin version, settings, and feature flag routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/version', 'get'],
      ['/admin/settings', 'get'],
      ['/admin/settings', 'put'],
      ['/admin/features', 'get'],
      ['/admin/features/audit-log', 'get'],
      ['/admin/features/{key}', 'get'],
      ['/admin/features/{key}', 'patch'],
      ['/admin/features/{key}/reset', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/version'].get).not.toHaveProperty('security');
    expect(openApiSpec.paths['/admin/version'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminVersionResponse',
    });

    expect(openApiSpec.components.schemas.AdminSettings.properties.confirmationThreshold.default).toBe(
      DEFAULT_CONFIRMATION_THRESHOLD,
    );
    expect(openApiSpec.components.schemas.AdminSettings.properties['smtp.port'].default).toBe(DEFAULT_SMTP_PORT);
    expect(openApiSpec.components.schemas.AdminSettings.properties['smtp.fromName'].default).toBe(
      DEFAULT_SMTP_FROM_NAME,
    );
    expect(openApiSpec.components.schemas.AdminSettings.properties).not.toHaveProperty('smtp.password');
    expect(openApiSpec.components.schemas.AdminSettingsUpdateRequest.properties).toHaveProperty('smtp.password');
    expect(openApiSpec.paths['/admin/settings'].put.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminSettingsUpdateRequest',
    });

    expect(openApiSpec.components.schemas.AdminFeatureFlagKey.enum).toEqual([...FEATURE_FLAG_KEYS]);
    expect(openApiSpec.components.schemas.AdminFeatureFlag.properties.source.enum).toEqual([
      'environment',
      'database',
    ]);
    expect(openApiSpec.components.schemas.AdminUpdateFeatureFlagRequest.required).toEqual(['enabled']);
    expect(openApiSpec.components.schemas.AdminUpdateFeatureFlagRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.paths['/admin/features'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/AdminFeatureFlag' },
    });
    expect(openApiSpec.paths['/admin/features/audit-log'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({ maximum: 200, default: 50 }),
      }),
    );
    expect(openApiSpec.paths['/admin/features/{key}'].patch.parameters).toContainEqual(
      expect.objectContaining({
        name: 'key',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
      }),
    );
    expect(openApiSpec.paths['/admin/features/{key}'].patch.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateFeatureFlagRequest',
      });
  });

  it('documents admin backup, restore, encryption-key, and support-package routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/encryption-keys', 'post'],
      ['/admin/backup', 'post'],
      ['/admin/backup/validate', 'post'],
      ['/admin/restore', 'post'],
      ['/admin/support-package', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/encryption-keys'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminEncryptionKeysRequest',
      });
    expect(openApiSpec.components.schemas.AdminEncryptionKeysRequest.required).toEqual(['password']);
    expect(openApiSpec.components.schemas.AdminEncryptionKeysResponse.required).toEqual([
      'encryptionKey',
      'encryptionSalt',
      'hasEncryptionKey',
      'hasEncryptionSalt',
    ]);
    expect(openApiSpec.paths['/admin/encryption-keys'].post.responses[401].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });

    expect(openApiSpec.paths['/admin/backup'].post.requestBody).toMatchObject({
      required: false,
    });
    expect(openApiSpec.paths['/admin/backup'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminCreateBackupRequest',
    });
    expect(openApiSpec.paths['/admin/backup'].post.responses[200].headers).toHaveProperty('Content-Disposition');
    expect(openApiSpec.paths['/admin/backup'].post.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminSanctuaryBackup',
    });
    expect(openApiSpec.components.schemas.AdminCreateBackupRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminSanctuaryBackup.required).toEqual(['meta', 'data']);
    expect(openApiSpec.components.schemas.AdminBackupMeta.required).toEqual([
      'version',
      'appVersion',
      'schemaVersion',
      'createdAt',
      'createdBy',
      'includesCache',
      'recordCounts',
    ]);

    expect(openApiSpec.paths['/admin/backup/validate'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminBackupPayloadRequest',
      });
    expect(openApiSpec.components.schemas.AdminBackupPayloadRequest.required).toEqual(['backup']);
    expect(openApiSpec.paths['/admin/backup/validate'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminBackupValidationResponse',
      });
    expect(openApiSpec.components.schemas.AdminBackupValidationResponse.required).toEqual([
      'valid',
      'issues',
      'warnings',
      'info',
    ]);

    expect(openApiSpec.paths['/admin/restore'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminRestoreRequest',
    });
    expect(openApiSpec.components.schemas.AdminRestoreRequest.required).toEqual(['backup', 'confirmationCode']);
    expect(openApiSpec.components.schemas.AdminRestoreRequest.properties.confirmationCode).toMatchObject({
      enum: ['CONFIRM_RESTORE'],
    });
    expect(openApiSpec.paths['/admin/restore'].post.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminRestoreSuccessResponse',
    });
    expect(openApiSpec.paths['/admin/restore'].post.responses[400].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminRestoreInvalidBackupResponse',
      });
    expect(openApiSpec.paths['/admin/restore'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminRestoreFailedResponse',
      });

    const supportPackage = openApiSpec.paths['/admin/support-package'].post;
    expect(supportPackage.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/AdminSupportPackageRequest' },
        },
      },
    });
    expect(openApiSpec.components.schemas.AdminSupportPackageRequest).toEqual({
      type: 'object',
      properties: { confirmShareableAggregate: { type: 'boolean', enum: [true] } },
      required: ['confirmShareableAggregate'],
      additionalProperties: false,
    });
    expect(Object.keys(supportPackage.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '429',
      '503',
    ]);
    expect(supportPackage.responses[200].headers).toMatchObject({
      'Content-Disposition': expect.any(Object),
      'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
      'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
    });
    expect(supportPackage.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminSupportPackageV2',
    });
    expect(supportPackage.responses[429].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminSupportPackageBusyResponse',
    });
    expect(supportPackage.responses[503].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminSupportPackageUnavailableResponse',
    });
    expect(openApiSpec.components.schemas.AdminSupportPackageBusyResponse).toEqual({
      type: 'object',
      properties: {
        error: { type: 'string', enum: ['support_package_generation_in_progress'] },
      },
      required: ['error'],
      additionalProperties: false,
    });
    expect(openApiSpec.components.schemas.AdminSupportPackageUnavailableResponse).toEqual({
      type: 'object',
      properties: {
        error: { type: 'string', enum: ['support_package_unavailable'] },
        message: {
          type: 'string',
          enum: ['The privacy-safe support package could not be generated.'],
        },
      },
      required: ['error', 'message'],
      additionalProperties: false,
    });

    const packageSchema = openApiSpec.components.schemas.AdminSupportPackageV2;
    expect(packageSchema).toMatchObject({
      type: 'object',
      required: ['version', 'profile', 'generatedAt', 'serverVersion', 'collectors', 'meta'],
      additionalProperties: false,
    });
    expect(packageSchema.properties.version.enum).toEqual(['2.0.0']);
    expect(packageSchema.properties.profile.enum).toEqual(['shareable_aggregate']);
    expect(Object.keys(packageSchema.properties.collectors.properties).sort()).toEqual([
      'config',
      'notificationDeadLetters',
      'notificationEligibility',
      'notificationQueue',
      'notificationTelemetry',
      'notificationWorker',
      'notificationWorkerFleet',
    ]);
    expect(packageSchema.properties.collectors.additionalProperties).toBe(false);
    for (const section of Object.values(packageSchema.properties.collectors.properties)) {
      expect(section.oneOf).toHaveLength(2);
      expect(section.oneOf[0]).toMatchObject({
        required: ['status', 'durationMs', 'truncated', 'droppedCount', 'provenance', 'data'],
        additionalProperties: false,
      });
      expect(section.oneOf[1]).toMatchObject({
        required: ['status', 'durationMs', 'truncated', 'droppedCount', 'provenance', 'error'],
        additionalProperties: false,
      });
    }

    const unavailableStates = ['unavailable', 'timeout', 'unsupported'];
    expect(
      openApiSpec.components.schemas.SupportNotificationQueue.properties.paused.oneOf[1]
        .properties.status.enum,
    ).toEqual(unavailableStates);
    const waitingState =
      openApiSpec.components.schemas.SupportNotificationQueue.properties.states.properties.waiting;
    expect(waitingState.properties.count.oneOf[1].properties.status.enum).toEqual(
      unavailableStates,
    );
    expect(waitingState.properties.oldestAge.oneOf[1].properties.status.enum).toEqual(
      unavailableStates,
    );
    expect(
      openApiSpec.components.schemas.SupportNotificationWorker.oneOf[1].properties.status.enum,
    ).toEqual(unavailableStates);
    const workerSnapshot =
      openApiSpec.components.schemas.SupportNotificationWorker.oneOf[0].properties.value;
    expect(workerSnapshot.required).toContain('notificationTelemetryWriter');
    expect(workerSnapshot.properties.database.properties.state.enum).toEqual([
      'connected',
      'disconnected',
      'unknown',
    ]);
    expect(workerSnapshot.properties.telegram.required).toEqual([
      'circuitState',
      'failures',
      'totalRequests',
      'lastFailureAge',
      'lastSuccessAge',
      'lastFailureClass',
    ]);
    expect(workerSnapshot.properties.telegram.properties.lastSuccessAge.enum).toEqual([
      'never', '<1m', '1m-15m', '15m-1h', '1h-24h', '1d+',
    ]);
    expect(workerSnapshot.properties.telegram.properties.lastFailureClass.enum).toEqual([
      'none',
      'invalid_configuration',
      'authentication',
      'permission',
      'rate_limited',
      'provider_rejected',
      'provider_unavailable',
      'timeout',
      'circuit_open',
      'network',
      'unknown',
      'other',
    ]);
    expect(workerSnapshot.properties.notificationTelemetryWriter.oneOf[0]).toMatchObject({
      required: ['observation', 'circuit', 'droppedEvents'],
      additionalProperties: false,
    });
    expect(
      packageSchema.properties.collectors.properties.config.oneOf[0].properties.provenance
        .properties.authoritativeFor.items.enum,
    ).toEqual([
      'static_notification_configuration',
      'effective_notification_configuration',
      'notification_queue',
      'worker_notification_capability',
      'worker_delivery_aggregates',
      'worker_delivery',
    ]);

    const queueRetention =
      openApiSpec.components.schemas.SupportNotificationQueue.properties.retention;
    expect(queueRetention).toMatchObject({
      required: ['contractVersion', 'producerCompatibility', 'families'],
      additionalProperties: false,
    });
    expect(Object.keys(queueRetention.properties.families.properties).sort()).toEqual([
      'consolidation',
      'draft',
      'transaction',
      'webhook',
    ]);
    expect(
      queueRetention.properties.families.properties.transaction.properties.completed.oneOf,
    ).toHaveLength(2);

    expect(openApiSpec.components.schemas.SupportNotificationDeadLetters).toMatchObject({
      type: 'object',
      required: [
        'version',
        'observation',
        'coverage',
        'retention',
        'records',
        'truncated',
        'droppedDimensionBucket',
      ],
      additionalProperties: false,
    });
    expect(
      openApiSpec.components.schemas.SupportNotificationDeadLetters.properties.coverage.enum,
    ).toEqual(['degraded', 'unavailable']);
    expect(
      openApiSpec.components.schemas.SupportNotificationDeadLetters.properties.records.maxItems,
    ).toBe(128);

    const eligibility = openApiSpec.components.schemas.SupportNotificationEligibility.oneOf[0];
    expect(eligibility).toMatchObject({
      required: [
        'observation',
        'unit',
        'telegramUsers',
        'eligibleWallets',
        'disabledDirectionWallets',
        'enabledUsersWithoutWalletSettings',
        'missingCredentialUsers',
        'orphanedWalletSettings',
      ],
      additionalProperties: false,
    });
    expect(Object.keys(eligibility.properties.telegramUsers.properties).sort()).toEqual([
      'configured',
      'enabled',
    ]);
    expect(
      Object.keys(eligibility.properties.disabledDirectionWallets.properties).sort(),
    ).toEqual(['consolidation', 'draft', 'received', 'sent']);

    const telemetry = openApiSpec.components.schemas.SupportNotificationTelemetry;
    expect(telemetry.required).toEqual(['version', 'localWriter', 'windows']);
    expect(telemetry.properties.localWriter.oneOf[0]).toMatchObject({
      required: ['observation', 'circuit', 'droppedEvents'],
      additionalProperties: false,
    });
    const fiveMinuteWindow = telemetry.properties.windows.properties.fiveMinutes;
    expect(fiveMinuteWindow.required).toContain('sources');
    expect(fiveMinuteWindow.properties.sources).toMatchObject({
      required: ['api', 'worker'],
      additionalProperties: false,
    });
    expect(fiveMinuteWindow.properties.sources.properties.api.oneOf[0]).toMatchObject({
      required: [
        'observation',
        'attendance',
        'observedBuckets',
        'attestedEmitterCount',
        'oldestObservationAge',
        'newestObservationAge',
      ],
      additionalProperties: false,
    });

    const fleet = openApiSpec.components.schemas.SupportNotificationWorkerFleet;
    expect(fleet.oneOf).toHaveLength(2);
    expect(fleet.oneOf[0]).toMatchObject({
      required: [
        'version',
        'observation',
        'coverage',
        'workerCount',
        'oldestHeartbeatAge',
        'restartObserved',
        'notificationConsumer',
        'transactionHandler',
        'telemetryWriterCircuit',
        'telemetryDroppedEvents',
        'telegramCircuit',
        'telegramLastSuccessAge',
        'telegramLastFailureAge',
        'telegramFailureClass',
        'retentionContract',
      ],
      additionalProperties: false,
    });
    expect(fleet.oneOf[0].properties).not.toHaveProperty('mixedBootEpochs');
    expect(fleet.oneOf[1]).toMatchObject({
      required: ['version', 'observation', 'coverage'],
      additionalProperties: false,
    });
    expect(Object.keys(fleet.oneOf[1].properties).sort()).toEqual([
      'coverage',
      'observation',
      'version',
    ]);
    expect(
      fleet.oneOf[0].properties.retentionContract.enum,
    ).toEqual(['uniform', 'mixed_version', 'unknown']);
    expect(fleet.oneOf[0].properties.telemetryWriterCircuit.enum).toEqual([
      'all_closed',
      'any_open',
      'mixed_or_unknown',
    ]);
    expect(fleet.oneOf[0].properties.telemetryDroppedEvents.enum).toEqual([
      'none',
      'some',
      'mixed_or_unknown',
    ]);
    expect(fleet.oneOf[0].properties.telegramLastSuccessAge.enum).toEqual([
      'never', '<1m', '1m-15m', '15m-1h', '1h-24h', '1d+', 'mixed_or_unknown',
    ]);
    expect(fleet.oneOf[0].properties.telegramFailureClass.enum).toEqual([
      'none',
      'invalid_configuration',
      'authentication',
      'permission',
      'rate_limited',
      'provider_rejected',
      'provider_unavailable',
      'timeout',
      'circuit_open',
      'network',
      'unknown',
      'other',
      'mixed_or_unknown',
    ]);
  });

  it('documents admin node config and proxy test routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/node-config', 'get'],
      ['/admin/node-config', 'put'],
      ['/admin/node-config/test', 'post'],
      ['/admin/proxy/test', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminNodeConfig.required).toEqual([
      'type',
      'host',
      'port',
      'useSsl',
      'allowSelfSignedCert',
      'explorerUrl',
      'feeEstimatorUrl',
      'testnet3ExplorerUrl',
      'testnet3FeeEstimatorUrl',
      'testnet4ExplorerUrl',
      'testnet4FeeEstimatorUrl',
      'signetExplorerUrl',
      'signetFeeEstimatorUrl',
      'mempoolEstimator',
      'poolEnabled',
      'poolMinConnections',
      'poolMaxConnections',
      'poolLoadBalancing',
      'servers',
    ]);
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.type.enum).toEqual(['electrum']);
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.mempoolEstimator.enum).toEqual([
      ...NODE_MEMPOOL_ESTIMATOR_VALUES,
    ]);
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.mempoolEstimator.default).toBe(
      DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    );
    expect(
      openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.mempoolEstimator.enum,
    ).toEqual([...NODE_MEMPOOL_ESTIMATOR_VALUES]);
    expect(
      openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.mempoolEstimator.default,
    ).toBe(DEFAULT_NODE_MEMPOOL_ESTIMATOR);
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.port).toEqual({ type: 'string' });
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.proxyPassword).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.servers.items).toEqual({
      $ref: '#/components/schemas/AdminElectrumServer',
    });
    expect(openApiSpec.components.schemas.AdminElectrumServer.required).toEqual([
      'id',
      'host',
      'port',
      'priority',
    ]);

    expect(openApiSpec.paths['/admin/node-config'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminNodeConfig',
      });
    expect(openApiSpec.paths['/admin/node-config'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminNodeConfigUpdateRequest',
      });
    expect(openApiSpec.paths['/admin/node-config'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminNodeConfigUpdateResponse',
      });

    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.required).toEqual([
      'type',
      'host',
      'port',
    ]);
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'integer',
        minimum: 1,
        maximum: 65535,
      });
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'string',
        pattern: '^\\d+$',
      });
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.mainnetPoolMin).toMatchObject({
      nullable: true,
      oneOf: expect.arrayContaining([
        {
          type: 'string',
          pattern: '^\\d+$',
        },
      ]),
    });
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateRequest.properties.servers.items).toEqual({
      $ref: '#/components/schemas/AdminElectrumServer',
    });
    expect(openApiSpec.components.schemas.AdminNodeConfigUpdateResponse.allOf).toContainEqual({
      $ref: '#/components/schemas/AdminNodeConfig',
    });

    expect(openApiSpec.paths['/admin/node-config/test'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminNodeConfigTestRequest',
      });
    expect(openApiSpec.components.schemas.AdminNodeConfigTestRequest.required).toEqual([
      'type',
      'host',
      'port',
    ]);
    expect(openApiSpec.components.schemas.AdminNodeConfigTestRequest.properties.type.enum).toEqual(['electrum']);
    expect(openApiSpec.components.schemas.AdminNodeConfigTestRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'string',
        pattern: '^\\d+$',
      });
    expect(openApiSpec.components.schemas.AdminNodeConfigTestRequest.properties.network).toMatchObject({
      enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
    });
    expect(openApiSpec.paths['/admin/node-config/test'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminNodeConfigTestSuccessResponse',
      });
    expect(openApiSpec.paths['/admin/node-config/test'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminNodeConfigTestFailedResponse',
      });
    expect(openApiSpec.paths['/admin/node-config/test'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/ApiError',
      });
    expect(openApiSpec.components.schemas.AdminNodeConfigTestFailedResponse.properties.error.enum)
      .toEqual(['Connection Failed']);

    expect(openApiSpec.paths['/admin/proxy/test'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminProxyTestRequest',
      });
    expect(openApiSpec.components.schemas.AdminProxyTestRequest.required).toEqual(['host', 'port']);
    expect(openApiSpec.components.schemas.AdminProxyTestRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'integer',
        minimum: 1,
        maximum: 65535,
      });
    expect(openApiSpec.components.schemas.AdminProxyTestRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'string',
        pattern: '^\\d+$',
      });
    expect(openApiSpec.paths['/admin/proxy/test'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminProxyTestSuccessResponse',
      });
    expect(openApiSpec.paths['/admin/proxy/test'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminProxyTestFailedResponse',
      });
    expect(openApiSpec.paths['/admin/proxy/test'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/ApiError',
      });
    expect(openApiSpec.components.schemas.AdminProxyTestSuccessResponse.required).toEqual([
      'success',
      'message',
      'exitIp',
      'isTorExit',
    ]);
    expect(openApiSpec.components.schemas.AdminProxyTestFailedResponse.properties.error.enum)
      .toEqual(['Tor Verification Failed']);
  });

  it('documents admin wallet-agent values from shared constants', () => {
    expect(openApiSpec.components.schemas.AdminWalletAgent.properties.status.enum).toBe(WALLET_AGENT_STATUSES);
    expect(openApiSpec.components.schemas.AdminCreateWalletAgentRequest.properties.status.enum).toBe(
      WALLET_AGENT_STATUSES,
    );
    expect(openApiSpec.components.schemas.AdminUpdateWalletAgentRequest.properties.status.enum).toBe(
      WALLET_AGENT_STATUSES,
    );
    expect(openApiSpec.components.schemas.AdminAgentAlert.properties.severity.enum).toBe(AGENT_ALERT_SEVERITIES);
    expect(openApiSpec.components.schemas.AdminAgentAlert.properties.status.enum).toBe(AGENT_ALERT_STATUSES);
    expect(openApiSpec.paths['/admin/agents/{agentId}/alerts'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'status',
        schema: expect.objectContaining({ enum: AGENT_ALERT_STATUSES }),
      }),
    );
    expect(openApiSpec.components.schemas.AdminAgentFundingOverride.properties.status.enum).toBe(
      AGENT_FUNDING_OVERRIDE_STATUSES,
    );
    expect(openApiSpec.paths['/admin/agents/{agentId}/overrides'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'status',
        schema: expect.objectContaining({ enum: AGENT_FUNDING_OVERRIDE_STATUSES }),
      }),
    );
  });

  it('documents admin Electrum server routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/electrum-servers', 'get'],
      ['/admin/electrum-servers', 'post'],
      ['/admin/electrum-servers/test-connection', 'post'],
      ['/admin/electrum-servers/reorder', 'put'],
      ['/admin/electrum-servers/{networkOrServerId}', 'get'],
      ['/admin/electrum-servers/{networkOrServerId}', 'put'],
      ['/admin/electrum-servers/{networkOrServerId}', 'delete'],
      ['/admin/electrum-servers/{serverId}/test', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths).not.toHaveProperty('/admin/electrum-servers/{network}');
    expect(openApiSpec.paths).not.toHaveProperty('/admin/electrum-servers/{serverId}');

    expect(openApiSpec.paths['/admin/electrum-servers'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'network',
        in: 'query',
        schema: expect.objectContaining({
          enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/electrum-servers'].get.responses[200].content['application/json'].schema)
      .toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/AdminElectrumServer' },
      });

    expect(openApiSpec.components.schemas.AdminElectrumServer.properties.network.enum).toEqual([
      'mainnet',
      'testnet3',
      'testnet4',
      'signet',
      'regtest',
    ]);
    expect(openApiSpec.components.schemas.AdminCreateElectrumServerRequest.required).toEqual([
      'label',
      'host',
      'port',
    ]);
    expect(openApiSpec.components.schemas.AdminCreateElectrumServerRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminCreateElectrumServerRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'string',
        pattern: '^\\d+$',
      });
    expect(openApiSpec.components.schemas.AdminCreateElectrumServerRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'integer',
        minimum: 1,
        maximum: 65535,
      });
    expect(openApiSpec.components.schemas.AdminCreateElectrumServerRequest.properties.network).toMatchObject({
      enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
      default: 'mainnet',
    });
    expect(openApiSpec.paths['/admin/electrum-servers'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminCreateElectrumServerRequest',
      });
    expect(openApiSpec.paths['/admin/electrum-servers'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminElectrumServer',
      });
    expect(openApiSpec.paths['/admin/electrum-servers'].post.responses).toHaveProperty('409');

    expect(openApiSpec.paths['/admin/electrum-servers/test-connection'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminElectrumConnectionTestRequest',
      });
    expect(openApiSpec.components.schemas.AdminElectrumConnectionTestRequest.required).toEqual([
      'host',
      'port',
    ]);
    expect(openApiSpec.components.schemas.AdminElectrumConnectionTestRequest.properties.port.oneOf)
      .toContainEqual({
        type: 'string',
        pattern: '^\\d+$',
      });
    expect(openApiSpec.components.schemas.AdminElectrumConnectionTestRequest.properties.network).toMatchObject({
      enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
    });
    expect(openApiSpec.paths['/admin/electrum-servers/test-connection'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminElectrumConnectionTestResponse',
      });
    expect(openApiSpec.components.schemas.AdminElectrumConnectionTestResponse.required).toEqual([
      'success',
      'message',
    ]);

    expect(openApiSpec.paths['/admin/electrum-servers/reorder'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminReorderElectrumServersRequest',
      });
    expect(openApiSpec.components.schemas.AdminReorderElectrumServersRequest.required).toEqual([
      'serverIds',
    ]);
    expect(openApiSpec.components.schemas.AdminReorderElectrumServersRequest.properties.serverIds.items)
      .toEqual({
        type: 'string',
      });
    expect(openApiSpec.paths['/admin/electrum-servers/reorder'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminReorderElectrumServersResponse',
      });

    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].get.parameters)
      .toContainEqual(
        expect.objectContaining({
          name: 'networkOrServerId',
          in: 'path',
          required: true,
          schema: expect.objectContaining({
            enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
          }),
        }),
      );
    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].get.responses[200].content['application/json'].schema)
      .toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/AdminElectrumServer' },
      });

    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].put.parameters)
      .toContainEqual(
        expect.objectContaining({
          name: 'networkOrServerId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }),
      );
    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateElectrumServerRequest',
      });
    expect(openApiSpec.components.schemas.AdminUpdateElectrumServerRequest.required).toBeUndefined();
    expect(openApiSpec.components.schemas.AdminUpdateElectrumServerRequest.properties.network.enum).toEqual([
      'mainnet',
      'testnet3',
      'testnet4',
      'signet',
      'regtest',
    ]);
    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminElectrumServer',
      });
    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].put.responses).toHaveProperty('404');
    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].put.responses).toHaveProperty('409');

    expect(openApiSpec.paths['/admin/electrum-servers/{networkOrServerId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeleteElectrumServerResponse',
      });
    expect(openApiSpec.components.schemas.AdminDeleteElectrumServerResponse.required).toEqual([
      'success',
      'message',
    ]);

    expect(openApiSpec.paths['/admin/electrum-servers/{serverId}/test'].post.parameters)
      .toContainEqual(
        expect.objectContaining({
          name: 'serverId',
          in: 'path',
          required: true,
        }),
      );
    expect(openApiSpec.paths['/admin/electrum-servers/{serverId}/test'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminElectrumServerTestResponse',
      });
    expect(openApiSpec.components.schemas.AdminElectrumServerTestResponse.required).toEqual([
      'success',
      'message',
    ]);
    expect(openApiSpec.components.schemas.AdminElectrumServerTestResponse.properties.info).toEqual({
      $ref: '#/components/schemas/AdminElectrumServerTestInfo',
    });
    expect(openApiSpec.components.schemas.AdminElectrumServerTestInfo).toHaveProperty(
      'additionalProperties',
      true,
    );
  });
}
