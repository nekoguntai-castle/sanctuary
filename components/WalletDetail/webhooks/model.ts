import type { WalletWebhookInput } from '../../../types';
import {
  WEBHOOK_AUTH_TYPE_NONE,
  WEBHOOK_DEFAULT_WALLET_TRANSACTION_EVENTS,
  WEBHOOK_PAYLOAD_PROFILE_GENERIC,
  WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
  WEBHOOK_VALUATION_MODE_DISABLED,
  type WebhookAuthType,
  type WebhookPayloadProfile,
  type WebhookValuationMode,
} from '@sanctuary/shared/constants/webhooks';

export type PayloadProfile = WebhookPayloadProfile;
export type AuthType = WebhookAuthType;
export type ValuationMode = WebhookValuationMode;

export interface WebhookFormState {
  name: string;
  url: string;
  eventTypes: string;
  payloadProfile: PayloadProfile;
  authType: AuthType;
  secret: string;
  maxAttempts: number;
  failureNotificationEnabled: boolean;
  advancedOpen: boolean;
  filtersJson: string;
  headerConfigJson: string;
  bodyMappingJson: string;
  valuationMode: ValuationMode;
  valuationCurrency: string;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryBackoffMultiplier: number;
}

export const DEFAULT_EVENTS = WEBHOOK_DEFAULT_WALLET_TRANSACTION_EVENTS.join(',');

export const DEFAULT_BODY_MAPPING = JSON.stringify({
  eventId: { path: 'eventId' },
  eventType: { path: 'eventType' },
  occurredAt: { path: 'occurredAt' },
  walletId: { path: 'wallet.id' },
  walletName: { path: 'wallet.name' },
  amountSats: { path: 'transaction.amountSats' },
  fiatCurrency: { path: 'valuation.currency' },
  fiatValueMinorUnits: { path: 'valuation.valueMinorUnits' },
}, null, 2);

export const DEFAULT_HMAC_CONFIG = JSON.stringify({
  hmac: {
    timestampHeader: 'x-webhook-timestamp',
    nonceHeader: 'x-webhook-nonce',
    idempotencyKeyHeader: 'x-webhook-idempotency-key',
    payloadHashHeader: 'x-webhook-payload-sha256',
    signatureHeader: 'x-webhook-signature',
    canonical: ['method', 'path', 'timestamp', 'nonce', 'idempotencyKey', 'bodyHash'],
  },
}, null, 2);

export const defaultForm = (): WebhookFormState => ({
  name: '',
  url: '',
  eventTypes: DEFAULT_EVENTS,
  payloadProfile: WEBHOOK_PAYLOAD_PROFILE_GENERIC,
  authType: WEBHOOK_AUTH_TYPE_NONE,
  secret: '',
  maxAttempts: 5,
  failureNotificationEnabled: true,
  advancedOpen: false,
  filtersJson: '',
  headerConfigJson: '',
  bodyMappingJson: DEFAULT_BODY_MAPPING,
  valuationMode: WEBHOOK_VALUATION_MODE_DISABLED,
  valuationCurrency: 'USD',
  retryInitialDelayMs: 30000,
  retryMaxDelayMs: 1800000,
  retryBackoffMultiplier: 2,
});

export function buildWebhookInput(form: WebhookFormState): WalletWebhookInput {
  const filters = parseJsonObject('Filters JSON', form.filtersJson);
  const headerConfig = parseJsonObject('Headers and HMAC JSON', form.headerConfigJson);
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    eventTypes: parseEventTypes(form.eventTypes),
    payloadProfile: form.payloadProfile,
    authType: form.authType,
    maxAttempts: form.maxAttempts,
    failureNotificationEnabled: form.failureNotificationEnabled,
    retryConfig: {
      initialDelayMs: form.retryInitialDelayMs,
      maxDelayMs: form.retryMaxDelayMs,
      backoffMultiplier: form.retryBackoffMultiplier,
    },
    ...(form.authType !== 'none' ? { secret: form.secret.trim() } : {}),
    ...(filters ? { filters } : {}),
    ...(headerConfig ? { headerConfig } : {}),
    ...(form.payloadProfile === WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON ? { profileConfig: buildMappedJsonConfig(form) } : {}),
  };
}

function buildMappedJsonConfig(form: WebhookFormState): Record<string, unknown> {
  const body = parseJsonObject('Body mapping JSON', form.bodyMappingJson);
  if (!body) throw new Error('Body mapping JSON is required for mapped JSON webhooks');
  return {
    body,
    ...(form.valuationMode !== WEBHOOK_VALUATION_MODE_DISABLED
      ? {
          valuation: {
            mode: form.valuationMode,
            currency: form.valuationCurrency.trim() || 'USD',
            amountPath: 'transaction.amountSats',
            timePath: 'transaction.blockTime',
          },
        }
      : {}),
  };
}

export function parseEventTypes(value: string): string[] {
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

export function parseJsonObject(label: string, value: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function clampNumber(value: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function formatTimestamp(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export const inputClassName = 'w-full rounded-md border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 px-3 py-2 text-sm text-sanctuary-900 dark:text-sanctuary-100';
export const labelClassName = 'grid gap-1 text-xs font-medium text-sanctuary-600 dark:text-sanctuary-400';
