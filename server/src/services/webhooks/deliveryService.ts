import { randomUUID } from 'node:crypto';
import { queueWebhookDeliveryNotification } from '../../infrastructure';
import { webhookRepository } from '../../repositories';
import type { Prisma, WebhookEndpoint } from '../../generated/prisma/client';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { walletLog } from '../../websocket/notifications';
import { getRetryConfig } from './config';
import { requestPinnedAddress } from '../outboundNetwork/nativeRequest';
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
const ATTEMPT_LEASE_MS = 2 * 60_000;
const DEFAULT_RECOVERY_BATCH_SIZE = 100;
const MAX_RECOVERY_BATCH_SIZE = 500;

export interface QueueWebhookEventResult {
  queued: number;
  errors: string[];
}

export interface RecoverDueWebhookDeliveriesResult {
  selected: number;
  queued: number;
  failed: number;
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
          await sendWebhookDelivery(delivery.id, delivery.attemptCount + 1);
        }
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }
  }

  return { queued, errors };
}

export async function sendWebhookDelivery(
  deliveryId: string,
  expectedAttempt?: number,
): Promise<WebhookSendResult> {
  const existing = await webhookRepository.findDeliveryById(deliveryId);
  if (!existing) {
    return { success: false, error: 'Webhook delivery not found' };
  }
  if (existing.status === 'delivered' || existing.status === 'dead') {
    return { success: true };
  }

  const attemptCount = expectedAttempt ?? existing.attemptCount + 1;
  const leaseToken = randomUUID();
  const now = new Date();
  const delivery = await webhookRepository.claimDeliveryAttempt({
    deliveryId,
    expectedAttempt: attemptCount,
    leaseToken,
    now,
    leaseExpiresAt: new Date(now.getTime() + ATTEMPT_LEASE_MS),
  });
  if (!delivery) return { success: true };

  let preparedRequest: PreparedWebhookRequest | null = null;
  try {
    const policy = await validateWebhookEndpointUrl(delivery.endpoint.url);
    preparedRequest = await prepareWebhookRequest(delivery);
    const result = await attemptWebhookDelivery(policy, preparedRequest);
    if (result.success && result.statusCode) {
      await webhookRepository.markDeliveryDelivered(delivery.id, {
        expectedAttempt: attemptCount,
        leaseToken,
        statusCode: result.statusCode,
        requestBody: preparedRequest.request.body as Prisma.InputJsonValue,
        requestBodyHash: preparedRequest.request.bodyHash,
        requestHeadersRedacted: preparedRequest.signed.redactedHeaders,
        responseBodyHash: result.responseBodyHash,
      });
    }
    return result;
  } catch (error) {
    return handleWebhookDeliveryFailure(
      delivery,
      attemptCount,
      leaseToken,
      error,
      preparedRequest,
    );
  }
}

export async function recoverDueWebhookDeliveries(
  batchSize = DEFAULT_RECOVERY_BATCH_SIZE,
): Promise<RecoverDueWebhookDeliveriesResult> {
  const boundedBatchSize = normalizeRecoveryBatchSize(batchSize);
  const deliveries = await webhookRepository.listDueDeliveries(new Date(), boundedBatchSize);
  let queued = 0;

  for (const delivery of deliveries) {
    const accepted = await queueWebhookDeliveryNotification({
      deliveryId: delivery.id,
      attempt: delivery.attemptCount + 1,
    });
    if (accepted) queued += 1;
  }

  return {
    selected: deliveries.length,
    queued,
    failed: deliveries.length - queued,
  };
}

function normalizeRecoveryBatchSize(batchSize: number): number {
  if (!Number.isFinite(batchSize)) return DEFAULT_RECOVERY_BATCH_SIZE;
  return Math.min(
    MAX_RECOVERY_BATCH_SIZE,
    Math.max(1, Math.floor(batchSize)),
  );
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
  leaseToken: string,
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
      expectedAttempt: attemptCount,
      leaseToken,
      error: errorMessage,
      ...requestDiagnostics,
    });
    if (deadDelivery) notifyWebhookDeliveryDead(deadDelivery);
    return { success: false, error: errorMessage };
  }

  const delayMs = calculateRetryDelay(delivery.endpoint, attemptCount);
  const nextAttemptAt = new Date(Date.now() + delayMs);
  const failedDelivery = await webhookRepository.markDeliveryFailed({
    deliveryId: delivery.id,
    expectedAttempt: attemptCount,
    leaseToken,
    error: errorMessage,
    nextAttemptAt,
    ...requestDiagnostics,
  });
  if (!failedDelivery) return { success: false, error: errorMessage };

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
    message.includes('did not resolve') ||
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
  const resolvedAddress = policy.resolvedAddresses[0]!;
  const response = await requestPinnedAddress({
    url: policy.url,
    resolvedAddress,
    method: 'POST',
    headers,
    body,
    responseCaptureByteLimit: RESPONSE_CAPTURE_LIMIT,
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'Webhook request timeout',
  });
  return {
    ok: response.ok,
    status: response.status,
    bodyText: response.body.toString('utf8'),
  };
}

function getNodeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toLowerCase() : '';
}
