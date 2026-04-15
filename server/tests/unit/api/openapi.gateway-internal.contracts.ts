import { expect, it } from 'vitest';

import {
  bearerOnlyAuthSecurity,
  expectDocumentedMethod,
  MOBILE_ACTIONS,
  openApiSpec,
} from './openapi.helpers';

import type { OpenApiPathKey } from './openapi.helpers';

export function registerOpenApiGatewayInternalTests() {
  it('documents root-mounted internal gateway and AI container routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/internal/mobile-permissions/check', 'post'],
      ['/internal/ai/pull-progress', 'post'],
      ['/internal/ai/tx/{id}', 'get'],
      ['/internal/ai/wallet/{walletId}/labels', 'get'],
      ['/internal/ai/wallet/{walletId}/context', 'get'],
      ['/internal/ai/wallet/{walletId}/utxo-health', 'get'],
      ['/internal/ai/wallet/{walletId}/fee-history', 'get'],
      ['/internal/ai/wallet/{walletId}/spending-velocity', 'get'],
      ['/internal/ai/wallet/{walletId}/utxo-age-profile', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
      expect(openApiSpec.paths[path].servers).toEqual([
        {
          url: '/',
          description: 'Application root for internal and gateway-only routes',
        },
      ]);
      expect(openApiSpec.paths[path]['x-internal']).toBe(true);
    }

    for (const path of [
      '/internal/ai/tx/{id}',
      '/internal/ai/wallet/{walletId}/labels',
      '/internal/ai/wallet/{walletId}/context',
      '/internal/ai/wallet/{walletId}/utxo-health',
      '/internal/ai/wallet/{walletId}/fee-history',
      '/internal/ai/wallet/{walletId}/spending-velocity',
      '/internal/ai/wallet/{walletId}/utxo-age-profile',
    ] as const) {
      expect(openApiSpec.paths[path].get.security).toEqual(bearerOnlyAuthSecurity);
    }

    expect(openApiSpec.tags).toContainEqual({
      name: 'Internal',
      description: 'Root-mounted gateway and AI container contracts',
    });
    expect(openApiSpec.components.securitySchemes.gatewaySignature).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Gateway-Signature',
    });
    expect(openApiSpec.components.securitySchemes.gatewayTimestamp).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Gateway-Timestamp',
    });
    // ADR 0001 / 0002: browser cookie auth security schemes. bearerAuth is
    // retained for mobile/gateway callers; cookieAuth + csrfToken are the
    // browser path added in Phase 2.
    expect(openApiSpec.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'sanctuary_access',
    });
    expect(openApiSpec.components.securitySchemes.csrfToken).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-CSRF-Token',
    });

    expect(openApiSpec.paths['/internal/mobile-permissions/check'].post.security).toEqual([
      { gatewaySignature: [], gatewayTimestamp: [] },
    ]);
    expect(
      openApiSpec.paths['/internal/mobile-permissions/check'].post.requestBody.content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/InternalMobilePermissionCheckRequest',
    });
    expect(openApiSpec.components.schemas.InternalMobilePermissionCheckRequest.properties.action.enum).toEqual([
      ...MOBILE_ACTIONS,
    ]);
    expect(openApiSpec.components.schemas.InternalMobilePermissionCheckResponse.required).toEqual(['allowed']);

    expect(openApiSpec.paths['/internal/ai/pull-progress'].post).not.toHaveProperty('security');
    expect(openApiSpec.components.schemas.InternalAIPullProgressRequest.required).toEqual(['model', 'status']);
    expect(openApiSpec.components.schemas.InternalAIPullProgressResponse.required).toEqual(['ok']);

    const sanitizedTransactionSchema = openApiSpec.components.schemas.InternalAITransactionContext;
    expect(sanitizedTransactionSchema.required).toEqual([
      'walletId',
      'amount',
      'direction',
      'date',
      'confirmations',
    ]);
    expect(sanitizedTransactionSchema.properties).not.toHaveProperty('txid');
    expect(sanitizedTransactionSchema.properties).not.toHaveProperty('address');

    expect(openApiSpec.components.schemas.InternalAIWalletContextResponse.properties.stats.required).toEqual([
      'transactionCount',
      'addressCount',
      'utxoCount',
    ]);
    expect(openApiSpec.components.schemas.InternalAIUtxoHealthResponse.required).toEqual([
      'totalUtxos',
      'dustCount',
      'dustValueSats',
      'totalValueSats',
      'avgUtxoSizeSats',
      'consolidationCandidates',
      'distribution',
    ]);
    expect(openApiSpec.components.schemas.InternalAIFeeSnapshot.required).toEqual([
      'timestamp',
      'economy',
      'minimum',
      'fastest',
    ]);
    expect(openApiSpec.components.schemas.InternalAIFeeHistoryResponse.properties.trend.enum).toEqual([
      'rising',
      'falling',
      'stable',
    ]);
    expect(openApiSpec.components.schemas.InternalAISpendingVelocityResponse.required).toEqual([
      '24h',
      '7d',
      '30d',
      '90d',
      'averageDailySpend90d',
      'currentDayVsAverage',
    ]);
    expect(openApiSpec.components.schemas.InternalAIUtxoAgeProfileResponse.required).toEqual([
      'shortTerm',
      'longTerm',
      'thresholdDays',
      'upcomingLongTerm',
    ]);
  });
}
