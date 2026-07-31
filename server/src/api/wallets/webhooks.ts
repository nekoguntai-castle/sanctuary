/**
 * Wallets - Webhook Router
 *
 * Wallet-owned outbound webhook notification endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ApiError, ErrorCodes, NotFoundError } from '../../errors/ApiError';
import { requireAuthenticatedUser } from '../../middleware/auth';
import {
  createWalletWebhook,
  deleteWalletWebhook,
  getWalletWebhook,
  listWalletWebhookDeliveries,
  listWalletWebhooks,
  replayWalletWebhookDelivery,
  updateWalletWebhook,
} from '../../services/webhooks';
import { validateWebhookEndpointUrl } from '../../services/webhooks/endpointPolicy';
import { WEBHOOK_REDACTED_VALUE } from '@sanctuary/shared/constants/webhooks';

const router = Router();

const JsonRecordSchema = z.record(z.string(), z.unknown());
const WebhookHeaderNameSchema = z.string().trim().min(1).max(256);
const WebhookHeaderValueSchema = z.string().max(8192).refine(
  value => value !== WEBHOOK_REDACTED_VALUE,
  { message: 'Redacted webhook values cannot be stored as credentials' },
);
const WebhookHeaderConfigSchema = z.object({
  headers: z.record(WebhookHeaderNameSchema, WebhookHeaderValueSchema).optional(),
}).catchall(z.unknown());
const WebhookHeaderConfigUpdateSchema = z.object({
  headers: z.record(
    WebhookHeaderNameSchema,
    WebhookHeaderValueSchema.nullable(),
  ).optional(),
}).catchall(z.unknown());

const WebhookEndpointBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  url: z.string().trim().url().max(2048),
  eventTypes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  filters: JsonRecordSchema.optional(),
  payloadProfile: z.string().trim().min(1).max(120).optional(),
  authType: z.string().trim().min(1).max(80).optional(),
  secret: z.string().trim().min(1).max(8192).optional(),
  headerConfig: WebhookHeaderConfigSchema.optional(),
  profileConfig: JsonRecordSchema.optional(),
  retryConfig: JsonRecordSchema.optional(),
  maxAttempts: z.number().int().min(1).max(25).optional(),
  failureNotificationEnabled: z.boolean().optional(),
}).strict();

const UpdateWebhookEndpointBodySchema = WebhookEndpointBodySchema.partial().extend({
  headerConfig: WebhookHeaderConfigUpdateSchema.optional(),
}).refine(
  value => Object.keys(value).length > 0,
  { message: 'At least one webhook setting is required' },
);

const DeliveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();

/**
 * GET /api/v1/wallets/:walletId/webhooks
 */
router.get('/:walletId/webhooks', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const endpoints = await listWalletWebhooks(req.walletId!, req.walletRole);
  res.json({ webhooks: endpoints });
}));

/**
 * POST /api/v1/wallets/:walletId/webhooks
 */
router.post('/:walletId/webhooks', requireWalletAccess('owner'), validate(
  { body: WebhookEndpointBodySchema },
  { message: 'Invalid webhook endpoint', code: ErrorCodes.INVALID_INPUT },
), asyncHandler(async (req, res) => {
  const endpoint = await createWalletWebhook(
    req.walletId!,
    requireAuthenticatedUser(req).userId,
    req.body,
    req.walletRole,
  );
  res.status(201).json({ webhook: endpoint });
}));

/**
 * GET /api/v1/wallets/:walletId/webhooks/:webhookId
 */
router.get('/:walletId/webhooks/:webhookId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const endpoint = await getWalletWebhook(req.walletId!, req.params.webhookId, req.walletRole);
  if (!endpoint) throw new NotFoundError('Webhook endpoint not found');
  res.json({ webhook: endpoint });
}));

/**
 * PATCH /api/v1/wallets/:walletId/webhooks/:webhookId
 */
router.patch('/:walletId/webhooks/:webhookId', requireWalletAccess('owner'), validate(
  { body: UpdateWebhookEndpointBodySchema },
  { message: 'Invalid webhook endpoint update', code: ErrorCodes.INVALID_INPUT },
), asyncHandler(async (req, res) => {
  const endpoint = await updateWalletWebhook(
    req.walletId!,
    req.params.webhookId,
    req.body,
    req.walletRole,
  );
  if (!endpoint) throw new NotFoundError('Webhook endpoint not found');
  res.json({ webhook: endpoint });
}));

/**
 * DELETE /api/v1/wallets/:walletId/webhooks/:webhookId
 */
router.delete('/:walletId/webhooks/:webhookId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const deleted = await deleteWalletWebhook(req.walletId!, req.params.webhookId);
  if (!deleted) throw new NotFoundError('Webhook endpoint not found');
  res.json({ success: true, message: 'Webhook endpoint deleted' });
}));

/**
 * POST /api/v1/wallets/:walletId/webhooks/:webhookId/test
 *
 * The first implementation validates endpoint ownership/config reachability
 * without sending synthetic wallet data to third-party accounting systems.
 */
router.post('/:walletId/webhooks/:webhookId/test', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const endpoint = await getWalletWebhook(req.walletId!, req.params.webhookId, req.walletRole);
  if (!endpoint) throw new NotFoundError('Webhook endpoint not found');
  await validateWebhookEndpointUrl(endpoint.url);
  res.json({ success: true, message: 'Webhook endpoint URL is allowed' });
}));

/**
 * GET /api/v1/wallets/:walletId/webhooks/:webhookId/deliveries
 */
router.get('/:walletId/webhooks/:webhookId/deliveries', requireWalletAccess('edit'), validate(
  { query: DeliveryQuerySchema },
  { message: 'Invalid webhook delivery query', code: ErrorCodes.INVALID_INPUT },
), asyncHandler(async (req, res) => {
  const endpoint = await getWalletWebhook(req.walletId!, req.params.webhookId, req.walletRole);
  if (!endpoint) throw new NotFoundError('Webhook endpoint not found');
  const deliveries = await listWalletWebhookDeliveries(
    req.walletId!,
    req.params.webhookId,
    req.query.limit ? Number(req.query.limit) : 50,
    req.walletRole,
  );
  res.json({ deliveries });
}));

/**
 * POST /api/v1/wallets/:walletId/webhooks/:webhookId/deliveries/:deliveryId/replay
 */
router.post(
  '/:walletId/webhooks/:webhookId/deliveries/:deliveryId/replay',
  requireWalletAccess('edit'),
  asyncHandler(async (req, res) => {
    const endpoint = await getWalletWebhook(
      req.walletId!,
      req.params.webhookId,
      req.walletRole,
    );
    if (!endpoint) throw new NotFoundError('Webhook endpoint not found');
    if (!endpoint.enabled) {
      throw new ApiError('Webhook endpoint is disabled', 400, ErrorCodes.INVALID_INPUT);
    }

    const result = await replayWalletWebhookDelivery(
      req.walletId!,
      req.params.webhookId,
      req.params.deliveryId,
      req.walletRole,
    );
    if (!result) throw new NotFoundError('Webhook delivery not found');
    res.json(result);
  }),
);

export default router;
