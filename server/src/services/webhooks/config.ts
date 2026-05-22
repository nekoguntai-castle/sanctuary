import type { Prisma, WebhookEndpoint } from '../../generated/prisma/client';
import type { WebhookFilterConfig, WebhookRetryConfig } from './types';

export type JsonRecord = Record<string, unknown>;

export function asJsonRecord(value: Prisma.JsonValue | null | undefined): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function getFilterConfig(endpoint: WebhookEndpoint): WebhookFilterConfig {
  const filters = asJsonRecord(endpoint.filters);
  return {
    transactionTypes: getStringArray(filters.transactionTypes),
    minAmountSats: typeof filters.minAmountSats === 'string' ? filters.minAmountSats : undefined,
    confirmationThreshold: getOptionalNumber(filters.confirmationThreshold),
  };
}

export function getRetryConfig(endpoint: WebhookEndpoint): Required<WebhookRetryConfig> {
  const retryConfig = asJsonRecord(endpoint.retryConfig);
  return {
    initialDelayMs: getPositiveNumber(retryConfig.initialDelayMs, 30_000),
    maxDelayMs: getPositiveNumber(retryConfig.maxDelayMs, 30 * 60_000),
    backoffMultiplier: getPositiveNumber(retryConfig.backoffMultiplier, 2),
  };
}

export function getProfileConfig(endpoint: WebhookEndpoint): JsonRecord {
  return asJsonRecord(endpoint.profileConfig);
}

export function getHeaderConfig(endpoint: WebhookEndpoint): JsonRecord {
  return asJsonRecord(endpoint.headerConfig);
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
