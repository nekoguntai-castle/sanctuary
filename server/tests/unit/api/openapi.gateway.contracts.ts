import { expect, it } from 'vitest';

import {
  openApiSpec,
  agentBearerAuthSecurity,
  browserOrBearerAuthSecurity,
  expectDocumentedMethod,
  MOBILE_ACTIONS,
  MOBILE_API_REQUEST_LIMITS,
  MOBILE_DEVICE_ACCOUNT_PURPOSES,
  MOBILE_DEVICE_SCRIPT_TYPES,
  MOBILE_DRAFT_STATUS_VALUES,
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_ROLE_FILTER_VALUES,
  TRANSFER_STATUS_FILTER_VALUES,
  TRANSFER_STATUS_VALUES,
  INSIGHT_SEVERITY_VALUES,
  INSIGHT_STATUS_VALUES,
  INSIGHT_TYPE_VALUES,
  INSIGHT_UPDATE_STATUS_VALUES,
  INTELLIGENCE_ENDPOINT_TYPE_VALUES,
  INTELLIGENCE_MESSAGE_ROLE_VALUES,
  AI_QUERY_AGGREGATION_VALUES,
  AI_QUERY_RESULT_TYPES,
  AI_QUERY_SORT_ORDERS,
} from './openapi.helpers';
import { registerOpenApiGatewayInternalTests } from './openapi.gateway-internal.contracts';

