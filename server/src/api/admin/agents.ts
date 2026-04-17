/**
 * Admin Wallet Agent Router
 *
 * Admin-only management for linked agent funding/operational wallets and
 * scoped `agt_` bearer credentials.
 */

import { Router } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { agentRepository, userRepository, walletRepository } from '../../repositories';
import {
  AgentApiKeyIdParamSchema,
  CreateAgentApiKeySchema,
  CreateWalletAgentSchema,
  ListWalletAgentsQuerySchema,
  UpdateWalletAgentSchema,
  WalletAgentIdParamSchema,
} from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';
import {
  buildAgentKeyScope,
  generateAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
} from '../../agent/auth';
import { toAgentApiKeyMetadata, toWalletAgentMetadata } from '../../agent/dto';

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

async function validateAgentLink(input: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
}): Promise<void> {
  if (input.fundingWalletId === input.operationalWalletId) {
    throw new InvalidInputError('Funding wallet and operational wallet must be different');
  }

  const [targetUser, fundingWallet, operationalWallet, fundingWalletWithDevices] = await Promise.all([
    userRepository.findById(input.userId),
    walletRepository.findById(input.fundingWalletId),
    walletRepository.findById(input.operationalWalletId),
    walletRepository.findByIdWithSigningDevices(input.fundingWalletId),
  ]);

  if (!targetUser) {
    throw new NotFoundError('User not found');
  }
  if (!fundingWallet) {
    throw new NotFoundError('Funding wallet not found');
  }
  if (!operationalWallet) {
    throw new NotFoundError('Operational wallet not found');
  }
  if (fundingWallet.type !== 'multi_sig') {
    throw new InvalidInputError('Funding wallet must be a multisig wallet');
  }
  if (operationalWallet.type !== 'single_sig') {
    throw new InvalidInputError('Operational wallet must be a single-sig wallet');
  }
  if (fundingWallet.network !== operationalWallet.network) {
    throw new InvalidInputError('Funding wallet and operational wallet must use the same network');
  }

  const [hasFundingAccess, hasOperationalAccess] = await Promise.all([
    walletRepository.hasAccess(input.fundingWalletId, input.userId),
    walletRepository.hasAccess(input.operationalWalletId, input.userId),
  ]);
  if (!hasFundingAccess) {
    throw new InvalidInputError('User does not have access to the funding wallet');
  }
  if (!hasOperationalAccess) {
    throw new InvalidInputError('User does not have access to the operational wallet');
  }

  const signerDeviceIds = new Set((fundingWalletWithDevices?.devices ?? []).map(device => device.deviceId));
  if (!signerDeviceIds.has(input.signerDeviceId)) {
    throw new InvalidInputError('Signer device must belong to the funding wallet');
  }
}

function collectWalletAccessUserIds(wallet: {
  users: Array<{ userId: string }>;
  group: { members: Array<{ userId: string }> } | null;
}): string[] {
  return [...new Set([
    ...wallet.users.map(user => user.userId),
    ...(wallet.group?.members.map(member => member.userId) ?? []),
  ])];
}

/**
 * GET /api/v1/admin/agents/options
 * Return admin-visible user, wallet, and signer-device choices for agent forms.
 */
