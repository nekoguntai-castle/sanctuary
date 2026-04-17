import crypto from 'node:crypto';
import type { Request } from 'express';
import { agentRepository, AGENT_ACTION_CREATE_FUNDING_DRAFT } from '../repositories/agentRepository';
import { ForbiddenError, UnauthorizedError } from '../errors/ApiError';
import { getClientInfo } from '../services/auditService';

const AGENT_KEY_PATTERN = /^agt_[a-f0-9]{64}$/;
const KEY_PREFIX_LENGTH = 16;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface AgentApiKeyScope {
  allowedActions?: string[];
}

export interface AgentRequestContext {
  keyId: string;
  keyPrefix: string;
  userId: string;
  username: string;
  agentId: string;
  agentName: string;
  agentStatus: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  scope: AgentApiKeyScope;
}

export function generateAgentApiKey(): string {
  return `agt_${crypto.randomBytes(32).toString('hex')}`;
}

export function getAgentApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, KEY_PREFIX_LENGTH);
}

export function hashAgentApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export function validateAgentApiKeyFormat(apiKey: string): boolean {
  return AGENT_KEY_PATTERN.test(apiKey);
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || !scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
}

export function buildAgentKeyScope(input: {
  allowedActions?: string[];
} = {}): AgentApiKeyScope {
  return {
    allowedActions: Array.from(new Set(input.allowedActions ?? [AGENT_ACTION_CREATE_FUNDING_DRAFT])),
  };
}

export function parseAgentKeyScope(value: unknown): AgentApiKeyScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return buildAgentKeyScope();
  }

  const scope = value as Record<string, unknown>;
  return {
    /* v8 ignore start -- API key scopes are normalized at creation time */
    ...(Array.isArray(scope.allowedActions)
      ? { allowedActions: scope.allowedActions.filter((action): action is string => typeof action === 'string') }
      : buildAgentKeyScope()),
    /* v8 ignore stop */
  };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function authenticateAgentRequest(req: Request): Promise<AgentRequestContext> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !validateAgentApiKeyFormat(token)) {
    throw new UnauthorizedError('Valid agent bearer token required');
  }

  const keyHash = hashAgentApiKey(token);
  const key = await agentRepository.findApiKeyByHash(keyHash);
  if (!key || !timingSafeEqualHex(keyHash, key.keyHash)) {
    throw new UnauthorizedError('Invalid agent API key');
  }

  if (key.revokedAt) {
    throw new UnauthorizedError('Agent API key has been revoked');
  }

  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Agent API key has expired');
  }

  if (key.agent.revokedAt || key.agent.status !== 'active') {
    throw new ForbiddenError('Agent is not active');
  }

  const { ipAddress, userAgent } = getClientInfo(req);
  await agentRepository.updateApiKeyLastUsedIfStale(
    key.id,
    new Date(Date.now() - LAST_USED_THROTTLE_MS),
    { lastUsedIp: ipAddress, lastUsedAgent: userAgent }
  );

  return {
    keyId: key.id,
    keyPrefix: key.keyPrefix,
    userId: key.agent.userId,
    username: key.agent.user.username,
    agentId: key.agent.id,
    agentName: key.agent.name,
    agentStatus: key.agent.status,
    fundingWalletId: key.agent.fundingWalletId,
    operationalWalletId: key.agent.operationalWalletId,
    signerDeviceId: key.agent.signerDeviceId,
    scope: parseAgentKeyScope(key.scope),
  };
}

export function requireAgentFundingDraftAccess(
  context: AgentRequestContext,
  fundingWalletId: string,
  operationalWalletId: string
): void {
  if (context.fundingWalletId !== fundingWalletId) {
    throw new ForbiddenError('Agent API key is not scoped for this funding wallet');
  }

  if (context.operationalWalletId !== operationalWalletId) {
    throw new ForbiddenError('Agent API key is not scoped for this operational wallet');
  }

  /* v8 ignore next -- buildAgentKeyScope always materializes allowedActions */
  const allowedActions = context.scope.allowedActions ?? [];
  if (!allowedActions.includes(AGENT_ACTION_CREATE_FUNDING_DRAFT)) {
    throw new ForbiddenError('Agent API key cannot create funding drafts');
  }
}
