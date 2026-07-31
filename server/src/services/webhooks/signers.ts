import { createHmac, randomUUID } from 'node:crypto';
import type { WebhookEndpoint } from '../../generated/prisma/client';
import { decryptIfEncrypted } from '../../utils/encryption';
import { getHeaderConfig, type JsonRecord } from './config';
import { serializeWebhookBody } from './json';
import { redactWebhookDiagnosticHeaders } from './diagnostics';
import {
  WEBHOOK_AUTH_BEARER,
  WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_HMAC_SHA256,
  WEBHOOK_AUTH_NONE,
  type BuiltWebhookRequest,
  type SignedWebhookRequest,
  type WalletWebhookEvent,
} from './types';

export function signWebhookRequest(
  endpoint: WebhookEndpoint,
  event: WalletWebhookEvent,
  request: BuiltWebhookRequest,
): SignedWebhookRequest {
  const baseHeaders = {
    'content-type': 'application/json',
    'user-agent': 'Sanctuary-Webhooks/1.0',
  };
  const configuredHeaders = getConfiguredHeaders(endpoint);
  const headers = {
    ...baseHeaders,
    ...configuredHeaders,
  };

  switch (endpoint.authType) {
    case WEBHOOK_AUTH_NONE:
      return { headers, redactedHeaders: redactHeaders(headers) };
    case WEBHOOK_AUTH_BEARER:
      return signBearer(endpoint, headers);
    case WEBHOOK_AUTH_HMAC_SHA256:
      return signGenericHmac(endpoint, event, request, headers);
    case WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256:
      return signConfiguredHmac(endpoint, event, request, headers);
    default:
      return { headers, redactedHeaders: redactHeaders(headers) };
  }
}

function signBearer(
  endpoint: WebhookEndpoint,
  headers: Record<string, string>,
): SignedWebhookRequest {
  const secret = getEndpointSecret(endpoint);
  const signedHeaders = {
    ...headers,
    authorization: `Bearer ${secret}`,
  };
  return { headers: signedHeaders, redactedHeaders: redactHeaders(signedHeaders) };
}

function signGenericHmac(
  endpoint: WebhookEndpoint,
  event: WalletWebhookEvent,
  request: BuiltWebhookRequest,
  headers: Record<string, string>,
): SignedWebhookRequest {
  // Generic Sanctuary HMAC signs stable event metadata plus the exact JSON body
  // bytes sent on the wire. Receivers verify x-sanctuary-* headers.
  const secret = getEndpointSecret(endpoint);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = serializeWebhookBody(request.body);
  const signature = createHmac('sha256', secret)
    .update(`${event.eventId}.${timestamp}.${request.bodyHash}.${rawBody}`)
    .digest('hex');
  const signedHeaders = {
    ...headers,
    'x-sanctuary-event-id': event.eventId,
    'x-sanctuary-timestamp': timestamp,
    'x-sanctuary-payload-sha256': request.bodyHash,
    'x-sanctuary-signature': signature,
  };
  return { headers: signedHeaders, redactedHeaders: redactHeaders(signedHeaders) };
}

function signConfiguredHmac(
  endpoint: WebhookEndpoint,
  event: WalletWebhookEvent,
  request: BuiltWebhookRequest,
  headers: Record<string, string>,
): SignedWebhookRequest {
  // Configured HMAC lets an endpoint choose header names and canonical fields
  // while still signing values derived from this request body and event.
  const secret = getEndpointSecret(endpoint);
  const config = getConfiguredHmacConfig(endpoint);
  const timestamp = buildConfiguredTimestamp(config);
  const nonce = randomUUID();
  const idempotencyKey = resolveStringPath(event, getString(config.idempotencyKeyPath) ?? 'eventId') ?? event.eventId;
  const path = new URL(endpoint.url).pathname;
  const method = getString(config.method) ?? 'POST';
  const rawBody = serializeWebhookBody(request.body);
  const components: Record<string, string> = {
    body: rawBody,
    bodyHash: request.bodyHash,
    eventId: event.eventId,
    idempotencyKey,
    method,
    nonce,
    path,
    timestamp,
  };
  const canonical = getCanonicalComponents(config)
    .map(component => components[component] ?? '')
    .join(getString(config.canonicalSeparator) ?? '\n');
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  const signedHeaders = {
    ...headers,
    ...buildConfiguredHmacHeaders(config, {
      bodyHash: request.bodyHash,
      idempotencyKey,
      nonce,
      signature,
      timestamp,
    }),
  };
  return { headers: signedHeaders, redactedHeaders: redactHeaders(signedHeaders) };
}

function getConfiguredHmacConfig(endpoint: WebhookEndpoint): JsonRecord {
  const headerConfig = getHeaderConfig(endpoint);
  const hmacConfig = toJsonRecord(headerConfig.hmac);
  return Object.keys(hmacConfig).length > 0 ? hmacConfig : headerConfig;
}

function buildConfiguredTimestamp(config: JsonRecord): string {
  return config.timestampFormat === 'iso8601'
    ? new Date().toISOString()
    : Math.floor(Date.now() / 1000).toString();
}

function getCanonicalComponents(config: JsonRecord): string[] {
  if (Array.isArray(config.canonical)) {
    return config.canonical.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  return ['eventId', 'timestamp', 'bodyHash'];
}

function buildConfiguredHmacHeaders(
  config: JsonRecord,
  values: {
    bodyHash: string;
    idempotencyKey: string;
    nonce: string;
    signature: string;
    timestamp: string;
  },
): Record<string, string> {
  const headers: Record<string, string> = {};
  addNamedHeader(headers, config.timestampHeader, values.timestamp);
  addNamedHeader(headers, config.nonceHeader, values.nonce);
  addNamedHeader(headers, config.idempotencyKeyHeader, values.idempotencyKey);
  addNamedHeader(headers, config.payloadHashHeader, values.bodyHash);
  addNamedHeader(headers, getString(config.signatureHeader) ?? 'x-webhook-signature', values.signature);
  return headers;
}

function addNamedHeader(headers: Record<string, string>, name: unknown, value: string): void {
  const headerName = getString(name);
  if (headerName) headers[headerName] = value;
}

function getConfiguredHeaders(endpoint: WebhookEndpoint): Record<string, string> {
  const headerConfig = getHeaderConfig(endpoint);
  const headers = headerConfig.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};

  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
  );
}

function getEndpointSecret(endpoint: WebhookEndpoint): string {
  if (!endpoint.secretEncrypted) {
    throw new Error(`Webhook endpoint ${endpoint.id} requires a secret for ${endpoint.authType}`);
  }
  return decryptIfEncrypted(endpoint.secretEncrypted);
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  // Every configured value is credential material regardless of its header name.
  return redactWebhookDiagnosticHeaders(headers) as Record<string, string>;
}

function resolveStringPath(event: WalletWebhookEvent, path: string): string | undefined {
  let current: unknown = event;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toJsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}
