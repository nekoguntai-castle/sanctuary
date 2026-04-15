import { expect, it } from 'vitest';

import {
  openApiSpec,
  expectDocumentedMethod,
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
  WALLET_IMPORT_FORMAT_VALUES,
  WALLET_IMPORT_NETWORK_VALUES,
  WALLET_IMPORT_SCRIPT_TYPE_VALUES,
  WALLET_IMPORT_WALLET_TYPE_VALUES,
  WALLET_EXPORT_FORMAT_VALUES,
  DEFAULT_AUTOPILOT_SETTINGS,
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  VALID_SOURCE_TYPES,
  VALID_VOTE_DECISIONS,
} from './openapi.helpers';

import type {
  OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiWalletTests() {
  it('documents transaction helper, UTXO selection, and privacy routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/transactions/{txid}/raw', 'get'],
      ['/transactions/recent', 'get'],
      ['/transactions/balance-history', 'get'],
      ['/utxos/{utxoId}/freeze', 'patch'],
      ['/wallets/{walletId}/utxos/select', 'post'],
      ['/wallets/{walletId}/utxos/compare-strategies', 'post'],
      ['/wallets/{walletId}/utxos/recommended-strategy', 'get'],
      ['/wallets/{walletId}/transactions/batch', 'post'],
      ['/wallets/{walletId}/transactions/pending', 'get'],
      ['/wallets/{walletId}/transactions/stats', 'get'],
      ['/wallets/{walletId}/transactions/export', 'get'],
      ['/wallets/{walletId}/transactions/recalculate', 'post'],
      ['/wallets/{walletId}/privacy', 'get'],
      ['/utxos/{utxoId}/privacy', 'get'],
      ['/wallets/{walletId}/privacy/spend-analysis', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/transactions/{txid}/raw'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/RawTransactionResponse',
    });
    expect(openApiSpec.components.schemas.RawTransactionResponse.required).toEqual(['hex']);

    expect(openApiSpec.paths['/transactions/recent'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'limit',
      schema: expect.objectContaining({ minimum: 1, maximum: 50, default: 10 }),
    }));
    expect(openApiSpec.paths['/transactions/balance-history'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'timeframe',
      schema: expect.objectContaining({ enum: ['1D', '1W', '1M', '1Y', 'ALL'], default: '1W' }),
    }));
    expect(openApiSpec.components.schemas.BalanceHistoryPoint.required).toEqual(['name', 'value']);

    expect(openApiSpec.components.schemas.UtxoFreezeRequest.required).toEqual(['frozen']);
    expect(openApiSpec.components.schemas.UtxoFreezeResponse.required).toEqual([
      'id',
      'txid',
      'vout',
      'frozen',
      'message',
    ]);
    expect(openApiSpec.components.schemas.UtxoSelectionStrategy.enum).toEqual([
      'privacy',
      'efficiency',
      'oldest_first',
      'largest_first',
      'smallest_first',
    ]);
    expect(openApiSpec.components.schemas.UtxoSelectionRequest.required).toEqual(['amount', 'feeRate']);
    expect(openApiSpec.components.schemas.UtxoSelectionRequest.properties.amount.oneOf).toContainEqual({
      type: 'string',
      minLength: 1,
    });
    expect(openApiSpec.components.schemas.UtxoSelectionRequest.properties.feeRate.oneOf).toContainEqual({
      type: 'number',
      minimum: 1,
    });
    expect(openApiSpec.components.schemas.UtxoSelectionResult.required).toEqual([
      'selected',
      'totalAmount',
      'estimatedFee',
      'changeAmount',
      'inputCount',
      'strategy',
      'warnings',
    ]);
    expect(openApiSpec.components.schemas.UtxoStrategyComparisonResponse.additionalProperties).toEqual({
      $ref: '#/components/schemas/UtxoSelectionResult',
    });
    expect(openApiSpec.paths['/wallets/{walletId}/utxos/recommended-strategy'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'prioritizePrivacy',
      schema: expect.objectContaining({ type: 'boolean', default: false }),
    }));

    expect(openApiSpec.paths['/wallets/{walletId}/transactions/batch'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TransactionBatchRequest',
    });
    expect(openApiSpec.components.schemas.TransactionBatchRequest.required).toEqual(['outputs', 'feeRate']);
    expect(openApiSpec.components.schemas.TransactionBatchOutput.required).toEqual(['address']);
    expect(openApiSpec.components.schemas.TransactionBatchOutput.properties).toHaveProperty('sendMax');

    expect(openApiSpec.components.schemas.WalletPendingTransaction.required).toEqual([
      'txid',
      'walletId',
      'type',
      'amount',
      'fee',
      'feeRate',
      'timeInQueue',
      'createdAt',
    ]);
    expect(openApiSpec.components.schemas.WalletTransactionStatsResponse.required).toEqual([
      'totalCount',
      'receivedCount',
      'sentCount',
      'consolidationCount',
      'totalReceived',
      'totalSent',
      'totalFees',
      'walletBalance',
    ]);
    expect(openApiSpec.components.schemas.TransactionExportFormat.enum).toEqual(['csv', 'json']);
    expect(openApiSpec.paths['/wallets/{walletId}/transactions/export'].get.responses[200].content).toHaveProperty('text/csv');
    expect(openApiSpec.paths['/wallets/{walletId}/transactions/export'].get.responses[200].content['application/json'].schema.items).toEqual({
      $ref: '#/components/schemas/TransactionExportEntry',
    });
    expect(openApiSpec.components.schemas.TransactionRecalculateResponse.required).toEqual([
      'success',
      'message',
      'finalBalance',
      'finalBalanceBtc',
    ]);

    expect(openApiSpec.components.schemas.PrivacyGrade.enum).toEqual(['excellent', 'good', 'fair', 'poor']);
    expect(openApiSpec.components.schemas.WalletPrivacyResponse.required).toEqual(['utxos', 'summary']);
    expect(openApiSpec.components.schemas.PrivacyScore.required).toEqual(['score', 'grade', 'factors', 'warnings']);
    expect(openApiSpec.components.schemas.SpendPrivacyRequest.properties.utxoIds).toMatchObject({
      minItems: 1,
    });
    expect(openApiSpec.components.schemas.SpendPrivacyResponse.required).toEqual([
      'score',
      'grade',
      'linkedAddresses',
      'warnings',
    ]);
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

  it('documents wallet import and XPUB validation routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/import/formats', 'get'],
      ['/wallets/import/validate', 'post'],
      ['/wallets/import', 'post'],
      ['/wallets/validate-xpub', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.WalletImportValidationResponse.properties.format.enum).toEqual([
      ...WALLET_IMPORT_FORMAT_VALUES,
    ]);
    expect(openApiSpec.components.schemas.WalletImportValidationResponse.properties.walletType.enum).toEqual([
      ...WALLET_IMPORT_WALLET_TYPE_VALUES,
    ]);
    expect(openApiSpec.components.schemas.WalletImportValidationResponse.properties.scriptType.enum).toEqual([
      ...WALLET_IMPORT_SCRIPT_TYPE_VALUES,
    ]);
    expect(openApiSpec.components.schemas.WalletImportValidationResponse.properties.network.enum).toEqual([
      ...WALLET_IMPORT_NETWORK_VALUES,
    ]);
    expect(openApiSpec.components.schemas.WalletImportValidateRequest).toHaveProperty('minProperties', 1);
    expect(openApiSpec.components.schemas.WalletImportRequest.required).toEqual(['data', 'name']);
    expect(openApiSpec.components.schemas.ValidateXpubRequest.required).toEqual(['xpub']);
    expect(openApiSpec.components.schemas.ValidateXpubRequest.properties.network).toMatchObject({
      enum: [...WALLET_IMPORT_NETWORK_VALUES],
      default: 'mainnet',
    });
    expect(openApiSpec.components.schemas.ValidateXpubResponse.required).toEqual([
      'valid',
      'descriptor',
      'scriptType',
      'firstAddress',
      'xpub',
      'fingerprint',
      'accountPath',
    ]);
    expect(openApiSpec.paths['/wallets/import'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/WalletImportResponse',
    });
    expect(openApiSpec.paths['/wallets/validate-xpub'].post.responses[400].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ApiError',
    });
  });

  it('documents wallet analytics and helper routes without replacing address listing', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/balance-history', 'get'],
      ['/wallets/{walletId}/addresses', 'get'],
      ['/wallets/{walletId}/addresses', 'post'],
      ['/wallets/{walletId}/devices', 'post'],
      ['/wallets/{walletId}/repair', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.WalletBalanceHistoryResponse.required).toEqual([
      'timeframe',
      'currentBalance',
      'dataPoints',
    ]);
    expect(openApiSpec.paths['/wallets/{walletId}/balance-history'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'timeframe',
        schema: expect.objectContaining({ default: '1M' }),
      }),
    );
    expect(openApiSpec.paths['/wallets/{walletId}/addresses'].get.responses[200].content['application/json'].schema)
      .toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/WalletAddress' },
      });
    expect(openApiSpec.paths['/wallets/{walletId}/addresses'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletGeneratedAddressResponse',
      });
    expect(openApiSpec.components.schemas.WalletAddDeviceRequest.required).toEqual(['deviceId']);
    expect(openApiSpec.paths['/wallets/{walletId}/devices'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletAddDeviceRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/devices'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletMessageResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/repair'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletRepairResponse',
      });
  });

  it('documents wallet export routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/export/labels', 'get'],
      ['/wallets/{walletId}/export/formats', 'get'],
      ['/wallets/{walletId}/export', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.WalletExportFormat.properties.id.enum).toEqual([
      ...WALLET_EXPORT_FORMAT_VALUES,
    ]);
    expect(openApiSpec.paths['/wallets/{walletId}/export/formats'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletExportFormatsResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/export'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'format',
        schema: expect.objectContaining({
          enum: [...WALLET_EXPORT_FORMAT_VALUES],
          default: 'sparrow',
        }),
      }),
    );
    expect(openApiSpec.paths['/wallets/{walletId}/export'].get.responses[200].content).toHaveProperty(
      'application/json',
    );
    expect(openApiSpec.paths['/wallets/{walletId}/export'].get.responses[200].content).toHaveProperty('text/plain');
    expect(openApiSpec.paths['/wallets/{walletId}/export/labels'].get.responses[200].content).toHaveProperty(
      'application/jsonl',
    );
  });

  it('documents wallet Telegram and Autopilot settings routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/wallets/{walletId}/telegram', 'get'],
      ['/wallets/{walletId}/telegram', 'patch'],
      ['/wallets/{walletId}/autopilot', 'get'],
      ['/wallets/{walletId}/autopilot', 'patch'],
      ['/wallets/{walletId}/autopilot/status', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.WalletTelegramSettings.required).toEqual([
      'enabled',
      'notifyReceived',
      'notifySent',
      'notifyConsolidation',
      'notifyDraft',
    ]);
    expect(openApiSpec.paths['/wallets/{walletId}/telegram'].patch.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/UpdateWalletTelegramSettingsRequest',
      });
    expect(openApiSpec.components.schemas.WalletAutopilotSettings.properties.maxFeeRate.default).toBe(
      DEFAULT_AUTOPILOT_SETTINGS.maxFeeRate,
    );
    expect(openApiSpec.components.schemas.WalletAutopilotSettings.properties.dustThreshold.default).toBe(
      DEFAULT_AUTOPILOT_SETTINGS.dustThreshold,
    );
    expect(openApiSpec.paths['/wallets/{walletId}/autopilot'].patch.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/UpdateWalletAutopilotSettingsRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/autopilot/status'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletAutopilotStatusResponse',
      });
    expect(openApiSpec.components.schemas.WalletAutopilotStatusResponse.required).toEqual([
      'utxoHealth',
      'feeSnapshot',
      'settings',
    ]);
  });
}