router.get('/options', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const [users, wallets] = await Promise.all([
    userRepository.findAllSummary(),
    walletRepository.findAllWithSelect({
      id: true,
      name: true,
      type: true,
      network: true,
      users: {
        select: {
          userId: true,
        },
      },
      group: {
        select: {
          members: {
            select: { userId: true },
          },
        },
      },
      devices: {
        select: {
          deviceId: true,
          device: {
            select: {
              id: true,
              label: true,
              fingerprint: true,
              type: true,
              userId: true,
            },
          },
        },
      },
    }),
  ]);

  const deviceById = new Map<string, {
    id: string;
    label: string;
    fingerprint: string;
    type: string;
    userId: string;
    walletIds: Set<string>;
  }>();

  const walletOptions = wallets
    .map(wallet => {
      const accessUserIds = collectWalletAccessUserIds(wallet);
      const deviceIds = wallet.devices.map(link => link.deviceId);

      for (const link of wallet.devices) {
        const current = deviceById.get(link.device.id) ?? {
          id: link.device.id,
          label: link.device.label,
          fingerprint: link.device.fingerprint,
          type: link.device.type,
          userId: link.device.userId,
          walletIds: new Set<string>(),
        };
        current.walletIds.add(wallet.id);
        deviceById.set(current.id, current);
      }

      return {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        network: wallet.network,
        accessUserIds,
        deviceIds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const deviceOptions = [...deviceById.values()]
    .map(device => ({
      id: device.id,
      label: device.label,
      fingerprint: device.fingerprint,
      type: device.type,
      userId: device.userId,
      walletIds: [...device.walletIds].sort(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  res.json({
    users,
    wallets: walletOptions,
    devices: deviceOptions,
  });
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

  const agents = await agentRepository.findAgents(parsedQuery.data);
  res.json(agents.map(toWalletAgentMetadata));
}));

/**
 * POST /api/v1/admin/agents
 * Register a linked wallet agent.
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const input = parseAdminRequestBody(CreateWalletAgentSchema, req.body);
  await validateAgentLink(input);

  const agent = await agentRepository.createAgent({
    userId: input.userId,
    name: input.name.trim(),
    fundingWalletId: input.fundingWalletId,
    operationalWalletId: input.operationalWalletId,
    signerDeviceId: input.signerDeviceId,
    status: input.status,
    maxFundingAmountSats: input.maxFundingAmountSats ?? null,
    maxOperationalBalanceSats: input.maxOperationalBalanceSats ?? null,
    dailyFundingLimitSats: input.dailyFundingLimitSats ?? null,
    weeklyFundingLimitSats: input.weeklyFundingLimitSats ?? null,
    cooldownMinutes: input.cooldownMinutes ?? null,
    requireHumanApproval: input.requireHumanApproval,
    notifyOnOperationalSpend: input.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend,
  });

  await auditService.logFromRequest(req, AuditAction.AGENT_CREATE, AuditCategory.WALLET, {
    details: {
      agentId: agent.id,
      targetUserId: agent.userId,
      fundingWalletId: agent.fundingWalletId,
      operationalWalletId: agent.operationalWalletId,
      signerDeviceId: agent.signerDeviceId,
    },
  });

  const created = await agentRepository.findAgentByIdWithDetails(agent.id);
  res.status(201).json(toWalletAgentMetadata(created ?? agent));
}));

/**
 * PATCH /api/v1/admin/agents/:agentId
 * Update mutable agent status and policy settings.
 */
router.patch('/:agentId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const input = parseAdminRequestBody(UpdateWalletAgentSchema, req.body);
  const existing = await agentRepository.findAgentById(agentId);
  if (!existing) {
    throw new NotFoundError('Wallet agent not found');
  }

  const updated = await agentRepository.updateAgent(agentId, {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.maxFundingAmountSats !== undefined && { maxFundingAmountSats: input.maxFundingAmountSats }),
    ...(input.maxOperationalBalanceSats !== undefined && { maxOperationalBalanceSats: input.maxOperationalBalanceSats }),
    ...(input.dailyFundingLimitSats !== undefined && { dailyFundingLimitSats: input.dailyFundingLimitSats }),
    ...(input.weeklyFundingLimitSats !== undefined && { weeklyFundingLimitSats: input.weeklyFundingLimitSats }),
    ...(input.cooldownMinutes !== undefined && { cooldownMinutes: input.cooldownMinutes }),
    ...(input.requireHumanApproval !== undefined && { requireHumanApproval: input.requireHumanApproval }),
    ...(input.notifyOnOperationalSpend !== undefined && { notifyOnOperationalSpend: input.notifyOnOperationalSpend }),
    ...(input.pauseOnUnexpectedSpend !== undefined && { pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend }),
    ...(input.status === 'revoked' && !existing.revokedAt && { revokedAt: new Date() }),
    ...(input.status && input.status !== 'revoked' && { revokedAt: null }),
  });

  await auditService.logFromRequest(req, AuditAction.AGENT_UPDATE, AuditCategory.WALLET, {
    details: {
      agentId: updated.id,
      status: updated.status,
    },
  });

  const detailed = await agentRepository.findAgentByIdWithDetails(agentId);
  res.json(toWalletAgentMetadata(detailed ?? updated));
}));

/**
 * DELETE /api/v1/admin/agents/:agentId
 * Soft-revoke a wallet agent.
 */
router.delete('/:agentId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const existing = await agentRepository.findAgentById(agentId);
  if (!existing) {
    throw new NotFoundError('Wallet agent not found');
  }

  const revoked = existing.revokedAt
    ? existing
    : await agentRepository.updateAgent(agentId, { status: 'revoked', revokedAt: new Date() });

  await auditService.logFromRequest(req, AuditAction.AGENT_REVOKE, AuditCategory.WALLET, {
    details: {
      agentId: revoked.id,
      alreadyRevoked: Boolean(existing.revokedAt),
    },
  });

  res.json(toWalletAgentMetadata(revoked));
}));

/**
 * GET /api/v1/admin/agents/:agentId/keys
 * List scoped agent API key metadata. Full tokens and hashes are never returned.
 */
router.get('/:agentId/keys', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }

  const keys = await agentRepository.findApiKeysByAgentId(agentId);
  res.json(keys.map(toAgentApiKeyMetadata));
}));

/**
 * POST /api/v1/admin/agents/:agentId/keys
 * Create a scoped agent API key. Returns the full token once.
 */
router.post('/:agentId/keys', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const agentId = parseAgentId(req.params);
  const input = parseAdminRequestBody(CreateAgentApiKeySchema, req.body);
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new InvalidInputError('expiresAt must be in the future');
  }

  const agent = await agentRepository.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Wallet agent not found');
  }
  if (agent.revokedAt || agent.status === 'revoked') {
    throw new InvalidInputError('Cannot create API keys for a revoked agent');
  }

  const apiKey = generateAgentApiKey();
  const scope = buildAgentKeyScope({ allowedActions: input.allowedActions });
  const key = await agentRepository.createApiKey({
    agentId,
    createdByUserId: req.user?.userId ?? null,
    name: input.name.trim(),
    keyHash: hashAgentApiKey(apiKey),
    keyPrefix: getAgentApiKeyPrefix(apiKey),
    scope: scope as Prisma.InputJsonValue,
    expiresAt: input.expiresAt ?? null,
  });

  await auditService.logFromRequest(req, AuditAction.AGENT_KEY_CREATE, AuditCategory.WALLET, {
    details: {
      agentId,
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      expiresAt: input.expiresAt?.toISOString(),
      allowedActions: scope.allowedActions ?? [],
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
  const existing = await agentRepository.findApiKeyById(keyId);
  if (!existing || existing.agentId !== agentId) {
    throw new NotFoundError('Agent API key not found');
  }

  const revoked = existing.revokedAt ? existing : await agentRepository.revokeApiKey(keyId);

  await auditService.logFromRequest(req, AuditAction.AGENT_KEY_REVOKE, AuditCategory.WALLET, {
    details: {
      agentId,
      keyId: revoked.id,
      keyPrefix: revoked.keyPrefix,
      alreadyRevoked: Boolean(existing.revokedAt),
    },
  });

  res.json(toAgentApiKeyMetadata(revoked));
}));

export default router;
