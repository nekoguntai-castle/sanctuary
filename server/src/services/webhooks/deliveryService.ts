import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { queueWebhookDeliveryNotification } from '../../infrastructure';
import { webhookRepository } from '../../repositories';
import type { Prisma, WebhookEndpoint } from '../../generated/prisma/client';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { walletLog } from '../../websocket/notifications';
import { getRetryConfig } from './config';
import { validateWebhookEndpointUrl, type EndpointPolicyResult } from './endpointPolicy';
import { hashWebhookRawBody, serializeWebhookBody } from './json';
import { buildWebhookRequest } from './payloadProfiles';
import { signWebhookRequest } from './signers';
import { matchesEndpointEventType, matchesEndpointFilters } from './subscriptions';
import {
  WebhookRetryableError,
  type BuiltWebhookRequest,
  type SignedWebhookRequest,
  type WalletWebhookEvent,
  type WebhookDeliveryWithEndpoint,
  type WebhookSendResult,
} from './types';

const log = createLogger('WEBHOOK:SVC_DELIVERY');
const RESPONSE_CAPTURE_LIMIT = 4096;
const REQUEST_TIMEOUT_MS = 10_000;

export interface QueueWebhookEventResult {
  queued: number;
  errors: string[];
}

interface PreparedWebhookRequest {
  request: BuiltWebhookRequest;
  signed: SignedWebhookRequest;
  serializedBody: string;
}

interface WebhookHttpResponse {
  ok: boolean;
  status: number;
  bodyText: string;
}

export async function queueWebhookEventDeliveries(
  event: WalletWebhookEvent,
): Promise<QueueWebhookEventResult> {
  return queueWebhookEventsDeliveries([event]);
}

