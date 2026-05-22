/**
 * Webhooks Support Package Collector
 *
 * Emits wallet webhook health and topology without endpoint secrets, request
 * bodies, signed headers, full URLs, raw receiver-specific mapping keys, or
 * raw failure messages.
 */

import net from 'node:net';
import { WEBHOOK_VALUATION_MODE_DISABLED } from '@sanctuary/shared/constants/webhooks';
import { webhookRepository } from '../../../repositories';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';

type JsonRecord = Record<string, unknown>;

const hostKindPatterns: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'loopback', pattern: /^(?:127\.|::1$)/ },
  { kind: 'link-local', pattern: /^(?:169\.254\.|fe80:)/ },
  { kind: 'private-ip', pattern: /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd])/ },
];

registerCollector('webhooks', async (context: CollectorContext) => {
  const endpoints = await webhookRepository.listSupportPackageEndpoints();
  const summaries = endpoints.map(endpoint => {
    const deliveries = endpoint.deliveries ?? [];
    return {
      id: context.anonymize('webhook-endpoint', endpoint.id),
      walletId: context.anonymize('wallet', endpoint.walletId),
      enabled: endpoint.enabled,
      url: summarizeUrl(endpoint.url, context),
      eventTypeCount: endpoint.eventTypes.length,
      usesWildcardEvents: endpoint.eventTypes.some(eventType => eventType.includes('*')),
      payloadProfile: endpoint.payloadProfile,
      authType: endpoint.authType,
      hasSecret: Boolean(endpoint.secretEncrypted),
      headerConfig: summarizeHeaderConfig(toRecord(endpoint.headerConfig)),
      profileConfig: summarizeProfileConfig(toRecord(endpoint.profileConfig)),
      retryConfig: summarizeRetryConfig(toRecord(endpoint.retryConfig), endpoint.maxAttempts),
      failureNotificationEnabled: endpoint.failureNotificationEnabled,
      lastDeliveryStatus: endpoint.lastDeliveryStatus,
      lastDeliveredAt: endpoint.lastDeliveredAt?.toISOString() ?? null,
      deliveryHealth: summarizeDeliveries(deliveries),
    };
  });

  return {
    endpointCount: summaries.length,
    enabledCount: summaries.filter(endpoint => endpoint.enabled).length,
    profileCounts: countBy(summaries, endpoint => endpoint.payloadProfile),
    authCounts: countBy(summaries, endpoint => endpoint.authType),
    deliveryStatusCounts: countBy(summaries, endpoint => endpoint.lastDeliveryStatus ?? 'none'),
    endpoints: summaries,
  };
});

function summarizeUrl(urlValue: string, context: CollectorContext) {
  try {
    const url = new URL(urlValue);
    return {
      valid: true,
      scheme: url.protocol.replace(':', ''),
      hostHash: context.anonymize('webhook-host', url.host.toLowerCase()),
      hostKind: classifyHost(url.hostname),
      pathDepth: url.pathname.split('/').filter(Boolean).length,
    };
  } catch {
    return { valid: false };
  }
}

function summarizeHeaderConfig(config: JsonRecord) {
  const staticHeaders = toRecord(config.headers);
  const hmac = toRecord(config.hmac);
  return {
    staticHeaderCount: Object.keys(staticHeaders).length,
    hasConfiguredHmac: Object.keys(hmac).length > 0,
    configuredHmacComponentCount: Array.isArray(hmac.canonical) ? hmac.canonical.length : 0,
  };
}

function summarizeProfileConfig(config: JsonRecord) {
  const body = toRecord(config.body);
  const valuation = toRecord(config.valuation);
  return {
    hasProfileConfig: Object.keys(config).length > 0,
    bodyMappingFieldCount: Object.keys(body).length,
    includeNulls: config.includeNulls === true,
    valuationMode: getString(valuation.mode) ?? WEBHOOK_VALUATION_MODE_DISABLED,
    valuationCurrency: getString(valuation.currency) ?? null,
  };
}

function summarizeRetryConfig(config: JsonRecord, maxAttempts: number) {
  return {
    maxAttempts,
    hasCustomRetryConfig: Object.keys(config).length > 0,
    initialDelayMs: getNumber(config.initialDelayMs),
    maxDelayMs: getNumber(config.maxDelayMs),
    backoffMultiplier: getNumber(config.backoffMultiplier),
  };
}

function summarizeDeliveries(
  deliveries: Array<{
    status: string;
    attemptCount: number;
    lastStatusCode: number | null;
    lastError: string | null;
    createdAt: Date;
  }>,
) {
  const newest = deliveries[0];
  return {
    sampledCount: deliveries.length,
    statusCounts: countBy(deliveries, delivery => delivery.status),
    maxAttemptCount: deliveries.reduce((max, delivery) => Math.max(max, delivery.attemptCount), 0),
    lastStatusCode: newest?.lastStatusCode ?? null,
    lastErrorKind: classifyError(newest?.lastError ?? null),
    newestCreatedAt: newest?.createdAt.toISOString() ?? null,
  };
}

function classifyError(error: string | null): string | null {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (lower.includes('http 4')) return 'http_4xx';
  if (lower.includes('http 5')) return 'http_5xx';
  if (lower.includes('timeout') || lower.includes('aborted')) return 'timeout';
  if (lower.includes('fetch') || lower.includes('network')) return 'network';
  if (lower.includes('blocked') || lower.includes('https') || lower.includes('allowlist')) return 'endpoint_policy';
  return 'other';
}

function countBy<T>(items: T[], selectKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selectKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function classifyHost(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === 'localhost') return 'loopback';
  if (net.isIP(normalized) === 0) return 'dns';
  const match = hostKindPatterns.find(entry => entry.pattern.test(normalized));
  return match ? match.kind : 'public-ip';
}
