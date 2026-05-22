import type { WebhookDelivery, WebhookEndpoint } from '../../generated/prisma/client';
import { queueWebhookDeliveryNotification } from '../../infrastructure';
import { webhookRepository } from '../../repositories';
import { encrypt } from '../../utils/encryption';
import { sendWebhookDelivery } from './deliveryService';

export interface WebhookEndpointResponse {
  id: string;
  walletId: string;
  name: string;
  enabled: boolean;
  url: string;
  eventTypes: string[];
  filters: unknown;
  payloadProfile: string;
  authType: string;
  hasSecret: boolean;
  headerConfig: unknown;
  profileConfig: unknown;
  retryConfig: unknown;
  maxAttempts: number;
  failureNotificationEnabled: boolean;
  createdByUserId: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryResponse {
  id: string;
  endpointId: string;
  walletId: string;
  eventId: string;
  eventType: string;
  payloadProfile: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  requestBodyHash: string | null;
  requestHeadersRedacted: unknown;
  responseBodyHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookReplayResponse {
  success: boolean;
  queued: boolean;
  message: string;
  delivery: WebhookDeliveryResponse;
}

export interface SaveWebhookEndpointInput {
  name: string;
  enabled?: boolean;
  url: string;
  eventTypes: string[];
  filters?: unknown;
  payloadProfile?: string;
  authType?: string;
  secret?: string;
  headerConfig?: unknown;
  profileConfig?: unknown;
  retryConfig?: unknown;
  maxAttempts?: number;
  failureNotificationEnabled?: boolean;
}

export interface UpdateWebhookEndpointInput extends Partial<SaveWebhookEndpointInput> {}

export async function listWalletWebhooks(walletId: string): Promise<WebhookEndpointResponse[]> {
  const endpoints = await webhookRepository.listEndpoints(walletId);
  return endpoints.map(toWebhookEndpointResponse);
}

export async function getWalletWebhook(
  walletId: string,
  endpointId: string,
): Promise<WebhookEndpointResponse | null> {
  const endpoint = await webhookRepository.findEndpointForWallet(walletId, endpointId);
  return endpoint ? toWebhookEndpointResponse(endpoint) : null;
}

export async function createWalletWebhook(
  walletId: string,
  userId: string,
  input: SaveWebhookEndpointInput,
): Promise<WebhookEndpointResponse> {
  const endpoint = await webhookRepository.createEndpoint({
    walletId,
    name: input.name,
    enabled: input.enabled,
    url: input.url,
    eventTypes: input.eventTypes,
    filters: input.filters as never,
    payloadProfile: input.payloadProfile,
    authType: input.authType,
    secretEncrypted: input.secret ? encrypt(input.secret) : null,
    headerConfig: input.headerConfig as never,
    profileConfig: input.profileConfig as never,
    retryConfig: input.retryConfig as never,
    maxAttempts: input.maxAttempts,
    failureNotificationEnabled: input.failureNotificationEnabled,
    createdByUserId: userId,
  });
  return toWebhookEndpointResponse(endpoint);
}

export async function updateWalletWebhook(
  walletId: string,
  endpointId: string,
  input: UpdateWebhookEndpointInput,
): Promise<WebhookEndpointResponse | null> {
  const secretUpdate = getSecretUpdate(input);
  const endpoint = await webhookRepository.updateEndpoint(walletId, endpointId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
    ...(input.filters !== undefined ? { filters: input.filters as never } : {}),
    ...(input.payloadProfile !== undefined ? { payloadProfile: input.payloadProfile } : {}),
    ...(input.authType !== undefined ? { authType: input.authType } : {}),
    ...secretUpdate,
    ...(input.headerConfig !== undefined ? { headerConfig: input.headerConfig as never } : {}),
    ...(input.profileConfig !== undefined ? { profileConfig: input.profileConfig as never } : {}),
    ...(input.retryConfig !== undefined ? { retryConfig: input.retryConfig as never } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.failureNotificationEnabled !== undefined
      ? { failureNotificationEnabled: input.failureNotificationEnabled }
      : {}),
  });
  return endpoint ? toWebhookEndpointResponse(endpoint) : null;
}

function getSecretUpdate(input: UpdateWebhookEndpointInput): { secretEncrypted?: string | null } {
  if (input.secret !== undefined) return { secretEncrypted: encrypt(input.secret) };
  if (input.authType === 'none') return { secretEncrypted: null };
  return {};
}

export async function deleteWalletWebhook(walletId: string, endpointId: string): Promise<boolean> {
  return webhookRepository.deleteEndpoint(walletId, endpointId);
}

export async function listWalletWebhookDeliveries(
  walletId: string,
  endpointId: string,
  limit: number,
): Promise<WebhookDeliveryResponse[]> {
  const deliveries = await webhookRepository.listDeliveries(walletId, endpointId, limit);
  return deliveries.map(toWebhookDeliveryResponse);
}

export async function replayWalletWebhookDelivery(
  walletId: string,
  endpointId: string,
  deliveryId: string,
): Promise<WebhookReplayResponse | null> {
  const delivery = await webhookRepository.findDeliveryById(deliveryId);
  if (!delivery || delivery.walletId !== walletId || delivery.endpointId !== endpointId) {
    return null;
  }

  const replayDelivery = await webhookRepository.markDeliveryPendingForReplay(delivery.id);
  const queued = await queueWebhookDeliveryNotification({
    deliveryId: delivery.id,
    attempt: replayDelivery.attemptCount + 1,
  });

  if (!queued) {
    await sendWebhookDelivery(delivery.id);
  }

  const latestDelivery = await webhookRepository.findDeliveryById(delivery.id);
  return {
    success: true,
    queued,
    message: queued ? 'Webhook delivery replay queued' : 'Webhook delivery replay sent inline',
    delivery: toWebhookDeliveryResponse(latestDelivery ?? replayDelivery),
  };
}

export function toWebhookEndpointResponse(endpoint: WebhookEndpoint): WebhookEndpointResponse {
  return {
    id: endpoint.id,
    walletId: endpoint.walletId,
    name: endpoint.name,
    enabled: endpoint.enabled,
    url: endpoint.url,
    eventTypes: endpoint.eventTypes,
    filters: endpoint.filters,
    payloadProfile: endpoint.payloadProfile,
    authType: endpoint.authType,
    hasSecret: Boolean(endpoint.secretEncrypted),
    headerConfig: endpoint.headerConfig,
    profileConfig: endpoint.profileConfig,
    retryConfig: endpoint.retryConfig,
    maxAttempts: endpoint.maxAttempts,
    failureNotificationEnabled: endpoint.failureNotificationEnabled,
    createdByUserId: endpoint.createdByUserId,
    lastDeliveryStatus: endpoint.lastDeliveryStatus,
    lastDeliveredAt: endpoint.lastDeliveredAt?.toISOString() ?? null,
    lastError: endpoint.lastError,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export function toWebhookDeliveryResponse(delivery: WebhookDelivery): WebhookDeliveryResponse {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    walletId: delivery.walletId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    payloadProfile: delivery.payloadProfile,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    requestBodyHash: delivery.requestBodyHash,
    requestHeadersRedacted: delivery.requestHeadersRedacted,
    responseBodyHash: delivery.responseBodyHash,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}
