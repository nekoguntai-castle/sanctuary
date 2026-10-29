import crypto from 'node:crypto';
import type { Request } from 'express';
import { agentRepository, AGENT_ACTION_CREATE_FUNDING_DRAFT } from '../repositories/agentRepository';
import { ErrorCodes, ForbiddenError, UnauthorizedError } from '../errors/ApiError';
import { findAgentWalletAccessProblem } from '../services/agentWalletAccess';
import { getClientInfo } from '../services/auditService';
import { hashApiKeyLookup, hashLegacyApiKeyLookup } from '../utils/apiKeyHash';

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
  signerDeviceId: string | null;
  scope: AgentApiKeyScope;
}

export function generateAgentApiKey(): string {
  return `agt_${crypto.randomBytes(32).toString('hex')}`;
}

export function getAgentApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, KEY_PREFIX_LENGTH);
}

export function hashAgentApiKey(apiKey: string): string {
  return hashApiKeyLookup(apiKey, 'agent');
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

export function buildAgentKeyScope(
  input: {
    allowedActions?: string[];
  } = {}
): AgentApiKeyScope {
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
      ? {
          allowedActions: scope.allowedActions.filter((action): action is string => typeof action === 'string'),
        }
      : buildAgentKeyScope()),
    /* v8 ignore stop */
  };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function findAgentApiKeyForToken(token: string) {
  const candidateHashes = [hashAgentApiKey(token), hashLegacyApiKeyLookup(token)];
  for (const candidateHash of candidateHashes) {
    // eslint-disable-next-line no-await-in-loop -- fallback lookup must preserve exact precedence.
    const key = await agentRepository.findApiKeyByHash(candidateHash);
    if (key && timingSafeEqualHex(candidateHash, key.keyHash)) {
      return { key, keyHash: candidateHash };
    }
  }
  return null;
}

/**
 * Agent keys act for their user, so they stop working once that user loses
 * access to either linked wallet (share removal, ownership transfer), and
 * while the user cannot edit the funding wallet: creating or signing a funding
 * draft needs the same owner/signer role as the human draft routes
 * (`requireWalletAccess('edit')`). The operational wallet is only read and
 * received into, so any role keeps it. Roles resolve as the human middleware
 * does (a direct role takes precedence over group membership). Agent state is
 * not mutated; restoring access or the role restores the key.
 */
async function assertAgentUserWalletAccess(agent: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
}): Promise<void> {
  const problem = await findAgentWalletAccessProblem(agent);
  if (problem === 'funding_access') {
    throw walletAccessLostError('funding');
  }
  if (problem === 'operational_access') {
    throw walletAccessLostError('operational');
  }
  if (problem === 'funding_role') {
    throw new ForbiddenError(
      'Agent user cannot create drafts on the funding wallet',
      ErrorCodes.FORBIDDEN,
      { reason: 'agent_user_wallet_role_insufficient', wallet: 'funding' },
    );
  }
}

function walletAccessLostError(wallet: 'funding' | 'operational'): ForbiddenError {
  return new ForbiddenError(
    `Agent user no longer has access to the ${wallet} wallet`,
    ErrorCodes.FORBIDDEN,
    { reason: 'agent_user_wallet_access_lost', wallet },
  );
}

export async function authenticateAgentRequest(req: Request): Promise<AgentRequestContext> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !validateAgentApiKeyFormat(token)) {
    throw new UnauthorizedError('Valid agent bearer token required');
  }

  const match = await findAgentApiKeyForToken(token);
  if (!match) {
    throw new UnauthorizedError('Invalid agent API key');
  }
  const { key } = match;

  if (key.revokedAt) {
    throw new UnauthorizedError('Agent API key has been revoked');
  }

  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Agent API key has expired');
  }

  if (key.agent.revokedAt || key.agent.status !== 'active') {
    throw new ForbiddenError('Agent is not active');
  }

  // Before recording use, so a refused call does not refresh lastUsedAt.
  await assertAgentUserWalletAccess(key.agent);

  const { ipAddress, userAgent } = getClientInfo(req);
  await agentRepository.updateApiKeyLastUsedIfStale(key.id, new Date(Date.now() - LAST_USED_THROTTLE_MS), {
    lastUsedIp: ipAddress,
    lastUsedAgent: userAgent,
  });

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