export async function queueWebhookEventsDeliveries(
  events: WalletWebhookEvent[],
): Promise<QueueWebhookEventResult> {
  const errors: string[] = [];
  const endpointsByWallet = new Map<string, WebhookEndpoint[]>();
  let queued = 0;

  for (const event of events) {
    const endpoints = await getEnabledWalletEndpoints(event.wallet.id, endpointsByWallet);
    for (const endpoint of endpoints) {
      if (!matchesEndpointEventType(endpoint, event.eventType) || !matchesEndpointFilters(endpoint, event)) {
        continue;
      }

      try {
        const delivery = await webhookRepository.createDelivery({
          endpointId: endpoint.id,
          walletId: event.wallet.id,
          eventId: event.eventId,
          eventType: event.eventType,
          payloadProfile: endpoint.payloadProfile,
          targetUrl: endpoint.url,
          eventPayload: event as unknown as Prisma.InputJsonValue,
        });
        queued += 1;

        const queuedInWorker = await queueWebhookDeliveryNotification({
          deliveryId: delivery.id,
          attempt: delivery.attemptCount + 1,
        });
        if (!queuedInWorker) {
          await sendWebhookDelivery(delivery.id);
        }
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }
  }

  return { queued, errors };
}

export async function sendWebhookDelivery(deliveryId: string): Promise<WebhookSendResult> {
  const delivery = await webhookRepository.findDeliveryById(deliveryId);
  if (!delivery) {
    return { success: false, error: 'Webhook delivery not found' };
  }
  if (delivery.status === 'delivered' || delivery.status === 'dead') {
    return { success: true };
  }

  const attemptCount = delivery.attemptCount + 1;
  let preparedRequest: PreparedWebhookRequest | null = null;
  try {
    const policy = await validateWebhookEndpointUrl(delivery.endpoint.url);
    preparedRequest = await prepareWebhookRequest(delivery);
    const result = await attemptWebhookDelivery(policy, preparedRequest);
    if (result.success && result.statusCode) {
      await webhookRepository.markDeliveryDelivered(delivery.id, {
        attemptCount,
        statusCode: result.statusCode,
        requestBody: preparedRequest.request.body as Prisma.InputJsonValue,
        requestBodyHash: preparedRequest.request.bodyHash,
        requestHeadersRedacted: preparedRequest.signed.redactedHeaders,
        responseBodyHash: result.responseBodyHash,
      });
    }
    return result;
  } catch (error) {
    return handleWebhookDeliveryFailure(delivery, attemptCount, error, preparedRequest);
  }
}

async function attemptWebhookDelivery(
  policy: EndpointPolicyResult,
  preparedRequest: PreparedWebhookRequest,
): Promise<WebhookSendResult> {
  const response = await postWebhookRequest(policy, preparedRequest.signed.headers, preparedRequest.serializedBody);
  const responseBodyHash = response.bodyText
    ? hashWebhookRawBody(response.bodyText.slice(0, RESPONSE_CAPTURE_LIMIT))
    : undefined;

  if (response.ok) {
    return {
      success: true,
      statusCode: response.status,
      responseBodyHash,
    };
  }

  const error = `Webhook endpoint returned HTTP ${response.status}`;
  if (shouldRetryStatus(response.status)) {
    throw new WebhookRetryableError(error);
  }
  throw new Error(error);
}

async function handleWebhookDeliveryFailure(
  delivery: WebhookDeliveryWithEndpoint,
  attemptCount: number,
  error: unknown,
  preparedRequest: PreparedWebhookRequest | null,
): Promise<WebhookSendResult> {
  const errorMessage = getErrorMessage(error);
  const retryable = isRetryableWebhookError(error);
  const maxAttempts = Math.max(1, delivery.endpoint.maxAttempts);
  const requestDiagnostics = preparedRequest
    ? {
        requestBody: preparedRequest.request.body as Prisma.InputJsonValue,
        requestBodyHash: preparedRequest.request.bodyHash,
        requestHeadersRedacted: preparedRequest.signed.redactedHeaders,
      }
    : {};
  if (!retryable || attemptCount >= maxAttempts) {
    const deadDelivery = await webhookRepository.markDeliveryDead({
      deliveryId: delivery.id,
      error: errorMessage,
      attemptCount,
      ...requestDiagnostics,
    });
    notifyWebhookDeliveryDead(deadDelivery);
    return { success: false, error: errorMessage };
  }

  const delayMs = calculateRetryDelay(delivery.endpoint, attemptCount);
  const nextAttemptAt = new Date(Date.now() + delayMs);
  await webhookRepository.markDeliveryFailed({
    deliveryId: delivery.id,
    error: errorMessage,
    nextAttemptAt,
    attemptCount,
    ...requestDiagnostics,
  });
  await queueWebhookDeliveryNotification(
    { deliveryId: delivery.id, attempt: attemptCount + 1 },
    { delayMs },
  );
  return { success: false, error: errorMessage };
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableWebhookError(error: unknown): boolean {
  if (error instanceof WebhookRetryableError) return true;
  const code = getNodeErrorCode(error);
  if (['econnrefused', 'econnreset', 'etimedout', 'enotfound', 'eai_again'].includes(code)) {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('network');
}

function calculateRetryDelay(
  endpoint: WebhookDeliveryWithEndpoint['endpoint'],
  attemptCount: number,
): number {
  const retryConfig = getRetryConfig(endpoint);
  return Math.min(
    retryConfig.initialDelayMs * Math.pow(retryConfig.backoffMultiplier, Math.max(0, attemptCount - 1)),
    retryConfig.maxDelayMs,
  );
}

function notifyWebhookDeliveryDead(delivery: WebhookDeliveryWithEndpoint): void {
  if (!delivery.endpoint.failureNotificationEnabled) return;
  walletLog(
    delivery.walletId,
    'error',
    'WEBHOOK',
    `Webhook "${delivery.endpoint.name}" failed after ${delivery.attemptCount} attempts`,
    {
      endpointId: delivery.endpointId,
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      error: delivery.lastError,
    },
  );
  log.error('Webhook delivery exhausted retries', {
    walletId: delivery.walletId,
    endpointId: delivery.endpointId,
    deliveryId: delivery.id,
    eventId: delivery.eventId,
    error: delivery.lastError,
  });
}

async function getEnabledWalletEndpoints(
  walletId: string,
  cache: Map<string, WebhookEndpoint[]>,
): Promise<WebhookEndpoint[]> {
  const cached = cache.get(walletId);
  if (cached) return cached;

  const endpoints = (await webhookRepository.listEndpoints(walletId))
    .filter(endpoint => endpoint.enabled);
  cache.set(walletId, endpoints);
  return endpoints;
}

async function prepareWebhookRequest(delivery: WebhookDeliveryWithEndpoint): Promise<PreparedWebhookRequest> {
  const event = delivery.eventPayload as unknown as WalletWebhookEvent;
  const request = await buildWebhookRequest(delivery.endpoint, event);
  const signed = signWebhookRequest(delivery.endpoint, event, request);
  return {
    request,
    signed,
    serializedBody: serializeWebhookBody(request.body),
  };
}

async function postWebhookRequest(
  policy: EndpointPolicyResult,
  headers: Record<string, string>,
  body: string,
): Promise<WebhookHttpResponse> {
  if (net.isIP(policy.url.hostname)) {
    return postWebhookRequestWithFetch(policy.url, headers, body);
  }
  return postWebhookRequestPinnedToResolvedAddress(policy, headers, body);
}

async function postWebhookRequestWithFetch(
  url: URL,
  headers: Record<string, string>,
  body: string,
): Promise<WebhookHttpResponse> {
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bodyText = await response.text().catch(() => '');
  return { ok: response.ok, status: response.status, bodyText };
}

// DNS hosts are sent to the address that passed endpoint policy validation so a
// second resolver pass cannot swap the target to a private network.
function postWebhookRequestPinnedToResolvedAddress(
  policy: EndpointPolicyResult,
  headers: Record<string, string>,
  body: string,
): Promise<WebhookHttpResponse> {
  const resolvedAddress = policy.resolvedAddresses[0];
  if (!resolvedAddress) {
    throw new WebhookRetryableError('Webhook URL did not resolve to an address');
  }

  return new Promise((resolve, reject) => {
    const isHttps = policy.url.protocol === 'https:';
    const client = isHttps ? https : http;
    const request = client.request({
      protocol: policy.url.protocol,
      hostname: resolvedAddress,
      port: policy.url.port || (isHttps ? 443 : 80),
      method: 'POST',
      path: `${policy.url.pathname}${policy.url.search}`,
      headers: {
        ...headers,
        host: policy.url.host,
      },
      ...(isHttps ? { servername: policy.url.hostname } : {}),
    }, response => {
      response.setEncoding('utf8');
      let bodyText = '';
      response.on('data', (chunk: string) => {
        if (bodyText.length < RESPONSE_CAPTURE_LIMIT) {
          bodyText += chunk.slice(0, RESPONSE_CAPTURE_LIMIT - bodyText.length);
        }
      });
      response.on('end', () => {
        clearTimeout(deadline);
        const status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, bodyText });
      });
      response.on('error', error => {
        clearTimeout(deadline);
        reject(error);
      });
    });
    const deadline = setTimeout(() => {
      request.destroy(new WebhookRetryableError('Webhook request timeout'));
    }, REQUEST_TIMEOUT_MS);

    request.on('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end(body);
  });
}

function getNodeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toLowerCase() : '';
}
