import { expect, it } from 'vitest';
import { DEVICE_ROLE_VALUES } from '@sanctuary/shared/constants/deviceRoles';

import {
  openApiSpec,
  agentBearerAuthSecurity,
  browserOrBearerAuthSecurity,
  expectDocumentedMethod,
  getOptionalProperty,
  MOBILE_ACTIONS,
  MOBILE_API_REQUEST_LIMITS,
  MOBILE_DEVICE_ACCOUNT_PURPOSES,
  MOBILE_DEVICE_SCRIPT_TYPES,
  MOBILE_DRAFT_STATUS_VALUES,
  USER_PREFERENCE_LIMITS,
  USER_PREFERENCE_SELECTED_NETWORK_VALUES,
  USER_PREFERENCE_UNIT_VALUES,
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
import { PASSWORD_POLICY, PASSWORD_POLICY_MESSAGES } from '../../../src/utils/passwordPolicy';
import { USERNAME_POLICY } from '../../../src/utils/username';
import { MobileRefreshTokenRequestSchema } from '@sanctuary/shared/schemas/mobileApiRequests';

import type { OpenApiPathKey } from './openapi.helpers';

export function registerOpenApiGatewayTests() {
  it('documents agent funding draft submission route with agent bearer auth', () => {
    const route = openApiSpec.paths['/agent/wallets/{fundingWalletId}/funding-drafts'];

    expect(route.post).toBeDefined();
    expect(route.post.security).toEqual(agentBearerAuthSecurity);
    expect(route.post.parameters).toContainEqual(
      expect.objectContaining({
        name: 'fundingWalletId',
        in: 'path',
        required: true,
      })
    );
    expect(route.post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AgentFundingDraftRequest',
    });
    expect(openApiSpec.components.securitySchemes.agentBearerAuth).toBeDefined();
    expect(openApiSpec.components.schemas.AgentFundingDraftRequest.required).toEqual(
      expect.arrayContaining(['operationalWalletId', 'recipient', 'amount', 'feeRate'])
    );
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
        })
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
    expect(modelParameters).toContainEqual(
      expect.objectContaining({
        name: 'manufacturer',
        in: 'query',
      })
    );
    expect(modelParameters).toContainEqual(
      expect.objectContaining({
        name: 'airGapped',
        in: 'query',
        schema: expect.objectContaining({ type: 'boolean' }),
      })
    );
    expect(modelParameters).toContainEqual(
      expect.objectContaining({
        name: 'connectivity',
        in: 'query',
      })
    );
    expect(modelParameters).toContainEqual(
      expect.objectContaining({
        name: 'showDiscontinued',
        in: 'query',
        schema: expect.objectContaining({ type: 'boolean' }),
      })
    );

    expect(openApiSpec.components.schemas.DeviceModel.required).toEqual(
      expect.arrayContaining(['id', 'slug', 'name', 'manufacturer', 'connectivity', 'scriptTypes'])
    );
    expect(openApiSpec.components.schemas.DeviceModel.properties.connectivity.items).toEqual({ type: 'string' });
    expect(openApiSpec.components.schemas.DeviceModel.properties.scriptTypes.items).toEqual({ type: 'string' });

    expect(
      openApiSpec.paths['/devices/{deviceId}/accounts'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/DeviceAccountEvidenceInput',
    });
    expect(
      openApiSpec.paths['/devices/{deviceId}/accounts'].get.responses[200].content['application/json'].schema.items
    ).toEqual({
      $ref: '#/components/schemas/DeviceAccount',
    });
    expect(openApiSpec.paths['/devices/{deviceId}/accounts/{accountId}'].delete.responses[204]).not.toHaveProperty(
      'content'
    );

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
    expect(openApiSpec.components.schemas.Device.properties.role.enum).toBe(DEVICE_ROLE_VALUES);
    expect(openApiSpec.components.schemas.Device.properties.userRole.enum).toBe(DEVICE_ROLE_VALUES);
    expect(openApiSpec.components.schemas.DeviceShareInfo.properties.users.items.properties.role.enum).toBe(
      DEVICE_ROLE_VALUES,
    );
    expect(openApiSpec.components.schemas.DeviceShareUserRequest.required).toEqual(['targetUserId']);
    expect(openApiSpec.components.schemas.DeviceShareGroupRequest.properties.groupId).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(openApiSpec.components.schemas.DeviceShareResult.required).toEqual(['success', 'message']);
  });

  it('documents the fixed Jade PIN relay without a caller-controlled URL', () => {
    const operation = openApiSpec.paths['/hardware/jade/pin'].post;
    const requestSchema = operation.requestBody.content['application/json'].schema;

    expect(operation.security).toEqual([
      { bearerAuth: [] },
      { cookieAuth: [], csrfToken: [] },
    ]);
    expect(requestSchema).toMatchObject({
      additionalProperties: false,
      required: ['operation', 'data'],
      properties: {
        operation: { enum: ['get_pin', 'set_pin'] },
      },
    });
    expect(requestSchema.properties).not.toHaveProperty('url');
    expect(operation.responses).toHaveProperty('503');
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
    expect(createSchema.properties.fingerprint).toMatchObject({
      pattern: '^[a-fA-F0-9]{8}$',
      not: { enum: ['00000000'] },
    });
    expect(createSchema.anyOf).toContainEqual({ required: ['xpub', 'derivationPath'] });
    expect(createSchema.properties).toHaveProperty('accounts');
    expect(createSchema.properties).toHaveProperty('merge');
    expect(createSchema.properties).toHaveProperty('modelSlug');
    expect(openApiSpec.components.schemas.DeviceAccountInput.properties.purpose.enum).toEqual([
      ...MOBILE_DEVICE_ACCOUNT_PURPOSES,
    ]);
    expect(openApiSpec.components.schemas.DeviceAccountInput.properties.scriptType.enum).toEqual([
      ...MOBILE_DEVICE_SCRIPT_TYPES,
    ]);
    expect(openApiSpec.components.schemas.DeviceAccountEvidenceInput.required).toEqual([
      'purpose',
      'scriptType',
      'derivationPath',
      'xpub',
      'masterFingerprint',
    ]);
    expect(openApiSpec.components.schemas.DeviceAccountEvidenceInput.properties.masterFingerprint)
      .toMatchObject({ pattern: '^[a-fA-F0-9]{8}$', not: { enum: ['00000000'] } });
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
    expect(getOptionalProperty(openApiSpec.components.schemas.RefreshTokenRequest, 'required')).toBeUndefined();
    expect(openApiSpec.paths['/auth/refresh'].post.requestBody.required).toBe(false);
    expect(MobileRefreshTokenRequestSchema.safeParse({}).success).toBe(false);
    expect(openApiSpec.components.schemas.TwoFactorVerifyRequest).toBeDefined();
    expect(openApiSpec.components.schemas.SessionsResponse).toBeDefined();
    expect(openApiSpec.components.schemas.AuthCsrfSessionStaleError.properties.code).toEqual({
      type: 'string',
      enum: ['AUTH_CSRF_SESSION_STALE'],
    });
    for (const path of [
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/2fa/verify',
    ] as const) {
      expect(openApiSpec.paths[path].post.responses[403].content['application/json'].schema).toEqual({
        anyOf: [
          { $ref: '#/components/schemas/ApiError' },
          { $ref: '#/components/schemas/AuthCsrfSessionStaleError' },
        ],
      });
    }
    const loginSchema = openApiSpec.components.schemas.LoginRequest;
    expect(loginSchema.properties.username).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.usernameMinLength,
      maxLength: MOBILE_API_REQUEST_LIMITS.usernameMaxLength,
    });
    expect(loginSchema.properties.password).toMatchObject({
      minLength: MOBILE_API_REQUEST_LIMITS.loginPasswordMinLength,
    });

    expect(openApiSpec.paths['/auth/me/preferences'].patch.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/UpdateUserPreferencesRequest',
    });

    const userPreferencesSchema = openApiSpec.components.schemas.UserPreferences;
    const updatePreferencesSchema = openApiSpec.components.schemas.UpdateUserPreferencesRequest;

    expect(userPreferencesSchema.additionalProperties).toBe(true);
    expect(updatePreferencesSchema.additionalProperties).toBe(true);
    expect(updatePreferencesSchema.properties.unit.enum).toEqual([...USER_PREFERENCE_UNIT_VALUES]);
    expect(updatePreferencesSchema.properties.fiatCurrency).toMatchObject({
      minLength: USER_PREFERENCE_LIMITS.fiatCurrencyLength,
      maxLength: USER_PREFERENCE_LIMITS.fiatCurrencyLength,
      pattern: '^[A-Za-z]{3}$',
      description: expect.stringContaining('stored as an uppercase'),
    });
    expect(userPreferencesSchema.properties.fiatCurrency).toMatchObject({
      pattern: '^[A-Z]{3}$',
      description: expect.stringContaining('Stored as an uppercase'),
    });
    expect(updatePreferencesSchema.properties.patternOpacity).toMatchObject({
      minimum: USER_PREFERENCE_LIMITS.patternOpacityMin,
      maximum: USER_PREFERENCE_LIMITS.patternOpacityMax,
    });
    expect(updatePreferencesSchema.properties.flyoutOpacity).toMatchObject({
      minimum: USER_PREFERENCE_LIMITS.flyoutOpacityMin,
      maximum: USER_PREFERENCE_LIMITS.flyoutOpacityMax,
    });
    expect(updatePreferencesSchema.properties.selectedNetwork.enum).toEqual([
      ...USER_PREFERENCE_SELECTED_NETWORK_VALUES,
    ]);
    expect(updatePreferencesSchema.properties.notificationSounds.additionalProperties).toBe(true);
    expect(updatePreferencesSchema.properties.telegram.additionalProperties).toBe(true);
    expect(updatePreferencesSchema.properties.viewSettings.additionalProperties).toBe(true);
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
    expect(openApiSpec.components.schemas.RegisterRequest.properties.username).toMatchObject({
      minLength: USERNAME_POLICY.minLength,
      maxLength: USERNAME_POLICY.maxLength,
      pattern: USERNAME_POLICY.pattern,
      description: expect.stringContaining('stored lowercase'),
    });
    expect(openApiSpec.components.schemas.RegisterRequest.properties.password).toMatchObject({
      minLength: PASSWORD_POLICY.minLength,
      maxLength: PASSWORD_POLICY.maxUtf8Bytes,
      description: expect.stringContaining(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes),
    });
    expect(openApiSpec.components.schemas.RegisterRequest.properties.email).toMatchObject({
      type: 'string',
      format: 'email',
    });
    expect(openApiSpec.components.schemas.LoginResponse.properties).toHaveProperty('tempToken');
    expect(openApiSpec.components.schemas.LoginResponse.properties).toHaveProperty('emailVerificationRequired');
    expect(openApiSpec.components.schemas.LoginResponse.properties).not.toHaveProperty('token');
    expect(openApiSpec.components.schemas.LoginResponse.properties).not.toHaveProperty('refreshToken');

    expect(openApiSpec.paths['/auth/2fa/enable'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TwoFactorTokenRequest',
    });
    expect(openApiSpec.paths['/auth/2fa/disable'].post.requestBody.content['application/json'].schema).toEqual({
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

    expect(openApiSpec.paths['/auth/me/change-password'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ChangePasswordRequest',
    });
    expect(openApiSpec.components.schemas.ChangePasswordRequest.required).toEqual(['currentPassword', 'newPassword']);
    expect(openApiSpec.components.schemas.ChangePasswordRequest.properties.newPassword).toMatchObject({
      minLength: PASSWORD_POLICY.minLength,
      maxLength: PASSWORD_POLICY.maxUtf8Bytes,
      description: expect.stringContaining(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes),
    });
    expect(openApiSpec.paths['/auth/me/change-password'].post.responses).toHaveProperty('409');
    expect(openApiSpec.paths['/auth/users/search'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'q',
        in: 'query',
        required: true,
        schema: expect.objectContaining({ minLength: 2 }),
      })
    );
    expect(openApiSpec.paths['/auth/me/groups'].get.responses[200].content['application/json'].schema.items).toEqual({
      $ref: '#/components/schemas/UserGroupSummary',
    });
    expect(openApiSpec.paths['/auth/users/search'].get.responses[200].content['application/json'].schema.items).toEqual(
      {
        $ref: '#/components/schemas/UserSearchResult',
      }
    );

    expect(openApiSpec.paths['/auth/email/verify'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VerifyEmailRequest',
    });
    expect(openApiSpec.components.schemas.UpdateEmailRequest.required).toEqual(['email', 'password']);
    expect(openApiSpec.paths['/auth/me/email'].put.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/UpdateEmailRequest',
    });
    expect(openApiSpec.components.schemas.EmailResendResponse.required).toEqual(['success', 'message', 'expiresAt']);

    expect(openApiSpec.paths['/auth/telegram/chat-id'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TelegramChatIdRequest',
    });
    expect(openApiSpec.paths['/auth/telegram/test'].post.requestBody.content['application/json'].schema).toEqual({
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
    expect(openApiSpec.components.schemas.PsbtCreateRequest.properties.recipients).toMatchObject({
      minItems: 1,
      maxItems: 1,
    });
    expect(openApiSpec.components.schemas.TransactionBroadcastRequest).toBeDefined();
    expect(openApiSpec.components.schemas.TransactionBroadcastRequest.properties.draftId).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(getOptionalProperty(openApiSpec.components.schemas.TransactionBroadcastRequest, 'required')).toBeUndefined();
    expect(openApiSpec.components.schemas.TransactionBroadcastRequest.anyOf).toEqual([
      { required: ['signedPsbtBase64'] },
      { required: ['rawTxHex'] },
      { required: ['draftId'] },
    ]);
    expect(openApiSpec.components.schemas.TransactionBroadcastRequest.not).toEqual({
      required: ['signedPsbtBase64', 'rawTxHex'],
    });
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
    const draftIntegerValueSchema = {
      oneOf: [
        { type: 'integer', minimum: 0 },
        { type: 'string', pattern: '^\\d+$' },
      ],
    };
    const draftFeeRateValueSchema = {
      oneOf: [
        { type: 'number', minimum: 0, exclusiveMinimum: true },
        { type: 'string', pattern: '^(?=.*[1-9])\\d+(\\.\\d+)?$' },
      ],
    };
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.amount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.feeRate).toEqual(draftFeeRateValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.fee).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.totalInput).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.totalOutput).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.changeAmount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.effectiveAmount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.outputs.items).toEqual({
      $ref: '#/components/schemas/DraftOutputRequest',
    });
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.inputs.items).toEqual({
      $ref: '#/components/schemas/DraftInputRequest',
    });
    expect(openApiSpec.components.schemas.CreateDraftRequest.properties.decoyOutputs.items).toEqual({
      $ref: '#/components/schemas/DraftDecoyOutputRequest',
    });
    expect(openApiSpec.components.schemas.DraftOutputRequest.properties.amount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.DraftInputRequest.properties.amount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.DraftDecoyOutputRequest.properties.amount).toEqual(draftIntegerValueSchema);
    expect(openApiSpec.components.schemas.UpdateDraftRequest.properties.label).toEqual({
      type: 'string',
      nullable: true,
    });
    expect(openApiSpec.components.schemas.UpdateDraftRequest.properties.memo).toEqual({
      type: 'string',
      nullable: true,
    });
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
      openApiSpec.paths['/wallets/{walletId}/labels/{labelId}'].get.responses[200].content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/LabelWithRelations',
    });
    expect(openApiSpec.components.schemas.LabelWithRelations.allOf).toContainEqual({
      $ref: '#/components/schemas/Label',
    });

    const labelIdsSchema = openApiSpec.components.schemas.LabelIdsRequest;
    expect(labelIdsSchema.required).toEqual(['labelIds']);
    expect(labelIdsSchema.properties.labelIds.items).toEqual({
      type: 'string',
    });

    for (const path of ['/transactions/{transactionId}/labels', '/addresses/{addressId}/labels'] as const) {
      for (const method of ['post', 'put'] as const) {
        expect(openApiSpec.paths[path][method].requestBody.content['application/json'].schema).toEqual({
          $ref: '#/components/schemas/LabelIdsRequest',
        });
        expect(openApiSpec.paths[path][method].responses[200].content['application/json'].schema.items).toEqual({
          $ref: '#/components/schemas/Label',
        });
      }
    }

    expect(
      openApiSpec.paths['/transactions/{transactionId}/labels/{labelId}'].delete.responses[204]
    ).not.toHaveProperty('content');
    expect(openApiSpec.paths['/addresses/{addressId}/labels/{labelId}'].delete.responses[204]).not.toHaveProperty(
      'content'
    );
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
    expect(openApiSpec.components.schemas.GatewayAuditRequest.properties.outcome).toMatchObject({
      enum: ['success', 'failure'],
    });
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
      'testnet3',
      'testnet4',
      'signet',
      'regtest',
    ]);
    expect(openApiSpec.components.schemas.PayjoinAttemptRequest.required).toEqual([
      'walletId',
      'psbt',
      'intentId',
      'intentDigest',
      'payjoinUrl',
    ]);
    expect(openApiSpec.components.schemas.PayjoinAttemptRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.PayjoinReceiverError.enum).toEqual([
      'version-unsupported',
      'unavailable',
      'not-enough-money',
      'original-psbt-rejected',
      'receiver-error',
    ]);

    const receiverPath = openApiSpec.paths['/payjoin/{addressId}'].post;
    const uriAmountParameter = openApiSpec.paths['/payjoin/address/{addressId}/uri']
      .get.parameters.find(parameter => parameter.name === 'amount');
    const minFeeRateParameter = receiverPath.parameters.find(
      parameter => parameter.name === 'minfeerate',
    );
    expect(uriAmountParameter?.schema).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(minFeeRateParameter?.schema).toEqual({
      type: 'string',
      pattern: '^(?:(?:0|[1-9]\\d{0,5})(?:\\.\\d+)?|1000000(?:\\.0+)?)$',
    });
    expect(receiverPath.parameters.map(parameter => parameter.name)).not.toContain(
      'maxadditionalfeecontribution',
    );
    expect(receiverPath).not.toHaveProperty('security');
    expect(receiverPath.requestBody.content['text/plain'].schema).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 102400,
    });
    expect(receiverPath.responses[200].content['text/plain'].schema).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(receiverPath.responses[400].content['text/plain'].schema).toEqual({
      $ref: '#/components/schemas/PayjoinReceiverError',
    });
    expect(receiverPath.responses[413].content['text/plain'].schema).toEqual({
      $ref: '#/components/schemas/PayjoinReceiverError',
    });
    expect(openApiSpec.paths['/payjoin/address/{addressId}/uri'].get.responses[400])
      .toBeDefined();
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
    expect(transferSchema.required).toEqual(
      expect.arrayContaining([
        'id',
        'resourceType',
        'resourceId',
        'fromUserId',
        'toUserId',
        'status',
        'createdAt',
        'expiresAt',
        'keepExistingUsers',
      ])
    );

    const createSchema = openApiSpec.components.schemas.TransferCreateRequest;
    expect(createSchema.required).toEqual(['resourceType', 'resourceId', 'toUserId']);
    expect(createSchema.additionalProperties).toBe(false);
    expect(createSchema.properties.resourceType.enum).toEqual([...TRANSFER_RESOURCE_TYPES]);
    expect(createSchema.properties.resourceId.minLength).toBe(1);
    expect(createSchema.properties.toUserId.minLength).toBe(1);
    expect(createSchema.properties.expiresInDays.minimum).toBe(1);

    const declineSchema = openApiSpec.components.schemas.TransferDeclineRequest;
    expect(declineSchema.additionalProperties).toBe(false);

    const listParameters = openApiSpec.paths['/transfers'].get.parameters;
    expect(listParameters).toContainEqual(
      expect.objectContaining({
        name: 'role',
        schema: expect.objectContaining({
          enum: [...TRANSFER_ROLE_FILTER_VALUES],
        }),
      })
    );
    expect(listParameters).toContainEqual(
      expect.objectContaining({
        name: 'resourceType',
        schema: expect.objectContaining({
          enum: [...TRANSFER_RESOURCE_TYPES],
        }),
      })
    );
    expect(listParameters).toContainEqual(
      expect.objectContaining({
        name: 'status',
        schema: expect.objectContaining({
          enum: [...TRANSFER_STATUS_FILTER_VALUES],
        }),
      })
    );

    expect(openApiSpec.paths['/transfers'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/OwnershipTransfer',
    });
    expect(openApiSpec.paths['/transfers'].get.responses[400]).toEqual(
      expect.objectContaining({ description: 'Error response' })
    );
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
    expect(insightParameters).toContainEqual(
      expect.objectContaining({
        name: 'walletId',
        in: 'query',
        required: true,
      })
    );
    expect(insightParameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({ maximum: 100, default: 50 }),
      })
    );
    expect(openApiSpec.paths['/intelligence/conversations'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({ default: 20 }),
      })
    );
    expect(openApiSpec.paths['/intelligence/conversations'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'walletId',
        in: 'query',
        required: true,
      })
    );

    expect(
      openApiSpec.paths['/intelligence/conversations/{id}/messages'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/IntelligenceSendMessageRequest',
    });
    expect(openApiSpec.components.schemas.IntelligenceSendMessageRequest.required).toEqual(['content']);
    expect(openApiSpec.components.schemas.IntelligenceSendMessageRequest.properties).toEqual({
      content: { type: 'string', minLength: 1, maxLength: 8000 },
    });
  });

  it('documents public AI assistant routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/ai/status', 'get'],
      ['/ai/suggest-label', 'post'],
      ['/ai/query', 'post'],
      ['/ai/detect-ollama', 'post'],
      ['/ai/detect-provider', 'post'],
      ['/ai/models', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    const querySchema = openApiSpec.components.schemas.AIQueryResult;
    expect(querySchema.properties.type.enum).toEqual([...AI_QUERY_RESULT_TYPES]);
    expect(querySchema.properties.sort.properties.order.enum).toEqual([...AI_QUERY_SORT_ORDERS]);
    expect(querySchema.properties.aggregation.enum).toEqual([...AI_QUERY_AGGREGATION_VALUES]);

    expect(openApiSpec.components.schemas.AIQueryRequest.required).toEqual(['query', 'walletId']);
    expect(openApiSpec.paths['/ai/models'].get.responses).toHaveProperty('502');
    expect(openApiSpec.paths).not.toHaveProperty('/ai/pull-model');
    expect(openApiSpec.paths).not.toHaveProperty('/ai/delete-model');
    expect(openApiSpec.paths).not.toHaveProperty('/ai/system-resources');
    expect(openApiSpec.components.schemas).not.toHaveProperty('AIModelRequest');
    expect(openApiSpec.components.schemas).not.toHaveProperty('AIModelOperationResponse');
    expect(openApiSpec.components.schemas).not.toHaveProperty('AISystemResourcesResponse');
  });

  registerOpenApiGatewayInternalTests();
}
