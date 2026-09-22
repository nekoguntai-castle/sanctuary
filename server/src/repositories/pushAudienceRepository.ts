import prisma from '../models/prisma';

export interface GatewayPushCandidate {
  userId: string;
  preferences: unknown;
}

export interface GatewayPushAudience {
  walletId: string;
  walletName: string;
  candidates: GatewayPushCandidate[];
  transaction: { type: string; amount: bigint } | null;
}

/** Load and deduplicate the direct-user and group-member push audience. */
export async function findGatewayPushAudience(
  walletId: string,
  txid: string,
): Promise<GatewayPushAudience | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      id: true,
      name: true,
      users: {
        select: { user: { select: { id: true, preferences: true } } },
      },
      group: {
        select: {
          members: {
            select: { user: { select: { id: true, preferences: true } } },
          },
        },
      },
      transactions: {
        where: { txid },
        select: { type: true, amount: true },
        take: 1,
      },
    },
  });
  if (!wallet) return null;

  const candidates = new Map<string, GatewayPushCandidate>();
  for (const membership of wallet.users) {
    candidates.set(membership.user.id, {
      userId: membership.user.id,
      preferences: membership.user.preferences,
    });
  }
  for (const membership of wallet.group?.members ?? []) {
    if (!candidates.has(membership.user.id)) {
      candidates.set(membership.user.id, {
        userId: membership.user.id,
        preferences: membership.user.preferences,
      });
    }
  }

  return {
    walletId: wallet.id,
    walletName: wallet.name,
    candidates: [...candidates.values()],
    transaction: wallet.transactions[0] ?? null,
  };
}

export const pushAudienceRepository = { findGatewayPushAudience };
export default pushAudienceRepository;
