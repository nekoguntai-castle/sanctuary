import openApiRouter, { openApiSpec } from '../../../src/api/openapi';
import {
  MOBILE_ACTIONS,
  MOBILE_API_REQUEST_LIMITS,
  MOBILE_DEVICE_ACCOUNT_PURPOSES,
  MOBILE_DEVICE_SCRIPT_TYPES,
  MOBILE_DRAFT_STATUS_VALUES,
} from '../../../../shared/schemas/mobileApiRequests';
import {
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_ROLE_FILTER_VALUES,
  TRANSFER_STATUS_FILTER_VALUES,
  TRANSFER_STATUS_VALUES,
} from '../../../src/services/transferService/types';
import {
  INSIGHT_SEVERITY_VALUES,
  INSIGHT_STATUS_VALUES,
  INSIGHT_TYPE_VALUES,
  INSIGHT_UPDATE_STATUS_VALUES,
  INTELLIGENCE_ENDPOINT_TYPE_VALUES,
  INTELLIGENCE_MESSAGE_ROLE_VALUES,
} from '../../../src/services/intelligence/types';
import {
  AI_QUERY_AGGREGATION_VALUES,
  AI_QUERY_RESULT_TYPES,
  AI_QUERY_SORT_ORDERS,
} from '../../../src/services/ai/types';
import {
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
} from '../../../src/services/wallet/types';

type HandlerResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
};

