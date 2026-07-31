import prisma from '../models/prisma';
import { Prisma, type WebhookDelivery, type WebhookEndpoint } from '../generated/prisma/client';
import {
  WEBHOOK_AUTH_TYPE_NONE,
  WEBHOOK_PAYLOAD_PROFILE_GENERIC,
} from '@sanctuary/shared/constants/webhooks';

export interface CreateWebhookEndpointInput {
  walletId: string;
  name: string;
  enabled?: boolean;
  url: string;
  eventTypes: string[];
  filters?: Prisma.InputJsonValue | null;
  payloadProfile?: string;
  authType?: string;
  secretEncrypted?: string | null;
  headerConfig?: Prisma.InputJsonValue | null;
  profileConfig?: Prisma.InputJsonValue | null;
  retryConfig?: Prisma.InputJsonValue | null;
  maxAttempts?: number;
  failureNotificationEnabled?: boolean;
  createdByUserId?: string | null;
}

export type UpdateWebhookEndpointInput = Partial<Omit<
  CreateWebhookEndpointInput,
  'walletId' | 'createdByUserId'
>>;

export interface CreateWebhookDeliveryInput {
  endpointId: string;
  walletId: string;
  eventId: string;
  eventType: string;
  payloadProfile: string;
  targetUrl: string;
  eventPayload: Prisma.InputJsonValue;
  requestBody?: Prisma.InputJsonValue | null;
  requestBodyHash?: string | null;
}

export interface MarkDeliveryFailedInput {
  deliveryId: string;
  expectedAttempt: number;
  leaseToken: string;
  statusCode?: number | null;
  error: string;
  nextAttemptAt: Date;
  requestBody?: Prisma.InputJsonValue | null;
  requestBodyHash?: string | null;
  requestHeadersRedacted?: Prisma.InputJsonValue | null;
  responseBodyHash?: string | null;
}

export interface MarkDeliveryDeadInput {
  deliveryId: string;
  expectedAttempt: number;
  leaseToken: string;
  statusCode?: number | null;
  error: string;
  requestBody?: Prisma.InputJsonValue | null;
  requestBodyHash?: string | null;
  requestHeadersRedacted?: Prisma.InputJsonValue | null;
  responseBodyHash?: string | null;
}

export interface ClaimDeliveryAttemptInput {
  deliveryId: string;
  expectedAttempt: number;
  leaseToken: string;
  now: Date;
  leaseExpiresAt: Date;
}

export async function listEndpoints(walletId: string): Promise<WebhookEndpoint[]> {
  return prisma.webhookEndpoint.findMany({
    where: { walletId },
    orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function findEndpointForWallet(
  walletId: string,
  endpointId: string,
): Promise<WebhookEndpoint | null> {
  return prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, walletId },
  });
}

export async function findEndpointById(endpointId: string): Promise<WebhookEndpoint | null> {
  return prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
}

