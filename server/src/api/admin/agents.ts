/**
 * Admin Wallet Agent Router
 *
 * Admin-only management for linked agent funding/operational wallets and
 * scoped `agt_` bearer credentials.
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import {
  createAgentApiKey,
  createAgentFundingOverride,
  createWalletAgent,
  getAgentDashboardRows,
  getAgentOptions,
  listAgentAlerts,
  listAgentApiKeys,
  listAgentFundingOverrides,
  listWalletAgents,
  revokeAgentApiKey,
  revokeAgentFundingOverride,
  revokeWalletAgent,
  updateWalletAgent,
} from '../../services/adminAgentService';
import {
  AgentApiKeyIdParamSchema,
  AgentFundingOverrideIdParamSchema,
  CreateAgentFundingOverrideSchema,
  CreateAgentApiKeySchema,
  CreateWalletAgentSchema,
  ListAgentAlertsQuerySchema,
  ListAgentFundingOverridesQuerySchema,
  ListWalletAgentsQuerySchema,
  UpdateWalletAgentSchema,
  WalletAgentIdParamSchema,
} from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';
import {
  toAgentAlertMetadata,
  toAgentApiKeyMetadata,
  toAgentFundingOverrideMetadata,
  toAgentWalletDashboardRowMetadata,
  toWalletAgentMetadata,
} from '../../agent/dto';

const router = Router();

function parseAgentId(params: unknown): string {
  const parsed = WalletAgentIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid wallet agent id');
  }
  return parsed.data.agentId;
}

function parseAgentKeyParams(params: unknown): { agentId: string; keyId: string } {
  const parsed = AgentApiKeyIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid wallet agent or API key id');
  }
  return parsed.data;
}

function parseAgentOverrideParams(params: unknown): { agentId: string; overrideId: string } {
  const parsed = AgentFundingOverrideIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid wallet agent or override id');
  }
  return parsed.data;
}

/**
 * GET /api/v1/admin/agents/options
 * Return admin-visible user, wallet, and signer-device choices for agent forms.
 */
router.get('/options', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await getAgentOptions());
}));

/**
 * GET /api/v1/admin/agents
 * List wallet agents and scoped key metadata. Full tokens and hashes are never returned.
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const parsedQuery = ListWalletAgentsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new InvalidInputError('Invalid wallet agent list query');
  }

  const agents = await listWalletAgents(parsedQuery.data);
  res.json(agents.map(toWalletAgentMetadata));
}));

/**
 * GET /api/v1/admin/agents/dashboard
 * Return operational dashboard rows for linked agent wallets.
 */
router.get('/dashboard', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const rows = await getAgentDashboardRows();
  res.json(rows.map(toAgentWalletDashboardRowMetadata));
}));

/**
 * POST /api/v1/admin/agents
 * Register a linked wallet agent.
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const input = parseAdminRequestBody(CreateWalletAgentSchema, req.body);
  const agent = await createWalletAgent(input);

  await auditService.logFromRequest(req, AuditAction.AGENT_CREATE, AuditCategory.WALLET, {
    details: {
      agentId: agent.id,
      targetUserId: agent.userId,
      fundingWalletId: agent.fundingWalletId,
      operationalWalletId: agent.operationalWalletId,
      signerDeviceId: agent.signerDeviceId,
    },
  });

  res.status(201).json(toWalletAgentMetadata(agent));
}));

/**
 * PATCH /api/v1/admin/agents/:agentId
 * Update mutable agent status and policy settings.
 */
router.patch('/:agentId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const input = parseAdminRequestBody(UpdateWalletAgentSchema, req.body);
  const updated = await updateWalletAgent(agentId, input);

  await auditService.logFromRequest(req, AuditAction.AGENT_UPDATE, AuditCategory.WALLET, {
    details: {
      agentId: updated.id,
      status: updated.status,
    },
  });

  res.json(toWalletAgentMetadata(updated));
}));

/**
 * DELETE /api/v1/admin/agents/:agentId
 * Soft-revoke a wallet agent.
 */
router.delete('/:agentId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const { agent: revoked, alreadyRevoked } = await revokeWalletAgent(agentId);

  await auditService.logFromRequest(req, AuditAction.AGENT_REVOKE, AuditCategory.WALLET, {
    details: {
      agentId: revoked.id,
      alreadyRevoked,
    },
  });

  res.json(toWalletAgentMetadata(revoked));
}));

/**
 * GET /api/v1/admin/agents/:agentId/alerts
 * List persisted operational monitoring alerts for a wallet agent.
 */
