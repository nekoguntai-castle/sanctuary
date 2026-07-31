import type { WebhookDelivery, WebhookEndpoint } from '../../generated/prisma/client';
import { queueWebhookDeliveryNotification } from '../../infrastructure';
import { webhookRepository } from '../../repositories';
import { encrypt } from '../../utils/encryption';
import { ForbiddenError, InvalidInputError } from '../../errors';
import {
  isWalletRole,
  type WalletRoleValue,
} from '@sanctuary/shared/constants/walletRoles';
import { WEBHOOK_REDACTED_VALUE } from '@sanctuary/shared/constants/webhooks';
import { sendWebhookDelivery } from './deliveryService';
import { redactWebhookDiagnosticHeaders } from './diagnostics';

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
  headerConfig: Record<string, unknown> | null;
  configuredHeaderNames: string[];
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
  requestHeadersRedacted: Record<string, string> | null;
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
  headerConfig?: WebhookHeaderConfigInput;
  profileConfig?: unknown;
  retryConfig?: unknown;
  maxAttempts?: number;
  failureNotificationEnabled?: boolean;
}

interface WebhookHeaderConfigInput {
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface WebhookHeaderConfigUpdate {
  headers?: Record<string, string | null>;
  [key: string]: unknown;
}

export interface UpdateWebhookEndpointInput
  extends Omit<Partial<SaveWebhookEndpointInput>, 'headerConfig'> {
  headerConfig?: WebhookHeaderConfigUpdate;
}

export async function listWalletWebhooks(
  walletId: string,
  walletRole: unknown,
): Promise<WebhookEndpointResponse[]> {
  requireProjectionRole(walletRole);
  const endpoints = await webhookRepository.listEndpoints(walletId);
  return endpoints.map(endpoint => toWebhookEndpointResponse(endpoint, walletRole));
}

export async function getWalletWebhook(
  walletId: string,
  endpointId: string,
  walletRole: unknown,
): Promise<WebhookEndpointResponse | null> {
  requireProjectionRole(walletRole);
  const endpoint = await webhookRepository.findEndpointForWallet(walletId, endpointId);
  return endpoint ? toWebhookEndpointResponse(endpoint, walletRole) : null;
}

export async function createWalletWebhook(
  walletId: string,
  userId: string,
  input: SaveWebhookEndpointInput,
  walletRole: unknown,
): Promise<WebhookEndpointResponse> {
  requireProjectionRole(walletRole);
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
    headerConfig: prepareHeaderConfig(input.headerConfig, false) as never,
    profileConfig: input.profileConfig as never,
    retryConfig: input.retryConfig as never,
    maxAttempts: input.maxAttempts,
    failureNotificationEnabled: input.failureNotificationEnabled,
    createdByUserId: userId,
  });
  return toWebhookEndpointResponse(endpoint, walletRole);
}

export async function updateWalletWebhook(
  walletId: string,
  endpointId: string,
  input: UpdateWebhookEndpointInput,
  walletRole: unknown,
): Promise<WebhookEndpointResponse | null> {
  requireProjectionRole(walletRole);
  if (input.headerConfig !== undefined) prepareHeaderConfig(input.headerConfig, true);
  const secretUpdate = getSecretUpdate(input);
  const update = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
    ...(input.filters !== undefined ? { filters: input.filters as never } : {}),
    ...(input.payloadProfile !== undefined ? { payloadProfile: input.payloadProfile } : {}),
    ...(input.authType !== undefined ? { authType: input.authType } : {}),
    ...secretUpdate,
    ...(input.profileConfig !== undefined ? { profileConfig: input.profileConfig as never } : {}),
    ...(input.retryConfig !== undefined ? { retryConfig: input.retryConfig as never } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.failureNotificationEnabled !== undefined
      ? { failureNotificationEnabled: input.failureNotificationEnabled }
      : {}),
  };
  const endpoint = await webhookRepository.updateEndpoint(walletId, endpointId, existing => ({
    ...update,
    ...(input.headerConfig === undefined
      ? {}
      : { headerConfig: mergeHeaderConfig(existing.headerConfig, input.headerConfig) as never }),
  }));
  return endpoint ? toWebhookEndpointResponse(endpoint, walletRole) : null;
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
  walletRole: unknown,
): Promise<WebhookDeliveryResponse[]> {
  requireProjectionRole(walletRole);
  const deliveries = await webhookRepository.listDeliveries(walletId, endpointId, limit);
  return deliveries.map(delivery => toWebhookDeliveryResponse(delivery, walletRole));
}