export async function findEnabledEndpointsForEvent(
  walletId: string,
  eventType: string,
): Promise<WebhookEndpoint[]> {
  return prisma.webhookEndpoint.findMany({
    where: {
      walletId,
      enabled: true,
      OR: [
        { eventTypes: { has: eventType } },
        { eventTypes: { has: '*' } },
        { eventTypes: { has: wildcardEventType(eventType) } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createEndpoint(
  input: CreateWebhookEndpointInput,
): Promise<WebhookEndpoint> {
  return prisma.webhookEndpoint.create({
    data: {
      walletId: input.walletId,
      name: input.name,
      enabled: input.enabled ?? true,
      url: input.url,
      eventTypes: input.eventTypes,
      filters: jsonValueOrUndefined(input.filters),
      payloadProfile: input.payloadProfile ?? WEBHOOK_PAYLOAD_PROFILE_GENERIC,
      authType: input.authType ?? WEBHOOK_AUTH_TYPE_NONE,
      secretEncrypted: input.secretEncrypted ?? null,
      headerConfig: jsonValueOrUndefined(input.headerConfig),
      profileConfig: jsonValueOrUndefined(input.profileConfig),
      retryConfig: jsonValueOrUndefined(input.retryConfig),
      maxAttempts: input.maxAttempts ?? 5,
      failureNotificationEnabled: input.failureNotificationEnabled ?? true,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function updateEndpoint(
  walletId: string,
  endpointId: string,
  input: UpdateWebhookEndpointInput,
): Promise<WebhookEndpoint | null> {
  const existing = await findEndpointForWallet(walletId, endpointId);
  if (!existing) return null;

  return prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
      ...(input.filters !== undefined ? { filters: jsonValueOrNull(input.filters) } : {}),
      ...(input.payloadProfile !== undefined ? { payloadProfile: input.payloadProfile } : {}),
      ...(input.authType !== undefined ? { authType: input.authType } : {}),
      ...(input.secretEncrypted !== undefined ? { secretEncrypted: input.secretEncrypted } : {}),
      ...(input.headerConfig !== undefined ? { headerConfig: jsonValueOrNull(input.headerConfig) } : {}),
      ...(input.profileConfig !== undefined ? { profileConfig: jsonValueOrNull(input.profileConfig) } : {}),
      ...(input.retryConfig !== undefined ? { retryConfig: jsonValueOrNull(input.retryConfig) } : {}),
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.failureNotificationEnabled !== undefined
        ? { failureNotificationEnabled: input.failureNotificationEnabled }
        : {}),
    },
  });
}

export async function deleteEndpoint(walletId: string, endpointId: string): Promise<boolean> {
  const result = await prisma.webhookEndpoint.deleteMany({
    where: { id: endpointId, walletId },
  });
  return result.count > 0;
}

export async function listDeliveries(
  walletId: string,
  endpointId: string,
  limit = 50,
): Promise<WebhookDelivery[]> {
  return prisma.webhookDelivery.findMany({
    where: { walletId, endpointId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function listSupportPackageEndpoints() {
  return prisma.webhookEndpoint.findMany({
    select: {
      id: true,
      walletId: true,
      enabled: true,
      url: true,
      eventTypes: true,
      payloadProfile: true,
      authType: true,
      secretEncrypted: true,
      headerConfig: true,
      profileConfig: true,
      retryConfig: true,
      maxAttempts: true,
      failureNotificationEnabled: true,
      lastDeliveryStatus: true,
      lastDeliveredAt: true,
      deliveries: {
        select: {
          status: true,
          attemptCount: true,
          lastStatusCode: true,
          lastError: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createDelivery(
  input: CreateWebhookDeliveryInput,
): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.upsert({
    where: {
      endpointId_eventId_payloadProfile: {
        endpointId: input.endpointId,
        eventId: input.eventId,
        payloadProfile: input.payloadProfile,
      },
    },
    update: {},
    create: {
      endpointId: input.endpointId,
      walletId: input.walletId,
      eventId: input.eventId,
      eventType: input.eventType,
      payloadProfile: input.payloadProfile,
      targetUrl: input.targetUrl,
      eventPayload: input.eventPayload,
      requestBody: input.requestBody ?? undefined,
      requestBodyHash: input.requestBodyHash ?? null,
      nextAttemptAt: new Date(),
    },
  });
}

export async function findDeliveryById(deliveryId: string): Promise<
  (WebhookDelivery & { endpoint: WebhookEndpoint }) | null
> {
  return prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
}

export async function listDueDeliveries(
  now: Date,
  limit = 100,
): Promise<WebhookDelivery[]> {
  return prisma.webhookDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      nextAttemptAt: { lte: now },
      OR: [
        { attemptLeaseExpiresAt: null },
        { attemptLeaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
}

export async function claimDeliveryAttempt(
  input: ClaimDeliveryAttemptInput,
): Promise<(WebhookDelivery & { endpoint: WebhookEndpoint }) | null> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.webhookDelivery.updateMany({
      where: {
        id: input.deliveryId,
        status: { in: ['pending', 'failed'] },
        attemptCount: input.expectedAttempt - 1,
        nextAttemptAt: { lte: input.now },
        OR: [
          { attemptLeaseExpiresAt: null },
          { attemptLeaseExpiresAt: { lte: input.now } },
        ],
      },
      data: {
        attemptLeaseToken: input.leaseToken,
        attemptLeaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (result.count !== 1) return null;

    return tx.webhookDelivery.findUniqueOrThrow({
      where: { id: input.deliveryId },
      include: { endpoint: true },
    });
  });
}

export async function markDeliveryPendingForReplay(deliveryId: string): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      attemptLeaseToken: null,
      attemptLeaseExpiresAt: null,
      lastAttemptAt: null,
      deliveredAt: null,
      lastStatusCode: null,
      lastError: null,
      responseBodyHash: null,
    },
  });
}

export async function markDeliveryDelivered(
  deliveryId: string,
  input: {
    expectedAttempt: number;
    leaseToken: string;
    statusCode: number;
    requestBody: Prisma.InputJsonValue;
    requestBodyHash: string;
    requestHeadersRedacted?: Prisma.InputJsonValue | null;
    responseBodyHash?: string | null;
  },
): Promise<WebhookDelivery | null> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        attemptCount: input.expectedAttempt - 1,
        attemptLeaseToken: input.leaseToken,
      },
      data: {
        status: 'delivered',
        attemptCount: input.expectedAttempt,
        lastAttemptAt: new Date(),
        deliveredAt: new Date(),
        lastStatusCode: input.statusCode,
        lastError: null,
        nextAttemptAt: null,
        attemptLeaseToken: null,
        attemptLeaseExpiresAt: null,
        requestBody: input.requestBody,
        requestBodyHash: input.requestBodyHash,
        requestHeadersRedacted: input.requestHeadersRedacted ?? undefined,
        responseBodyHash: input.responseBodyHash ?? null,
      },
    });
    if (result.count !== 1) return null;
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });

    await tx.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: {
        lastDeliveryStatus: 'delivered',
        lastDeliveredAt: new Date(),
        lastError: null,
      },
    });

    return delivery;
  });
}

export async function markDeliveryFailed(
  input: MarkDeliveryFailedInput,
): Promise<WebhookDelivery | null> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.webhookDelivery.updateMany({
      where: {
        id: input.deliveryId,
        attemptCount: input.expectedAttempt - 1,
        attemptLeaseToken: input.leaseToken,
      },
      data: {
        status: 'failed',
        attemptCount: input.expectedAttempt,
        lastAttemptAt: new Date(),
        lastStatusCode: input.statusCode ?? null,
        lastError: input.error,
        nextAttemptAt: input.nextAttemptAt,
        attemptLeaseToken: null,
        attemptLeaseExpiresAt: null,
        requestBody: input.requestBody ?? undefined,
        requestBodyHash: input.requestBodyHash ?? undefined,
        requestHeadersRedacted: input.requestHeadersRedacted ?? undefined,
        responseBodyHash: input.responseBodyHash ?? null,
      },
    });
    if (result.count !== 1) return null;
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } });

    await tx.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: {
        lastDeliveryStatus: 'failed',
        lastError: input.error,
      },
    });

    return delivery;
  });
}