router.get('/:agentId/alerts', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const parsedQuery = ListAgentAlertsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new InvalidInputError('Invalid wallet agent alert list query');
  }

  const alerts = await listAgentAlerts({
    agentId,
    ...parsedQuery.data,
  });
  res.json(alerts.map(toAgentAlertMetadata));
}));

/**
 * GET /api/v1/admin/agents/:agentId/overrides
 * List human-created exceptional funding overrides for a wallet agent.
 */
router.get('/:agentId/overrides', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const parsedQuery = ListAgentFundingOverridesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new InvalidInputError('Invalid wallet agent override list query');
  }

  const overrides = await listAgentFundingOverrides({
    agentId,
    ...parsedQuery.data,
  });
  res.json(overrides.map(toAgentFundingOverrideMetadata));
}));

/**
 * POST /api/v1/admin/agents/:agentId/overrides
 * Create a bounded owner override for exceptional agent funding.
 */
router.post('/:agentId/overrides', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const input = parseAdminRequestBody(CreateAgentFundingOverrideSchema, req.body);
  const override = await createAgentFundingOverride(
    agentId,
    input,
    /* v8 ignore next -- admin auth middleware normally guarantees req.user for this route */
    req.user?.userId ?? null
  );

  await auditService.logFromRequest(req, AuditAction.AGENT_OVERRIDE_CREATE, AuditCategory.WALLET, {
    details: {
      agentId,
      overrideId: override.id,
      fundingWalletId: override.fundingWalletId,
      operationalWalletId: override.operationalWalletId,
      maxAmountSats: override.maxAmountSats.toString(),
      expiresAt: override.expiresAt.toISOString(),
      reason: override.reason,
    },
  });

  res.status(201).json(toAgentFundingOverrideMetadata(override));
}));

/**
 * DELETE /api/v1/admin/agents/:agentId/overrides/:overrideId
 * Revoke a still-active funding override.
 */
router.delete('/:agentId/overrides/:overrideId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { agentId, overrideId } = parseAgentOverrideParams(req.params);
  const { override: revoked, alreadyInactive } = await revokeAgentFundingOverride(agentId, overrideId);

  await auditService.logFromRequest(req, AuditAction.AGENT_OVERRIDE_REVOKE, AuditCategory.WALLET, {
    details: {
      agentId,
      overrideId: revoked.id,
      alreadyInactive,
    },
  });

  res.json(toAgentFundingOverrideMetadata(revoked));
}));

/**
 * GET /api/v1/admin/agents/:agentId/keys
 * List scoped agent API key metadata. Full tokens and hashes are never returned.
 */
router.get('/:agentId/keys', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const keys = await listAgentApiKeys(agentId);
  res.json(keys.map(toAgentApiKeyMetadata));
}));

/**
 * POST /api/v1/admin/agents/:agentId/keys
 * Create a scoped agent API key. Returns the full token once.
 */
router.post('/:agentId/keys', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const input = parseAdminRequestBody(CreateAgentApiKeySchema, req.body);
  const { key, apiKey, scope } = await createAgentApiKey(
    agentId,
    input,
    /* v8 ignore next -- admin auth middleware normally guarantees req.user for this route */
    req.user?.userId ?? null
  );

  await auditService.logFromRequest(req, AuditAction.AGENT_KEY_CREATE, AuditCategory.WALLET, {
    details: {
      agentId,
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      expiresAt: input.expiresAt?.toISOString(),
      /* v8 ignore start -- buildAgentKeyScope always materializes allowedActions */
      allowedActions: scope.allowedActions ?? [],
      /* v8 ignore stop */
    },
  });

  res.status(201).json({
    ...toAgentApiKeyMetadata(key),
    apiKey,
  });
}));

/**
 * DELETE /api/v1/admin/agents/:agentId/keys/:keyId
 * Soft-revoke a scoped agent API key.
 */
router.delete('/:agentId/keys/:keyId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { agentId, keyId } = parseAgentKeyParams(req.params);
  const { key: revoked, alreadyRevoked } = await revokeAgentApiKey(agentId, keyId);

  await auditService.logFromRequest(req, AuditAction.AGENT_KEY_REVOKE, AuditCategory.WALLET, {
    details: {
      agentId,
      keyId: revoked.id,
      keyPrefix: revoked.keyPrefix,
      alreadyRevoked,
    },
  });

  res.json(toAgentApiKeyMetadata(revoked));
}));

export default router;