const invokeRoute = (method: string, url: string) => new Promise<HandlerResponse>((resolve, reject) => {
  const req = { method, url } as any;
  const res: any = {
    statusCode: 200,
    headers: {},
    setHeader: (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    send: (body?: unknown) => {
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
    json: (body: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
  };

  openApiRouter.handle(req, res, (err?: Error) => {
    if (err) {
      reject(err);
      return;
    }
    reject(new Error(`Route not handled: ${method} ${url}`));
  });
});

type OpenApiPathKey = keyof typeof openApiSpec.paths;

function expectDocumentedMethod(path: OpenApiPathKey, method: string) {
  const pathItem = openApiSpec.paths[path] as Record<string, unknown>;
  expect(pathItem).toBeDefined();
  expect(pathItem[method.toLowerCase()]).toBeDefined();
}

describe('OpenAPI Docs', () => {
  it('serves Swagger UI html', async () => {
    const response = await invokeRoute('GET', '/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(String(response.body)).toContain('swagger-ui-bundle.js');
    expect(String(response.body)).toContain('/api/v1/docs/openapi.json');
  });

  it('serves OpenAPI spec json', async () => {
    const response = await invokeRoute('GET', '/openapi.json');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.body as { openapi?: string; info?: { title?: string } };
    expect(body.openapi).toBe('3.0.3');
    expect(body.info?.title).toBe('Sanctuary API');
  });

  it('exports spec with core paths', () => {
    expect(openApiSpec.paths['/auth/login']).toBeDefined();
    expect(openApiSpec.paths['/wallets']).toBeDefined();
  });

  it('documents wallet delete as a 204 empty response', () => {
    const deleteResponses = openApiSpec.paths['/wallets/{walletId}'].delete.responses;

    expect(deleteResponses).toHaveProperty('204');
    expect(deleteResponses).not.toHaveProperty('200');
    expect(deleteResponses[204]).not.toHaveProperty('content');
  });

  it('documents wallet sharing routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/share', 'get'],
      ['/wallets/{walletId}/share/group', 'post'],
      ['/wallets/{walletId}/share/user', 'post'],
      ['/wallets/{walletId}/share/user/{targetUserId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.Wallet.properties.role.enum).toEqual([...WALLET_ROLE_VALUES]);
    expect(openApiSpec.components.schemas.WalletShareRole.enum).toEqual([...WALLET_SHARE_ROLE_VALUES]);
    expect(openApiSpec.components.schemas.WalletShareUserRequest.required).toEqual(['targetUserId']);
    expect(openApiSpec.components.schemas.WalletShareUserRequest.properties.role).toEqual({
      $ref: '#/components/schemas/WalletShareRole',
    });
    expect(openApiSpec.components.schemas.WalletShareGroupRequest.properties.groupId).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.WalletSharedUser.properties.role.enum).toEqual([
      ...WALLET_ROLE_VALUES,
    ]);

    expect(openApiSpec.paths['/wallets/{walletId}/share/user'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletShareUserResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/share/user'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletShareUserResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/share'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletSharingInfo',
      });
  });

  it('documents implemented device item routes', () => {
    const deviceItemPath = openApiSpec.paths['/devices/{deviceId}'];

    expect(deviceItemPath.get).toBeDefined();
    expect(deviceItemPath.patch).toBeDefined();
    expect(deviceItemPath.delete).toBeDefined();

    for (const method of ['get', 'patch', 'delete'] as const) {
      expect(deviceItemPath[method].parameters).toContainEqual(
        expect.objectContaining({
          name: 'deviceId',
          in: 'path',
          required: true,
        }),
      );
    }
  });

  it('documents device create merge and conflict statuses', () => {
    const createResponses = openApiSpec.paths['/devices'].post.responses;
    const createSchema = openApiSpec.components.schemas.CreateDeviceRequest;

    expect(createResponses).toHaveProperty('201');
    expect(createResponses).toHaveProperty('200');
    expect(createResponses).toHaveProperty('409');
    expect(createResponses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DeviceMergeResponse',
    });
    expect(createResponses[409].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DeviceConflictResponse',
    });
    expect(createSchema.required).toEqual(expect.arrayContaining(['type', 'label', 'fingerprint']));
    expect(createSchema.properties).toHaveProperty('accounts');
    expect(createSchema.properties).toHaveProperty('merge');
    expect(createSchema.properties).toHaveProperty('modelSlug');
    expect(openApiSpec.components.schemas.DeviceAccountInput.properties.purpose.enum).toEqual([
      ...MOBILE_DEVICE_ACCOUNT_PURPOSES,
    ]);
    expect(openApiSpec.components.schemas.DeviceAccountInput.properties.scriptType.enum).toEqual([
      ...MOBILE_DEVICE_SCRIPT_TYPES,
    ]);
  });

  it('documents device delete as 204 with not-found and conflict errors', () => {
    const deleteResponses = openApiSpec.paths['/devices/{deviceId}'].delete.responses;

    expect(deleteResponses).toHaveProperty('204');
    expect(deleteResponses[204]).not.toHaveProperty('content');
    expect(deleteResponses[404].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ApiError',
    });
    expect(deleteResponses[409].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ApiError',
    });
  });

  it('exports device schemas used by the item route contracts', () => {
    expect(openApiSpec.components.schemas.UpdateDeviceRequest).toBeDefined();
    expect(openApiSpec.components.schemas.DeviceMergeResponse).toBeDefined();
    expect(openApiSpec.components.schemas.DeviceConflictResponse).toBeDefined();
  });

  it('documents gateway-exposed auth and session routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/auth/logout', 'post'],
      ['/auth/logout-all', 'post'],
      ['/auth/2fa/verify', 'post'],
      ['/auth/me', 'get'],
      ['/auth/me/preferences', 'patch'],
      ['/auth/sessions', 'get'],
      ['/auth/sessions/{id}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.RefreshTokenRequest).toBeDefined();
    expect(openApiSpec.components.schemas.TwoFactorVerifyRequest).toBeDefined();
    expect(openApiSpec.components.schemas.SessionsResponse).toBeDefined();

    const loginSchema = openApiSpec.components.schemas.LoginRequest;
    expect(loginSchema.properties.username).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.usernameMinLength,
      maxLength: MOBILE_API_REQUEST_LIMITS.usernameMaxLength,
    });
    expect(loginSchema.properties.password).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.loginPasswordMinLength,
    });
  });

  it('documents gateway-exposed transaction routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/transactions', 'get'],
      ['/transactions/{txid}', 'get'],
      ['/transactions/pending', 'get'],
      ['/wallets/{walletId}/transactions/create', 'post'],
      ['/wallets/{walletId}/transactions/estimate', 'post'],
      ['/wallets/{walletId}/transactions/broadcast', 'post'],
      ['/wallets/{walletId}/psbt/create', 'post'],
      ['/wallets/{walletId}/psbt/broadcast', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.TransactionCreateRequest).toBeDefined();
    expect(openApiSpec.components.schemas.TransactionCreateRequest.properties.feeRate.minimum).toBe(
      MOBILE_API_REQUEST_LIMITS.minFeeRate
    );
    expect(openApiSpec.components.schemas.TransactionEstimateRequest.properties.feeRate.minimum).toBe(
      MOBILE_API_REQUEST_LIMITS.minFeeRate
    );
    expect(openApiSpec.components.schemas.PsbtCreateRequest.properties.feeRate.minimum).toBe(
      MOBILE_API_REQUEST_LIMITS.minFeeRate
    );
    expect(openApiSpec.components.schemas.TransactionBroadcastRequest).toBeDefined();
    expect(openApiSpec.components.schemas.PsbtBroadcastResponse).toBeDefined();
  });

  it('documents gateway-exposed wallet resource, label, and draft routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/sync/wallet/{walletId}', 'post'],
      ['/bitcoin/status', 'get'],
      ['/wallets/{walletId}/addresses/summary', 'get'],
      ['/wallets/{walletId}/addresses', 'get'],
      ['/wallets/{walletId}/addresses/generate', 'post'],
      ['/wallets/{walletId}/utxos', 'get'],
      ['/wallets/{walletId}/labels', 'get'],
      ['/wallets/{walletId}/labels', 'post'],
      ['/wallets/{walletId}/labels/{labelId}', 'put'],
      ['/wallets/{walletId}/labels/{labelId}', 'delete'],
      ['/wallets/{walletId}/drafts', 'get'],
      ['/wallets/{walletId}/drafts/{draftId}', 'get'],
      ['/wallets/{walletId}/drafts/{draftId}', 'patch'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.BitcoinStatus).toBeDefined();
    expect(openApiSpec.components.schemas.AddressSummary).toBeDefined();
    expect(openApiSpec.components.schemas.UtxosResponse).toBeDefined();
    expect(openApiSpec.components.schemas.CreateLabelRequest).toBeDefined();
    expect(openApiSpec.components.schemas.CreateLabelRequest.properties.name).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.labelNameMinLength,
      maxLength: MOBILE_API_REQUEST_LIMITS.labelNameMaxLength,
    });
    expect(openApiSpec.components.schemas.DraftTransaction).toBeDefined();
    expect(openApiSpec.components.schemas.UpdateDraftRequest.properties.status.enum).toEqual([
      ...MOBILE_DRAFT_STATUS_VALUES,
    ]);
    expect(openApiSpec.components.schemas.UpdateDraftRequest).toHaveProperty('additionalProperties', false);
  });

  it('documents gateway-exposed push routes without internal gateway routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/push/register', 'post'],
      ['/push/unregister', 'delete'],
      ['/push/devices', 'get'],
      ['/push/devices/{id}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths).not.toHaveProperty('/push/by-user/{userId}');
    expect(openApiSpec.paths).not.toHaveProperty('/push/gateway-audit');
    expect(openApiSpec.components.schemas.PushRegisterRequest).toBeDefined();
    expect(openApiSpec.components.schemas.PushRegisterRequest.properties.token).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength,
      maxLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength,
    });
    expect(openApiSpec.components.schemas.PushUnregisterRequest.properties.token).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength,
      maxLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength,
    });
    expect(openApiSpec.components.schemas.PushDevicesResponse).toBeDefined();
  });

  it('documents gateway-exposed mobile permission routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/mobile-permissions', 'get'],
      ['/wallets/{walletId}/mobile-permissions', 'get'],
      ['/wallets/{walletId}/mobile-permissions', 'patch'],
      ['/wallets/{walletId}/mobile-permissions', 'delete'],
      ['/wallets/{walletId}/mobile-permissions/{userId}', 'patch'],
      ['/wallets/{walletId}/mobile-permissions/{userId}/caps', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    const updateSchema = openApiSpec.components.schemas.MobilePermissionUpdateRequest;
    for (const action of MOBILE_ACTIONS) {
      expect(updateSchema.properties).toHaveProperty(action);
    }
    expect(updateSchema).toHaveProperty('additionalProperties', false);
    expect(updateSchema).toHaveProperty('minProperties', 1);
    expect(openApiSpec.components.schemas.MobilePermissionUpdateResponse).toBeDefined();
  });

  it('documents Payjoin management and BIP78 receiver routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/payjoin/status', 'get'],
      ['/payjoin/eligibility/{walletId}', 'get'],
      ['/payjoin/address/{addressId}/uri', 'get'],
      ['/payjoin/parse-uri', 'post'],
      ['/payjoin/attempt', 'post'],
      ['/payjoin/{addressId}', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.PayjoinStatusResponse).toBeDefined();
    expect(openApiSpec.components.schemas.PayjoinEligibilityResponse.properties.status.enum).toEqual([
      'ready',
      'no-utxos',
      'all-frozen',
      'pending-confirmations',
      'all-locked',
      'unavailable',
    ]);
    expect(openApiSpec.components.schemas.PayjoinAttemptRequest.properties.network.enum).toEqual([
      'mainnet',
      'testnet',
      'regtest',
    ]);
    expect(openApiSpec.components.schemas.PayjoinReceiverError.enum).toEqual([
      'version-unsupported',
      'unavailable',
      'not-enough-money',
      'original-psbt-rejected',
      'receiver-error',
    ]);

    const receiverPath = openApiSpec.paths['/payjoin/{addressId}'].post;
    expect(receiverPath).not.toHaveProperty('security');
    expect(receiverPath.requestBody.content['text/plain'].schema).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(receiverPath.responses[200].content['text/plain'].schema).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(receiverPath.responses[400].content['text/plain'].schema).toEqual({
      $ref: '#/components/schemas/PayjoinReceiverError',
    });
  });

  it('documents ownership transfer routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/transfers', 'get'],
      ['/transfers', 'post'],
      ['/transfers/counts', 'get'],
      ['/transfers/{id}', 'get'],
      ['/transfers/{id}/accept', 'post'],
      ['/transfers/{id}/decline', 'post'],
      ['/transfers/{id}/cancel', 'post'],
      ['/transfers/{id}/confirm', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    const transferSchema = openApiSpec.components.schemas.OwnershipTransfer;
    expect(transferSchema.properties.resourceType.enum).toEqual([...TRANSFER_RESOURCE_TYPES]);
    expect(transferSchema.properties.status.enum).toEqual([...TRANSFER_STATUS_VALUES]);
    expect(transferSchema.required).toEqual(expect.arrayContaining([
      'id',
      'resourceType',
      'resourceId',
      'fromUserId',
      'toUserId',
      'status',
      'createdAt',
      'expiresAt',
      'keepExistingUsers',
    ]));

    const createSchema = openApiSpec.components.schemas.TransferCreateRequest;
    expect(createSchema.required).toEqual(['resourceType', 'resourceId', 'toUserId']);
    expect(createSchema.properties.resourceType.enum).toEqual([...TRANSFER_RESOURCE_TYPES]);

    const listParameters = openApiSpec.paths['/transfers'].get.parameters;
    expect(listParameters).toContainEqual(expect.objectContaining({
      name: 'role',
      schema: expect.objectContaining({ enum: [...TRANSFER_ROLE_FILTER_VALUES] }),
    }));
    expect(listParameters).toContainEqual(expect.objectContaining({
      name: 'status',
      schema: expect.objectContaining({ enum: [...TRANSFER_STATUS_FILTER_VALUES] }),
    }));

    expect(openApiSpec.paths['/transfers'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/OwnershipTransfer',
    });
    expect(openApiSpec.paths['/transfers/counts'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TransferCountsResponse',
    });
    expect(openApiSpec.paths['/transfers/{id}/decline'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TransferDeclineRequest',
    });
  });

  it('documents Treasury Intelligence routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/intelligence/status', 'get'],
      ['/intelligence/insights', 'get'],
      ['/intelligence/insights/count', 'get'],
      ['/intelligence/insights/{id}', 'patch'],
      ['/intelligence/conversations', 'get'],
      ['/intelligence/conversations', 'post'],
      ['/intelligence/conversations/{id}/messages', 'get'],
      ['/intelligence/conversations/{id}/messages', 'post'],
      ['/intelligence/conversations/{id}', 'delete'],
      ['/intelligence/settings/{walletId}', 'get'],
      ['/intelligence/settings/{walletId}', 'patch'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    const insightSchema = openApiSpec.components.schemas.IntelligenceInsight;
    expect(openApiSpec.components.schemas.IntelligenceStatusResponse.properties.endpointType.enum).toEqual([
      ...INTELLIGENCE_ENDPOINT_TYPE_VALUES,
    ]);
    expect(insightSchema.properties.type.enum).toEqual([...INSIGHT_TYPE_VALUES]);
    expect(insightSchema.properties.severity.enum).toEqual([...INSIGHT_SEVERITY_VALUES]);
    expect(insightSchema.properties.status.enum).toEqual([...INSIGHT_STATUS_VALUES]);

    expect(openApiSpec.components.schemas.IntelligenceUpdateInsightRequest.properties.status.enum).toEqual([
      ...INSIGHT_UPDATE_STATUS_VALUES,
    ]);
    expect(openApiSpec.components.schemas.IntelligenceMessage.properties.role.enum).toEqual([
      ...INTELLIGENCE_MESSAGE_ROLE_VALUES,
    ]);
    expect(openApiSpec.components.schemas.IntelligenceSettings.properties.typeFilter.items.enum).toEqual([
      ...INSIGHT_TYPE_VALUES,
    ]);

    const insightParameters = openApiSpec.paths['/intelligence/insights'].get.parameters;
    expect(insightParameters).toContainEqual(expect.objectContaining({
      name: 'walletId',
      in: 'query',
      required: true,
    }));
    expect(insightParameters).toContainEqual(expect.objectContaining({
      name: 'limit',
      schema: expect.objectContaining({ maximum: 100, default: 50 }),
    }));
    expect(openApiSpec.paths['/intelligence/conversations'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'limit',
      schema: expect.objectContaining({ default: 20 }),
    }));

    expect(
      openApiSpec.paths['/intelligence/conversations/{id}/messages'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/IntelligenceSendMessageRequest',
    });
    expect(openApiSpec.components.schemas.IntelligenceSendMessageRequest.required).toEqual(['content']);
  });

  it('documents public AI assistant routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/ai/status', 'get'],
      ['/ai/suggest-label', 'post'],
      ['/ai/query', 'post'],
      ['/ai/detect-ollama', 'post'],
      ['/ai/models', 'get'],
      ['/ai/pull-model', 'post'],
      ['/ai/delete-model', 'delete'],
      ['/ai/ollama-container/status', 'get'],
      ['/ai/ollama-container/start', 'post'],
      ['/ai/ollama-container/stop', 'post'],
      ['/ai/system-resources', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    const querySchema = openApiSpec.components.schemas.AIQueryResult;
    expect(querySchema.properties.type.enum).toEqual([...AI_QUERY_RESULT_TYPES]);
    expect(querySchema.properties.sort.properties.order.enum).toEqual([...AI_QUERY_SORT_ORDERS]);
    expect(querySchema.properties.aggregation.enum).toEqual([...AI_QUERY_AGGREGATION_VALUES]);

    expect(openApiSpec.components.schemas.AIQueryRequest.required).toEqual(['query', 'walletId']);
    expect(openApiSpec.components.schemas.AIModelRequest.required).toEqual(['model']);
    expect(openApiSpec.paths['/ai/delete-model'].delete.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AIModelRequest',
    });
    expect(openApiSpec.paths['/ai/pull-model'].post.responses).toHaveProperty('403');
    expect(openApiSpec.paths['/ai/models'].get.responses).toHaveProperty('502');
    expect(openApiSpec.components.schemas.AISystemResourcesResponse.required).toEqual([
      'ram',
      'disk',
      'gpu',
      'overall',
    ]);
  });
});
