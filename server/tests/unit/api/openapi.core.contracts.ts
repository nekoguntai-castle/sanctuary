import { expect, it } from 'vitest';

import {
  openApiSpec,
  browserOrBearerAuthSecurity,
  invokeRoute,
  expectDocumentedMethod,
} from './openapi.helpers';

import type {
  OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiCoreTests() {
  it('serves Swagger UI html', async () => {
    const response = await invokeRoute('GET', '/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline' https://unpkg.com");
    expect(response.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline' https://unpkg.com");
    expect(String(response.body)).toContain('swagger-ui-bundle.js');
    expect(String(response.body)).toContain('/api/v1/docs/openapi.json');
  });

  it('serves OpenAPI spec json', async () => {
    const response = await invokeRoute('GET', '/openapi.json');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-security-policy']).toBeUndefined();
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

    expect(openApiSpec.paths['/price/cache/stats'].get.security).toEqual(browserOrBearerAuthSecurity);
    expect(openApiSpec.paths['/price/cache/clear'].post.security).toEqual(browserOrBearerAuthSecurity);
    expect(openApiSpec.paths['/price/cache/duration'].post.security).toEqual(browserOrBearerAuthSecurity);
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
    expect(openApiSpec.paths['/bitcoin/address/{addressId}/sync'].post.security).toEqual(browserOrBearerAuthSecurity);
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

    expect(openApiSpec.paths['/node/test'].post.security).toEqual(browserOrBearerAuthSecurity);
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
}

export function registerOpenApiHealthTests() {
  it('documents API health and readiness routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/health', 'get'],
      ['/health/live', 'get'],
      ['/health/ready', 'get'],
      ['/health/circuits', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
      expect(openApiSpec.paths[path][method]).not.toHaveProperty('security');
    }

    expect(openApiSpec.components.schemas.HealthStatus.enum).toEqual([
      'healthy',
      'degraded',
      'unhealthy',
    ]);
    expect(openApiSpec.paths['/health'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/HealthResponse',
    });
    expect(openApiSpec.paths['/health'].get.responses[503].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/HealthResponse',
    });
    expect(openApiSpec.components.schemas.HealthResponse.required).toEqual([
      'status',
      'timestamp',
      'uptime',
      'version',
      'components',
    ]);
    expect(openApiSpec.components.schemas.HealthResponse.properties.components.required).toEqual([
      'database',
      'redis',
      'electrum',
      'websocket',
      'sync',
      'jobQueue',
      'cacheInvalidation',
      'startup',
      'circuitBreakers',
      'memory',
      'disk',
    ]);
    expect(openApiSpec.components.schemas.HealthLiveResponse.properties.status.enum).toEqual(['alive']);
    expect(openApiSpec.components.schemas.HealthReadyResponse.properties.status.enum).toEqual([
      'ready',
      'not ready',
    ]);
    expect(openApiSpec.paths['/health/ready'].get.responses[503].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/HealthReadyResponse',
    });
    expect(openApiSpec.components.schemas.CircuitBreakerHealth.properties.state.enum).toEqual([
      'closed',
      'open',
      'half-open',
    ]);
    expect(openApiSpec.components.schemas.HealthCircuitsResponse.required).toEqual(['overall', 'circuits']);
  });
}
