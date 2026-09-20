import type { Prisma } from '../generated/prisma/client';

/** Build a notification audience that honors a direct wallet role before a group role. */
export function buildUserWalletAccessWhere(
  walletId: string,
  walletRoles?: string[],
): Prisma.UserWhereInput {
  const filtered = Boolean(walletRoles?.length);
  const directRole = filtered ? { role: { in: walletRoles } } : {};
  const groupRole = filtered ? { groupRole: { in: walletRoles } } : {};

  return {
    OR: [
      { wallets: { some: { walletId, ...directRole } } },
      {
        // In a filtered audience, any direct grant masks the group role.
        // The unfiltered audience already includes that user through the direct branch.
        ...(filtered ? { wallets: { none: { walletId } } } : {}),
        groupMemberships: {
          some: { group: { wallets: { some: { id: walletId, ...groupRole } } } },
        },
      },
    ],
  };
}