export async function markDeliveryDead(
  input: MarkDeliveryDeadInput,
): Promise<(WebhookDelivery & { endpoint: WebhookEndpoint }) | null> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.webhookDelivery.updateMany({
      where: {
        id: input.deliveryId,
        attemptCount: input.expectedAttempt - 1,
        attemptLeaseToken: input.leaseToken,
      },
      data: {
        status: 'dead',
        attemptCount: input.expectedAttempt,
        lastAttemptAt: new Date(),
        lastStatusCode: input.statusCode ?? null,
        lastError: input.error,
        nextAttemptAt: null,
        attemptLeaseToken: null,
        attemptLeaseExpiresAt: null,
        requestBody: input.requestBody ?? undefined,
        requestBodyHash: input.requestBodyHash ?? undefined,
        requestHeadersRedacted: input.requestHeadersRedacted ?? undefined,
        responseBodyHash: input.responseBodyHash ?? null,
      },
    });
    if (result.count !== 1) return null;
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: input.deliveryId },
      include: { endpoint: true },
    });
    await tx.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: {
        lastDeliveryStatus: 'dead',
        lastError: input.error,
      },
    });

    return delivery;
  });
}

function wildcardEventType(eventType: string): string {
  const lastDotIndex = eventType.lastIndexOf('.');
  return lastDotIndex === -1 ? '*' : `${eventType.slice(0, lastDotIndex)}.*`;
}

function jsonValueOrUndefined(value: Prisma.InputJsonValue | null | undefined) {
  return value === null ? Prisma.JsonNull : value;
}

function jsonValueOrNull(value: Prisma.InputJsonValue | null | undefined) {
  return value === null ? Prisma.JsonNull : value;
}

export const webhookRepository = {
  listEndpoints,
  findEndpointForWallet,
  findEndpointById,
  findEnabledEndpointsForEvent,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  listDeliveries,
  listSupportPackageEndpoints,
  createDelivery,
  findDeliveryById,
  listDueDeliveries,
  claimDeliveryAttempt,
  markDeliveryPendingForReplay,
  markDeliveryDelivered,
  markDeliveryFailed,
  markDeliveryDead,
};

export default webhookRepository;