export async function replayWalletWebhookDelivery(
  walletId: string,
  endpointId: string,
  deliveryId: string,
  walletRole: unknown,
): Promise<WebhookReplayResponse | null> {
  requireProjectionRole(walletRole);
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
    delivery: toWebhookDeliveryResponse(latestDelivery ?? replayDelivery, walletRole),
  };
}

export function toWebhookEndpointResponse(
  endpoint: WebhookEndpoint,
  walletRole: unknown,
): WebhookEndpointResponse {
  requireProjectionRole(walletRole);
  const { headerConfig, configuredHeaderNames } = projectHeaderConfig(endpoint.headerConfig);
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
    headerConfig,
    configuredHeaderNames,
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

export function toWebhookDeliveryResponse(
  delivery: WebhookDelivery,
  walletRole: unknown,
): WebhookDeliveryResponse {
  requireProjectionRole(walletRole);
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
    requestHeadersRedacted: redactWebhookDiagnosticHeaders(delivery.requestHeadersRedacted),
    responseBodyHash: delivery.responseBodyHash,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

function requireProjectionRole(walletRole: unknown): asserts walletRole is WalletRoleValue {
  if (!isWalletRole(walletRole)) {
    throw new ForbiddenError('Wallet access is required');
  }
}

function projectHeaderConfig(value: unknown): {
  headerConfig: Record<string, unknown> | null;
  configuredHeaderNames: string[];
} {
  if (!isPlainRecord(value)) {
    return { headerConfig: null, configuredHeaderNames: [] };
  }
  const { headers, ...headerConfig } = value;
  const configuredHeaderNames = isPlainRecord(headers)
    ? Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right))
    : [];
  return { headerConfig, configuredHeaderNames };
}

function prepareHeaderConfig(
  value: WebhookHeaderConfigInput | WebhookHeaderConfigUpdate | undefined,
  allowNullHeaders: boolean,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) throw new InvalidInputError('Webhook header config must be an object');
  const result = { ...value };
  if (value.headers !== undefined) {
    result.headers = validateHeaderPatch(value.headers, allowNullHeaders);
  }
  return result;
}

function mergeHeaderConfig(
  currentValue: unknown,
  update: WebhookHeaderConfigUpdate,
): Record<string, unknown> {
  // Omitted maps retain hidden values; individual strings replace and nulls
  // delete without requiring the response contract to disclose current values.
  const current = isPlainRecord(currentValue) ? currentValue : {};
  const patch = prepareHeaderConfig(update, true)!;
  const { headers: currentHeaders, ...currentConfig } = current;
  const { headers: headerPatch, ...configPatch } = patch;
  if (headerPatch === undefined) {
    return {
      ...currentConfig,
      ...configPatch,
      ...(currentHeaders === undefined ? {} : { headers: currentHeaders }),
    };
  }
  return {
    ...currentConfig,
    ...configPatch,
    headers: applyHeaderPatch(currentHeaders, headerPatch as Record<string, string | null>),
  };
}

function validateHeaderPatch(
  value: unknown,
  allowNull: boolean,
): Record<string, string | null> {
  if (!isPlainRecord(value)) throw new InvalidInputError('Webhook headers must be an object');
  const result: Record<string, string | null> = {};
  const foldedNames = new Set<string>();
  for (const [name, headerValue] of Object.entries(value)) {
    const foldedName = name.toLocaleLowerCase('en-US');
    if (!name.trim()) throw new InvalidInputError('Webhook header names cannot be empty');
    if (foldedNames.has(foldedName)) {
      throw new InvalidInputError('Webhook header names must be unique ignoring case');
    }
    foldedNames.add(foldedName);
    if (headerValue === WEBHOOK_REDACTED_VALUE) {
      throw new InvalidInputError('Redacted webhook values cannot be stored as credentials');
    }
    if (typeof headerValue === 'string' || (allowNull && headerValue === null)) {
      result[name] = headerValue;
      continue;
    }
    throw new InvalidInputError('Webhook header values must be strings');
  }
  return result;
}

function applyHeaderPatch(
  currentValue: unknown,
  patch: Record<string, string | null>,
): Record<string, string> {
  const result = isPlainRecord(currentValue)
    ? Object.fromEntries(
      Object.entries(currentValue).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'),
    )
    : {};
  for (const [name, value] of Object.entries(patch)) {
    const foldedName = name.toLocaleLowerCase('en-US');
    // Header identity is case-insensitive, so replace/delete every stored
    // spelling before applying the caller's canonical spelling.
    for (const existingName of Object.keys(result)) {
      if (existingName.toLocaleLowerCase('en-US') === foldedName) delete result[existingName];
    }
    if (value !== null) result[name] = value;
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
