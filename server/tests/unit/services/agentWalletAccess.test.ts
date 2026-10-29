/**
 * Agent Wallet Access Tests
 *
 * Resolves real roles through accessControl and the repositories, with Prisma mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import type { WalletUser } from '../../../src/generated/prisma/client';

vi.mock('../../../src/models/prisma', () => ({
  default: {
    walletUser: {
      findFirst: vi.fn(),
    },
    wallet: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import prisma from '../../../src/models/prisma';
import { buildWalletAccessWhere } from '../../../src/services/accessControl';
import { findAgentWalletAccessProblem } from '../../../src/services/agentWalletAccess';

function makeWalletUser(walletId: string, userId: string, role: string): WalletUser {
  return {
    id: faker.string.uuid(),
    walletId,
    userId,
    role,
    createdAt: new Date(),
  } satisfies WalletUser;
}

describe('findAgentWalletAccessProblem', () => {
  const userId = faker.string.uuid();
  const agent = { userId, fundingWalletId: 'funding-wallet', operationalWalletId: 'operational-wallet' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Direct roles, a group role on the funding wallet, and plain access to the operational wallet. */
  function grant(roles: { funding?: string; fundingGroup?: string; operational: boolean }) {
    vi.mocked(prisma.walletUser.findFirst).mockImplementation((async (args: { where: { walletId: string } }) => (
      args.where.walletId === agent.fundingWalletId && roles.funding
        ? makeWalletUser(agent.fundingWalletId, userId, roles.funding)
        : null
    )) as never);
    vi.mocked(prisma.wallet.findFirst).mockImplementation((async (args: { where: { id: string; group?: unknown } }) => {
      if (args.where.id === agent.fundingWalletId) {
        return args.where.group && roles.fundingGroup ? { groupRole: roles.fundingGroup } : null;
      }
      return args.where.id === agent.operationalWalletId && roles.operational ? { id: args.where.id } : null;
    }) as never);
  }

  it('reports lost funding access first, even when the operational wallet is also gone', async () => {
    grant({ operational: false });

    await expect(findAgentWalletAccessProblem(agent)).resolves.toBe('funding_access');
  });

  it('reports lost operational access before a read-only funding role', async () => {
    grant({ funding: 'viewer', operational: false });

    await expect(findAgentWalletAccessProblem(agent)).resolves.toBe('operational_access');
  });

  it.each(['viewer', 'approver'])('reports a funding role of %s as insufficient', async role => {
    grant({ funding: role, operational: true });

    await expect(findAgentWalletAccessProblem(agent)).resolves.toBe('funding_role');
  });

  it.each(['owner', 'signer'])('accepts a funding %s with any access to the operational wallet', async role => {
    grant({ funding: role, operational: true });

    await expect(findAgentWalletAccessProblem(agent)).resolves.toBeNull();
    expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
      where: { walletId: agent.fundingWalletId, userId },
    });
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { id: agent.operationalWalletId, ...buildWalletAccessWhere(userId) },
      select: { id: true },
    });
  });

  it('resolves the funding role through group membership', async () => {
    grant({ fundingGroup: 'signer', operational: true });
    await expect(findAgentWalletAccessProblem(agent)).resolves.toBeNull();

    grant({ fundingGroup: 'viewer', operational: true });
    await expect(findAgentWalletAccessProblem(agent)).resolves.toBe('funding_role');
  });
});