export function registerOpenApiWalletPolicyTests() {
  it('documents wallet policy and approval routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/approvals/pending', 'get'],
      ['/wallets/{walletId}/policies/events', 'get'],
      ['/wallets/{walletId}/policies/evaluate', 'post'],
      ['/wallets/{walletId}/policies', 'get'],
      ['/wallets/{walletId}/policies', 'post'],
      ['/wallets/{walletId}/policies/{policyId}', 'get'],
      ['/wallets/{walletId}/policies/{policyId}', 'patch'],
      ['/wallets/{walletId}/policies/{policyId}', 'delete'],
      ['/wallets/{walletId}/policies/{policyId}/addresses', 'get'],
      ['/wallets/{walletId}/policies/{policyId}/addresses', 'post'],
      ['/wallets/{walletId}/policies/{policyId}/addresses/{addressId}', 'delete'],
      ['/wallets/{walletId}/drafts/{draftId}/approvals', 'get'],
      ['/wallets/{walletId}/drafts/{draftId}/approvals/{requestId}/vote', 'post'],
      ['/wallets/{walletId}/drafts/{draftId}/override', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.VaultPolicy.properties.type.enum).toEqual([
      ...VALID_POLICY_TYPES,
    ]);
    expect(openApiSpec.components.schemas.VaultPolicy.properties.enforcement.enum).toEqual([
      ...VALID_ENFORCEMENT_MODES,
    ]);
    expect(openApiSpec.components.schemas.VaultPolicy.properties.sourceType.enum).toEqual([
      ...VALID_SOURCE_TYPES,
    ]);
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.required).toEqual(['name', 'type', 'config']);
    expect(openApiSpec.components.schemas.PolicyEvaluationRequest.required).toEqual(['recipient', 'amount']);
    expect(openApiSpec.components.schemas.PolicyEvaluationRequest.properties.amount.oneOf).toContainEqual({
      type: 'string',
      pattern: '^\\d+$',
    });
    expect(openApiSpec.paths['/wallets/{walletId}/policies/events'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/PolicyEventsResponse',
      });
    expect(openApiSpec.components.schemas.PolicyEventsResponse.required).toEqual(['events', 'total']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/evaluate'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/PolicyEvaluationResponse',
      });
    expect(openApiSpec.components.schemas.PolicyEvaluationResponse.required).toEqual(['allowed', 'triggered']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyListResponse',
      });
    expect(openApiSpec.components.schemas.VaultPolicyListResponse.required).toEqual(['policies']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/events'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({ maximum: 200, default: 50 }),
      }),
    );
    expect(openApiSpec.paths['/wallets/{walletId}/policies'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/CreateVaultPolicyRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/policies'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyResponse',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}'].patch.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyResponse',
      });
    expect(openApiSpec.components.schemas.VaultPolicyResponse.required).toEqual(['policy']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletPolicyDeleteResponse',
      });
    expect(openApiSpec.components.schemas.WalletPolicyDeleteResponse.required).toEqual(['success']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}/addresses'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/PolicyAddressListResponse',
      });
    expect(openApiSpec.components.schemas.PolicyAddressListResponse.required).toEqual(['addresses']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}/addresses'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/CreatePolicyAddressRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}/addresses'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/PolicyAddressResponse',
      });
    expect(openApiSpec.components.schemas.PolicyAddressResponse.required).toEqual(['address']);
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}/addresses/{addressId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/WalletPolicyDeleteResponse',
      });
    expect(openApiSpec.components.schemas.ApprovalVoteRequest.properties.decision.enum).toEqual([
      ...VALID_VOTE_DECISIONS,
    ]);
    expect(openApiSpec.paths['/approvals/pending'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/PendingApprovalsResponse',
      });
    expect(openApiSpec.components.schemas.PendingApproval.required).toEqual([
      'id',
      'draftTransactionId',
      'walletId',
      'status',
      'requiredApprovals',
      'currentApprovals',
      'totalVotes',
      'amount',
      'createdAt',
    ]);
    expect(openApiSpec.components.schemas.PendingApprovalsResponse.required).toEqual(['approvals', 'total']);
    expect(openApiSpec.paths['/wallets/{walletId}/drafts/{draftId}/approvals/{requestId}/vote'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/ApprovalVoteRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/drafts/{draftId}/override'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/OwnerOverrideRequest',
      });
  });
}