import type {
  OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiGatewayTests() {
  it('documents agent funding draft submission route with agent bearer auth', () => {
    const route = openApiSpec.paths['/agent/wallets/{fundingWalletId}/funding-drafts'];

    expect(route.post).toBeDefined();
    expect(route.post.security).toEqual(agentBearerAuthSecurity);
    expect(route.post.parameters).toContainEqual(expect.objectContaining({
      name: 'fundingWalletId',
      in: 'path',
      required: true,
    }));
    expect(route.post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AgentFundingDraftRequest',
    });
    expect(openApiSpec.components.securitySchemes.agentBearerAuth).toBeDefined();
    expect(openApiSpec.components.schemas.AgentFundingDraftRequest.required).toEqual(expect.arrayContaining([
      'operationalWalletId',
      'recipient',
      'amount',
      'feeRate',
      'psbtBase64',
      'signedPsbtBase64',
    ]));
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

  it('documents public device catalog, account, and sharing routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/devices/models', 'get'],
      ['/devices/models/{slug}', 'get'],
      ['/devices/manufacturers', 'get'],
      ['/devices/{deviceId}/accounts', 'get'],
      ['/devices/{deviceId}/accounts', 'post'],
      ['/devices/{deviceId}/accounts/{accountId}', 'delete'],
      ['/devices/{deviceId}/share', 'get'],
      ['/devices/{deviceId}/share/user', 'post'],
      ['/devices/{deviceId}/share/user/{targetUserId}', 'delete'],
      ['/devices/{deviceId}/share/group', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/devices/models'].get).not.toHaveProperty('security');
    expect(openApiSpec.paths['/devices/models/{slug}'].get).not.toHaveProperty('security');
    expect(openApiSpec.paths['/devices/manufacturers'].get).not.toHaveProperty('security');

    const modelParameters = openApiSpec.paths['/devices/models'].get.parameters;
    expect(modelParameters).toContainEqual(expect.objectContaining({
      name: 'manufacturer',
      in: 'query',
    }));
    expect(modelParameters).toContainEqual(expect.objectContaining({
      name: 'airGapped',
      in: 'query',
      schema: expect.objectContaining({ type: 'boolean' }),
    }));
    expect(modelParameters).toContainEqual(expect.objectContaining({
      name: 'connectivity',
      in: 'query',
    }));
    expect(modelParameters).toContainEqual(expect.objectContaining({
      name: 'showDiscontinued',
      in: 'query',
      schema: expect.objectContaining({ type: 'boolean' }),
    }));

    expect(openApiSpec.components.schemas.DeviceModel.required).toEqual(expect.arrayContaining([
      'id',
      'slug',
      'name',
      'manufacturer',
      'connectivity',
      'scriptTypes',
    ]));
    expect(openApiSpec.components.schemas.DeviceModel.properties.connectivity.items).toEqual({ type: 'string' });
    expect(openApiSpec.components.schemas.DeviceModel.properties.scriptTypes.items).toEqual({ type: 'string' });

    expect(
      openApiSpec.paths['/devices/{deviceId}/accounts'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/DeviceAccountInput',
    });
    expect(
      openApiSpec.paths['/devices/{deviceId}/accounts'].get.responses[200].content['application/json'].schema.items
    ).toEqual({
      $ref: '#/components/schemas/DeviceAccount',
    });
    expect(openApiSpec.paths['/devices/{deviceId}/accounts/{accountId}'].delete.responses[204])
      .not.toHaveProperty('content');

    expect(
      openApiSpec.paths['/devices/{deviceId}/share/user'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/DeviceShareUserRequest',
    });
    expect(
      openApiSpec.paths['/devices/{deviceId}/share/group'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/DeviceShareGroupRequest',
    });
    expect(openApiSpec.components.schemas.DeviceShareInfo.required).toEqual(['group', 'users']);
    expect(openApiSpec.components.schemas.DeviceShareUserRequest.required).toEqual(['targetUserId']);
    expect(openApiSpec.components.schemas.DeviceShareGroupRequest.properties.groupId).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(openApiSpec.components.schemas.DeviceShareResult.required).toEqual(['success', 'message']);
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

  it('documents secondary auth profile, email, Telegram, and 2FA management routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/auth/registration-status', 'get'],
      ['/auth/2fa/setup', 'post'],
      ['/auth/2fa/enable', 'post'],
      ['/auth/2fa/disable', 'post'],
      ['/auth/2fa/backup-codes', 'post'],
      ['/auth/2fa/backup-codes/regenerate', 'post'],
      ['/auth/me/groups', 'get'],
      ['/auth/me/change-password', 'post'],
      ['/auth/me/email', 'put'],
      ['/auth/users/search', 'get'],
      ['/auth/email/verify', 'post'],
      ['/auth/email/resend', 'post'],
      ['/auth/telegram/chat-id', 'post'],
      ['/auth/telegram/test', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/auth/registration-status'].get).not.toHaveProperty('security');
    expect(openApiSpec.paths['/auth/email/verify'].post).not.toHaveProperty('security');
    expect(openApiSpec.paths['/auth/2fa/setup'].post.security).toEqual(browserOrBearerAuthSecurity);
    expect(openApiSpec.paths['/auth/email/resend'].post.security).toEqual(browserOrBearerAuthSecurity);
    expect(openApiSpec.paths['/auth/telegram/chat-id'].post.security).toEqual(browserOrBearerAuthSecurity);

    expect(openApiSpec.components.schemas.RegistrationStatusResponse.required).toEqual(['enabled']);
    expect(openApiSpec.components.schemas.RegisterRequest.required).toEqual(['username', 'password', 'email']);
    expect(openApiSpec.components.schemas.RegisterRequest.properties.email).toMatchObject({
      type: 'string',
      format: 'email',
    });
    expect(openApiSpec.components.schemas.LoginResponse.properties).toHaveProperty('tempToken');
    expect(openApiSpec.components.schemas.LoginResponse.properties).toHaveProperty('emailVerificationRequired');

    expect(
      openApiSpec.paths['/auth/2fa/enable'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/TwoFactorTokenRequest',
    });
    expect(
      openApiSpec.paths['/auth/2fa/disable'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/TwoFactorDisableRequest',
    });
    expect(
      openApiSpec.paths['/auth/2fa/backup-codes/regenerate'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/TwoFactorBackupCodesRegenerateRequest',
    });
    expect(openApiSpec.components.schemas.TwoFactorSetupResponse.required).toEqual(['secret', 'qrCodeDataUrl']);
    expect(openApiSpec.components.schemas.TwoFactorBackupCodesResponse.required).toEqual(['success', 'backupCodes']);
    expect(openApiSpec.components.schemas.BackupCodesCountResponse.required).toEqual(['remaining']);

    expect(
      openApiSpec.paths['/auth/me/change-password'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/ChangePasswordRequest',
    });
    expect(openApiSpec.components.schemas.ChangePasswordRequest.required).toEqual([
      'currentPassword',
      'newPassword',
    ]);
    expect(openApiSpec.paths['/auth/users/search'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'q',
      in: 'query',
      required: true,
      schema: expect.objectContaining({ minLength: 2 }),
    }));
    expect(
      openApiSpec.paths['/auth/me/groups'].get.responses[200].content['application/json'].schema.items
    ).toEqual({
      $ref: '#/components/schemas/UserGroupSummary',
    });
    expect(
      openApiSpec.paths['/auth/users/search'].get.responses[200].content['application/json'].schema.items
    ).toEqual({
      $ref: '#/components/schemas/UserSearchResult',
    });

    expect(openApiSpec.paths['/auth/email/verify'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VerifyEmailRequest',
    });
    expect(openApiSpec.components.schemas.UpdateEmailRequest.required).toEqual(['email', 'password']);
    expect(
      openApiSpec.paths['/auth/me/email'].put.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/UpdateEmailRequest',
    });
    expect(openApiSpec.components.schemas.EmailResendResponse.required).toEqual(['success', 'message', 'expiresAt']);

    expect(
      openApiSpec.paths['/auth/telegram/chat-id'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/TelegramChatIdRequest',
    });
    expect(
      openApiSpec.paths['/auth/telegram/test'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/TelegramTestRequest',
    });
    expect(openApiSpec.components.schemas.TelegramTestRequest.required).toEqual(['botToken', 'chatId']);
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

  it('documents wallet label detail and transaction/address label association routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/labels/{labelId}', 'get'],
      ['/transactions/{transactionId}/labels', 'get'],
      ['/transactions/{transactionId}/labels', 'post'],
      ['/transactions/{transactionId}/labels', 'put'],
      ['/transactions/{transactionId}/labels/{labelId}', 'delete'],
      ['/addresses/{addressId}/labels', 'get'],
      ['/addresses/{addressId}/labels', 'post'],
      ['/addresses/{addressId}/labels', 'put'],
      ['/addresses/{addressId}/labels/{labelId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(
      openApiSpec.paths['/wallets/{walletId}/labels/{labelId}'].get.responses[200]
        .content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/LabelWithRelations',
    });
    expect(openApiSpec.components.schemas.LabelWithRelations.allOf).toContainEqual({
      $ref: '#/components/schemas/Label',
    });

    const labelIdsSchema = openApiSpec.components.schemas.LabelIdsRequest;
    expect(labelIdsSchema.required).toEqual(['labelIds']);
    expect(labelIdsSchema.properties.labelIds.items).toEqual({ type: 'string' });

    for (const path of [
      '/transactions/{transactionId}/labels',
      '/addresses/{addressId}/labels',
    ] as const) {
      for (const method of ['post', 'put'] as const) {
        expect(openApiSpec.paths[path][method].requestBody.content['application/json'].schema).toEqual({
          $ref: '#/components/schemas/LabelIdsRequest',
        });
        expect(openApiSpec.paths[path][method].responses[200].content['application/json'].schema.items).toEqual({
          $ref: '#/components/schemas/Label',
        });
      }
    }

    expect(openApiSpec.paths['/transactions/{transactionId}/labels/{labelId}'].delete.responses[204])
      .not.toHaveProperty('content');
    expect(openApiSpec.paths['/addresses/{addressId}/labels/{labelId}'].delete.responses[204])
      .not.toHaveProperty('content');
  });

  it('documents gateway-exposed and gateway-HMAC push routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/push/register', 'post'],
      ['/push/unregister', 'delete'],
      ['/push/devices', 'get'],
      ['/push/devices/{id}', 'delete'],
      ['/push/by-user/{userId}', 'get'],
      ['/push/device/{deviceId}', 'delete'],
      ['/push/gateway-audit', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/push/by-user/{userId}'].get.security).toEqual([
      { gatewaySignature: [], gatewayTimestamp: [] },
    ]);
    expect(openApiSpec.paths['/push/device/{deviceId}'].delete.security).toEqual([
      { gatewaySignature: [], gatewayTimestamp: [] },
    ]);
    expect(openApiSpec.paths['/push/gateway-audit'].post.security).toEqual([
      { gatewaySignature: [], gatewayTimestamp: [] },
    ]);
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
    expect(openApiSpec.components.schemas.GatewayPushDevice.required).toEqual([
      'id',
      'platform',
      'pushToken',
      'userId',
    ]);
    expect(openApiSpec.components.schemas.GatewayAuditRequest.required).toEqual(['event']);
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

  registerOpenApiGatewayInternalTests();
}
