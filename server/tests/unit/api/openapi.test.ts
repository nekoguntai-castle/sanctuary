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
import {
  WALLET_IMPORT_FORMAT_VALUES,
  WALLET_IMPORT_NETWORK_VALUES,
  WALLET_IMPORT_SCRIPT_TYPE_VALUES,
  WALLET_IMPORT_WALLET_TYPE_VALUES,
} from '../../../src/services/walletImport/types';
import { WALLET_EXPORT_FORMAT_VALUES } from '../../../src/services/export/types';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../../src/services/autopilot/types';
import {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  VALID_SOURCE_TYPES,
  VALID_VOTE_DECISIONS,
} from '../../../src/services/vaultPolicy/types';
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_STATS_DAYS,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../../../src/constants';
import { FEATURE_FLAG_KEYS } from '../../../src/services/featureFlags/definitions';

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

  it('documents price routes including admin cache controls', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/price', 'get'],
      ['/price/multiple', 'get'],
      ['/price/from/{provider}', 'get'],
      ['/price/convert/to-fiat', 'post'],
      ['/price/convert/to-sats', 'post'],
      ['/price/currencies', 'get'],
      ['/price/providers', 'get'],
      ['/price/health', 'get'],
      ['/price/cache/stats', 'get'],
      ['/price/cache/clear', 'post'],
      ['/price/cache/duration', 'post'],
      ['/price/historical', 'get'],
      ['/price/history', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/price'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'useCache',
      schema: expect.objectContaining({ type: 'boolean', default: true }),
    }));
    expect(openApiSpec.components.schemas.Price.required).toEqual([
      'price',
      'currency',
      'sources',
      'median',
      'average',
      'timestamp',
      'cached',
    ]);
    expect(openApiSpec.components.schemas.Price.properties.sources.items).toEqual({
      $ref: '#/components/schemas/PriceSource',
    });
    expect(openApiSpec.components.schemas.PriceSource.required).toEqual([
      'provider',
      'price',
      'currency',
      'timestamp',
    ]);

    expect(openApiSpec.paths['/price/multiple'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'currencies',
      in: 'query',
      required: true,
    }));
    expect(openApiSpec.components.schemas.PriceMultipleResponse.additionalProperties).toEqual({
      $ref: '#/components/schemas/Price',
    });
    expect(openApiSpec.paths['/price/from/{provider}'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'provider',
      in: 'path',
      required: true,
    }));

    expect(openApiSpec.paths['/price/convert/to-fiat'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PriceConvertToFiatRequest',
    });
    expect(openApiSpec.components.schemas.PriceConvertToFiatRequest.required).toEqual(['sats']);
    expect(openApiSpec.components.schemas.PriceConvertToSatsRequest.required).toEqual(['amount']);
    expect(openApiSpec.components.schemas.PriceCurrencyListResponse.required).toEqual(['currencies', 'count']);
    expect(openApiSpec.components.schemas.PriceProviderListResponse.required).toEqual(['providers', 'count']);
    expect(openApiSpec.components.schemas.PriceHealthResponse.properties.providers.additionalProperties).toEqual({
      type: 'boolean',
    });

    expect(openApiSpec.paths['/price/cache/stats'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.paths['/price/cache/clear'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.paths['/price/cache/duration'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.paths['/price/cache/stats'].get.responses).toHaveProperty('403');
    expect(openApiSpec.components.schemas.PriceCacheStats).toHaveProperty('additionalProperties', true);
    expect(openApiSpec.components.schemas.PriceCacheStats.required).toEqual(['size', 'entries']);
    expect(openApiSpec.paths['/price/cache/duration'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PriceCacheDurationRequest',
    });
    expect(openApiSpec.components.schemas.PriceCacheDurationRequest.required).toEqual(['duration']);
    expect(openApiSpec.components.schemas.PriceCacheDurationRequest.properties.duration).toMatchObject({
      minimum: 0,
    });
    expect(openApiSpec.paths['/price/cache/duration'].post.responses[400].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PriceSimpleErrorResponse',
    });

    expect(openApiSpec.paths['/price/historical'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'date',
      in: 'query',
      required: true,
    }));
    expect(openApiSpec.paths['/price/history'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'days',
      schema: expect.objectContaining({ minimum: 1, maximum: 365, default: 30 }),
    }));
    expect(openApiSpec.components.schemas.PriceHistoryResponse.properties.history.items).toEqual({
      $ref: '#/components/schemas/PriceHistoryPoint',
    });
  });

  it('documents broader Bitcoin utility and node routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/bitcoin/status', 'get'],
      ['/bitcoin/mempool', 'get'],
      ['/bitcoin/blocks/recent', 'get'],
      ['/bitcoin/block/{height}', 'get'],
      ['/bitcoin/fees', 'get'],
      ['/bitcoin/fees/advanced', 'get'],
      ['/bitcoin/utils/estimate-fee', 'post'],
      ['/bitcoin/utils/estimate-optimal-fee', 'post'],
      ['/bitcoin/address/validate', 'post'],
      ['/bitcoin/address/{address}', 'get'],
      ['/bitcoin/address/{addressId}/sync', 'post'],
      ['/bitcoin/address-lookup', 'post'],
      ['/bitcoin/transaction/{txid}', 'get'],
      ['/bitcoin/broadcast', 'post'],
      ['/bitcoin/transaction/{txid}/rbf-check', 'post'],
      ['/bitcoin/transaction/{txid}/rbf', 'post'],
      ['/bitcoin/transaction/cpfp', 'post'],
      ['/bitcoin/transaction/batch', 'post'],
      ['/bitcoin/wallet/{walletId}/sync', 'post'],
      ['/bitcoin/wallet/{walletId}/update-confirmations', 'post'],
      ['/node/test', 'post'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.tags).toContainEqual({ name: 'Node', description: 'Bitcoin node connectivity checks' });
    expect(openApiSpec.paths['/bitcoin/mempool'].get.responses[500].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/BitcoinSimpleErrorResponse',
    });
    expect(openApiSpec.components.schemas.BitcoinMempoolResponse.required).toEqual([
      'mempool',
      'blocks',
      'mempoolInfo',
    ]);
    expect(openApiSpec.paths['/bitcoin/blocks/recent'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'count',
      schema: expect.objectContaining({ minimum: 1, maximum: 100, default: 10 }),
    }));
    expect(openApiSpec.paths['/bitcoin/block/{height}'].get.parameters).toContainEqual(expect.objectContaining({
      name: 'height',
      in: 'path',
      required: true,
      schema: expect.objectContaining({ minimum: 0 }),
    }));

    expect(openApiSpec.components.schemas.AdvancedFeeEstimates.required).toEqual([
      'fastest',
      'fast',
      'medium',
      'slow',
      'minimum',
    ]);
    expect(openApiSpec.components.schemas.BitcoinScriptType.enum).toEqual([
      'legacy',
      'nested_segwit',
      'native_segwit',
      'taproot',
    ]);
    expect(openApiSpec.components.schemas.BitcoinFeePriority.enum).toEqual([
      'fastest',
      'fast',
      'medium',
      'slow',
      'minimum',
    ]);
    expect(openApiSpec.components.schemas.EstimateFeeRequest.required).toEqual([
      'inputCount',
      'outputCount',
      'feeRate',
    ]);
    expect(openApiSpec.components.schemas.EstimateOptimalFeeRequest.required).toEqual([
      'inputCount',
      'outputCount',
    ]);

    expect(openApiSpec.components.schemas.AddressValidationRequest.required).toEqual(['address']);
    expect(openApiSpec.components.schemas.AddressValidationRequest.properties.network).toMatchObject({
      enum: ['mainnet', 'testnet', 'regtest'],
      default: 'mainnet',
    });
    expect(openApiSpec.components.schemas.AddressLookupRequest.properties.addresses).toMatchObject({
      minItems: 1,
      maxItems: 100,
    });
    expect(openApiSpec.paths['/bitcoin/address/{addressId}/sync'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.paths['/bitcoin/address-lookup'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AddressLookupRequest',
    });

    expect(openApiSpec.components.schemas.BroadcastRequest.required).toEqual(['rawTx']);
    expect(openApiSpec.components.schemas.BroadcastRequest.properties).not.toHaveProperty('hex');
    expect(openApiSpec.components.schemas.BroadcastRequest.properties).not.toHaveProperty('walletId');
    expect(openApiSpec.components.schemas.BroadcastResponse.required).toEqual(['txid', 'broadcasted']);
    expect(openApiSpec.components.schemas.BroadcastResponse.properties).not.toHaveProperty('success');
    expect(openApiSpec.components.schemas.RbfCheckResponse.required).toEqual(['replaceable']);
    expect(openApiSpec.components.schemas.RbfCheckResponse.properties).toHaveProperty('minNewFeeRate');
    expect(openApiSpec.components.schemas.RbfCheckResponse.properties).not.toHaveProperty('canReplace');
    expect(openApiSpec.components.schemas.RbfRequest.required).toEqual(['newFeeRate', 'walletId']);
    expect(openApiSpec.components.schemas.CpfpRequest.required).toEqual([
      'parentTxid',
      'parentVout',
      'targetFeeRate',
      'recipientAddress',
      'walletId',
    ]);
    expect(openApiSpec.components.schemas.BatchTransactionRequest.required).toEqual([
      'recipients',
      'feeRate',
      'walletId',
    ]);
    expect(openApiSpec.components.schemas.BatchTransactionRequest.properties.recipients).toMatchObject({
      minItems: 1,
    });
    expect(openApiSpec.components.schemas.BitcoinLegacyWalletSyncResponse.required).toEqual(['message']);
    expect(openApiSpec.components.schemas.BitcoinUpdateConfirmationsResponse.required).toEqual(['message', 'updated']);
    expect(openApiSpec.components.schemas.BitcoinUpdateConfirmationsResponse.properties.updated).toMatchObject({
      type: 'array',
    });
    expect(openApiSpec.components.schemas.RbfResponse.properties.inputPaths.items).toEqual({ type: 'string' });

    expect(openApiSpec.paths['/node/test'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.components.schemas.NodeConnectionTestRequest.required).toEqual(['host', 'port', 'protocol']);
    expect(openApiSpec.components.schemas.NodeConnectionTestRequest.properties.nodeType).toMatchObject({
      enum: ['electrum'],
      default: 'electrum',
    });
    expect(openApiSpec.components.schemas.NodeConnectionTestRequest.properties.protocol.enum).toEqual(['tcp', 'ssl']);
    expect(openApiSpec.components.schemas.NodeConnectionTestRequest.properties.port.oneOf).toContainEqual({
      type: 'integer',
      minimum: 1,
      maximum: 65535,
    });
  });

  it('documents sync management routes beyond gateway wallet sync', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/sync/wallet/{walletId}', 'post'],
      ['/sync/queue/{walletId}', 'post'],
      ['/sync/status/{walletId}', 'get'],
      ['/sync/logs/{walletId}', 'get'],
      ['/sync/user', 'post'],
      ['/sync/reset/{walletId}', 'post'],
      ['/sync/resync/{walletId}', 'post'],
      ['/sync/network/{network}', 'post'],
      ['/sync/network/{network}/resync', 'post'],
      ['/sync/network/{network}/status', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.SyncPriority.enum).toEqual(['high', 'normal', 'low']);
    expect(openApiSpec.components.schemas.SyncResult.required).toEqual([
      'success',
      'syncedAddresses',
      'newTransactions',
      'newUtxos',
    ]);
    expect(openApiSpec.components.schemas.SyncResult.properties).not.toHaveProperty('walletId');
    expect(openApiSpec.paths['/sync/queue/{walletId}'].post.requestBody).toMatchObject({
      required: false,
    });
    expect(openApiSpec.paths['/sync/queue/{walletId}'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/SyncPriorityRequest',
    });
    expect(openApiSpec.components.schemas.QueuedWalletSyncResponse.required).toEqual([
      'queued',
      'queuePosition',
      'syncInProgress',
    ]);
    expect(openApiSpec.components.schemas.WalletSyncStatus.required).toEqual([
      'lastSyncedAt',
      'syncStatus',
      'syncInProgress',
      'isStale',
      'queuePosition',
    ]);
    expect(openApiSpec.components.schemas.WalletSyncLogsResponse.required).toEqual(['logs']);
    expect(openApiSpec.components.schemas.ResyncWalletResponse.required).toEqual([
      'success',
      'message',
      'deletedTransactions',
    ]);
    expect(openApiSpec.components.schemas.NetworkSyncResponse.required).toEqual([
      'success',
      'queued',
      'walletIds',
    ]);
    expect(openApiSpec.components.schemas.NetworkResyncResponse.allOf).toContainEqual({
      $ref: '#/components/schemas/NetworkSyncResponse',
    });
    expect(openApiSpec.components.schemas.NetworkSyncStatusResponse.properties.network.enum).toEqual([
      'mainnet',
      'testnet',
      'signet',
    ]);
    expect(openApiSpec.paths['/sync/network/{network}'].post.parameters).toContainEqual(expect.objectContaining({
      name: 'network',
      in: 'path',
      schema: expect.objectContaining({ enum: ['mainnet', 'testnet', 'signet'] }),
    }));
    expect(openApiSpec.paths['/sync/network/{network}/resync'].post.parameters).toContainEqual(expect.objectContaining({
      name: 'X-Confirm-Resync',
      in: 'header',
      required: true,
      schema: expect.objectContaining({ enum: ['true'] }),
    }));
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

  it('documents wallet policy and approval routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
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
    expect(openApiSpec.paths['/wallets/{walletId}/policies/{policyId}/addresses'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/CreatePolicyAddressRequest',
      });
    expect(openApiSpec.components.schemas.ApprovalVoteRequest.properties.decision.enum).toEqual([
      ...VALID_VOTE_DECISIONS,
    ]);
    expect(openApiSpec.paths['/wallets/{walletId}/drafts/{draftId}/approvals/{requestId}/vote'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/ApprovalVoteRequest',
      });
    expect(openApiSpec.paths['/wallets/{walletId}/drafts/{draftId}/override'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/OwnerOverrideRequest',
      });
  });

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

    expect(openApiSpec.paths['/admin/support-package'].post.responses[200].headers).toHaveProperty(
      'Content-Disposition',
    );
    expect(openApiSpec.paths['/admin/support-package'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSupportPackage',
      });
    expect(openApiSpec.paths['/admin/support-package'].post.responses[429].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.components.schemas.AdminSupportPackage.required).toEqual([
      'version',
      'generatedAt',
      'serverVersion',
      'collectors',
      'meta',
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
      'mempoolEstimator',
      'poolEnabled',
      'poolMinConnections',
      'poolMaxConnections',
      'poolLoadBalancing',
      'servers',
    ]);
    expect(openApiSpec.components.schemas.AdminNodeConfig.properties.type.enum).toEqual(['electrum']);
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
          enum: ['mainnet', 'testnet', 'signet', 'regtest'],
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
      'testnet',
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
      enum: ['mainnet', 'testnet', 'signet', 'regtest'],
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
            enum: ['mainnet', 'testnet', 'signet', 'regtest'],
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
      'testnet',
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

  it('documents admin infrastructure and DLQ routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/tor-container/status', 'get'],
      ['/admin/tor-container/start', 'post'],
      ['/admin/tor-container/stop', 'post'],
      ['/admin/metrics/cache', 'get'],
      ['/admin/websocket/stats', 'get'],
      ['/admin/dlq', 'get'],
      ['/admin/dlq/{dlqId}', 'delete'],
      ['/admin/dlq/{dlqId}/retry', 'post'],
      ['/admin/dlq/category/{category}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/tor-container/status'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminTorContainerStatusResponse',
      });
    expect(openApiSpec.components.schemas.AdminTorContainerStatusResponse.required).toEqual([
      'available',
      'exists',
      'running',
    ]);
    expect(openApiSpec.paths['/admin/tor-container/start'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminContainerActionResponse',
      });
    expect(openApiSpec.paths['/admin/tor-container/start'].post.responses[400].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.paths['/admin/tor-container/stop'].post.responses[400].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.components.schemas.AdminContainerActionResponse.required).toEqual([
      'success',
      'message',
    ]);

    expect(openApiSpec.paths['/admin/metrics/cache'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminCacheMetricsResponse',
      });
    expect(openApiSpec.components.schemas.AdminCacheMetricsResponse.required).toEqual([
      'timestamp',
      'stats',
      'hitRate',
    ]);
    expect(openApiSpec.components.schemas.AdminCacheStats).toHaveProperty('additionalProperties', true);

    expect(openApiSpec.paths['/admin/websocket/stats'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminWebSocketStatsResponse',
      });
    expect(openApiSpec.components.schemas.AdminWebSocketStatsResponse.required).toEqual([
      'connections',
      'subscriptions',
      'rateLimits',
      'recentRateLimitEvents',
    ]);
    expect(openApiSpec.components.schemas.AdminWebSocketRateLimitEvent.properties.reason.enum).toEqual([
      'grace_period_exceeded',
      'per_second_exceeded',
      'subscription_limit',
      'queue_overflow',
    ]);

    expect(openApiSpec.components.schemas.AdminDeadLetterCategory.enum).toEqual([
      'sync',
      'push',
      'telegram',
      'notification',
      'electrum',
      'transaction',
      'other',
    ]);
    expect(openApiSpec.paths['/admin/dlq'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({
          maximum: 500,
          default: 100,
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/dlq'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'category',
        schema: expect.objectContaining({
          enum: ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'],
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/dlq'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeadLetterQueueResponse',
      });
    expect(openApiSpec.components.schemas.AdminDeadLetterEntry.properties.errorStack).toMatchObject({
      description: expect.stringContaining('Truncated'),
    });
    expect(openApiSpec.components.schemas.AdminDeadLetterQueueResponse.required).toEqual([
      'stats',
      'entries',
    ]);

    expect(openApiSpec.paths['/admin/dlq/{dlqId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'dlqId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/dlq/{dlqId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSuccessResponse',
      });
    expect(openApiSpec.components.schemas.AdminSuccessResponse.required).toEqual(['success']);

    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeadLetterRetryResponse',
      });
    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/ApiError',
      });
    expect(openApiSpec.components.schemas.AdminDeadLetterRetryResponse.required).toEqual([
      'entry',
      'retry',
    ]);

    expect(openApiSpec.paths['/admin/dlq/category/{category}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'category',
        schema: { type: 'string', enum: ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'] },
      }),
    );
    expect(openApiSpec.paths['/admin/dlq/category/{category}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminClearDeadLetterCategoryResponse',
      });
    expect(openApiSpec.components.schemas.AdminClearDeadLetterCategoryResponse.required).toEqual([
      'success',
      'removed',
    ]);
  });

  it('documents admin monitoring service routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/monitoring/services', 'get'],
      ['/admin/monitoring/services/{serviceId}', 'put'],
      ['/admin/monitoring/grafana', 'get'],
      ['/admin/monitoring/grafana', 'put'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminMonitoringServiceId.enum).toEqual([
      'grafana',
      'prometheus',
      'jaeger',
    ]);
    expect(openApiSpec.paths['/admin/monitoring/services'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'checkHealth',
        in: 'query',
        schema: expect.objectContaining({
          type: 'boolean',
          default: false,
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/monitoring/services'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminMonitoringServicesResponse',
      });
    expect(openApiSpec.components.schemas.AdminMonitoringServicesResponse.required).toEqual([
      'enabled',
      'services',
    ]);
    expect(openApiSpec.components.schemas.AdminMonitoringService.properties.id).toEqual({
      $ref: '#/components/schemas/AdminMonitoringServiceId',
    });
    expect(openApiSpec.components.schemas.AdminMonitoringService.properties.status.enum).toEqual([
      'unknown',
      'healthy',
      'unhealthy',
    ]);

    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'serviceId',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: ['grafana', 'prometheus', 'jaeger'] },
      }),
    );
    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateMonitoringServiceRequest',
      });
    expect(openApiSpec.components.schemas.AdminUpdateMonitoringServiceRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminUpdateMonitoringServiceRequest.properties.customUrl).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSuccessResponse',
      });

    expect(openApiSpec.paths['/admin/monitoring/grafana'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGrafanaConfigResponse',
      });
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.required).toEqual([
      'username',
      'passwordSource',
      'password',
      'anonymousAccess',
      'anonymousAccessNote',
    ]);
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.properties.passwordSource.enum).toEqual([
      'GRAFANA_PASSWORD',
      'ENCRYPTION_KEY',
    ]);
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.properties.password).toMatchObject({
      format: 'password',
    });

    expect(openApiSpec.paths['/admin/monitoring/grafana'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateGrafanaRequest',
      });
    expect(openApiSpec.components.schemas.AdminUpdateGrafanaRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.paths['/admin/monitoring/grafana'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGrafanaUpdateResponse',
      });
    expect(openApiSpec.components.schemas.AdminGrafanaUpdateResponse.required).toEqual([
      'success',
      'message',
    ]);
  });

  it('documents admin user management routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/users', 'get'],
      ['/admin/users', 'post'],
      ['/admin/users/{userId}', 'put'],
      ['/admin/users/{userId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminUser.required).toEqual([
      'id',
      'username',
      'email',
      'emailVerified',
      'isAdmin',
      'createdAt',
    ]);
    expect(openApiSpec.components.schemas.AdminUser.properties.email).toMatchObject({
      format: 'email',
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.required).toEqual([
      'username',
      'password',
      'email',
    ]);
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.username).toMatchObject({
      minLength: 3,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.password).toMatchObject({
      minLength: 8,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.email).toMatchObject({
      format: 'email',
    });
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.required).toBeUndefined();
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.properties.email.oneOf).toContainEqual({
      type: 'string',
      format: 'email',
    });
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.properties.email.oneOf).toContainEqual({
      type: 'string',
      enum: [''],
    });
    expect(openApiSpec.paths['/admin/users'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/AdminUser' },
    });
    expect(openApiSpec.paths['/admin/users'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminCreateUserRequest',
    });
    expect(openApiSpec.paths['/admin/users'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminUser',
    });
    expect(openApiSpec.paths['/admin/users/{userId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'userId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/users/{userId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateUserRequest',
      });
    expect(openApiSpec.paths['/admin/users/{userId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeleteUserResponse',
      });
  });

  it('documents admin group management routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/groups', 'get'],
      ['/admin/groups', 'post'],
      ['/admin/groups/{groupId}', 'put'],
      ['/admin/groups/{groupId}', 'delete'],
      ['/admin/groups/{groupId}/members', 'post'],
      ['/admin/groups/{groupId}/members/{userId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminGroupRole.enum).toEqual(['member', 'admin']);
    expect(openApiSpec.components.schemas.AdminGroup.required).toEqual([
      'id',
      'name',
      'description',
      'purpose',
      'createdAt',
      'updatedAt',
      'members',
    ]);
    expect(openApiSpec.components.schemas.AdminGroup.properties.description).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminGroup.properties.purpose).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminGroup.properties.members.items).toEqual({
      $ref: '#/components/schemas/AdminGroupMember',
    });
    expect(openApiSpec.components.schemas.AdminGroupMember.required).toEqual([
      'userId',
      'username',
      'role',
    ]);
    expect(openApiSpec.components.schemas.AdminGroupMember.properties.role).toEqual({
      $ref: '#/components/schemas/AdminGroupRole',
    });
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest.required).toEqual(['name']);
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest.properties.memberIds.items).toEqual({
      type: 'string',
    });
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminUpdateGroupRequest.required).toBeUndefined();
    expect(openApiSpec.components.schemas.AdminUpdateGroupRequest.properties.description).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminAddGroupMemberRequest.required).toEqual(['userId']);
    expect(openApiSpec.components.schemas.AdminAddGroupMemberRequest.properties.role).toEqual({
      $ref: '#/components/schemas/AdminGroupRole',
    });
    expect(openApiSpec.paths['/admin/groups'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/AdminGroup' },
    });
    expect(openApiSpec.paths['/admin/groups'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminCreateGroupRequest',
    });
    expect(openApiSpec.paths['/admin/groups'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminGroup',
    });
    expect(openApiSpec.paths['/admin/groups/{groupId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'groupId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/groups/{groupId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateGroupRequest',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeleteGroupResponse',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminAddGroupMemberRequest',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.responses).toHaveProperty('409');
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGroupMember',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members/{userId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'userId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/groups/{groupId}/members/{userId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminRemoveGroupMemberResponse',
      });
  });

  it('documents admin system policy routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/policies', 'get'],
      ['/admin/policies', 'post'],
      ['/admin/policies/{policyId}', 'patch'],
      ['/admin/policies/{policyId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths).not.toHaveProperty('/admin/groups/{groupId}/policies');
    expect(openApiSpec.paths['/admin/policies'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VaultPolicyListResponse',
    });
    expect(openApiSpec.paths['/admin/policies'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CreateVaultPolicyRequest',
    });
    expect(openApiSpec.paths['/admin/policies'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VaultPolicyResponse',
    });
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.required).toEqual([
      'name',
      'type',
      'config',
    ]);
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.properties.type.enum).toEqual([
      ...VALID_POLICY_TYPES,
    ]);
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.properties.enforcement.enum).toEqual([
      ...VALID_ENFORCEMENT_MODES,
    ]);
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.parameters).toContainEqual(
      expect.objectContaining({
        name: 'policyId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/UpdateVaultPolicyRequest',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyResponse',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses).toHaveProperty('403');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses).toHaveProperty('404');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'policyId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminPolicyDeleteResponse',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses).toHaveProperty('403');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses).toHaveProperty('404');
    expect(openApiSpec.components.schemas.AdminPolicyDeleteResponse.required).toEqual(['success']);
  });

  it('documents admin audit log routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/audit-logs', 'get'],
      ['/admin/audit-logs/stats', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/audit-logs'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminAuditLogsResponse',
    });
    expect(openApiSpec.paths['/admin/audit-logs'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'username',
        schema: expect.objectContaining({ type: 'string' }),
      }),
    );
    expect(openApiSpec.paths['/admin/audit-logs'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({
          maximum: 500,
          default: AUDIT_DEFAULT_PAGE_SIZE,
        }),
      }),
    );
    expect(openApiSpec.components.schemas.AdminAuditLogsResponse.required).toEqual([
      'logs',
      'total',
      'limit',
      'offset',
    ]);
    expect(openApiSpec.components.schemas.AdminAuditLog.properties.userId).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminAuditLog.properties.details).toMatchObject({
      nullable: true,
    });

    expect(openApiSpec.paths['/admin/audit-logs/stats'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminAuditStatsResponse',
      });
    expect(openApiSpec.paths['/admin/audit-logs/stats'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'days',
        schema: expect.objectContaining({ minimum: 1, default: AUDIT_STATS_DAYS }),
      }),
    );
    expect(openApiSpec.components.schemas.AdminAuditStatsResponse.required).toEqual([
      'totalEvents',
      'byCategory',
      'byAction',
      'failedEvents',
    ]);
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
