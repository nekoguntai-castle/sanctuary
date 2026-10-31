/**
 * Non-regression: creating a user's first mobile permission row must not
 * revoke capabilities their role grants.
 *
 * The service runs against the real mobilePermissionRepository; only Prisma is
 * faked, and the fake applies the schema column defaults on create the way the
 * database does (canApproveTransaction/canManagePolicies default to false).
 */

import { vi, Mock } from 'vitest';

// Mirrors the MobilePermission column defaults in server/prisma/schema.prisma:1556-1576;
// keep in sync if those defaults change.
const SCHEMA_CREATE_DEFAULTS = {
  canViewBalance: true,
  canViewTransactions: true,
  canViewUtxos: true,
  canCreateTransaction: true,
  canBroadcast: true,
  canSignPsbt: true,
  canGenerateAddress: true,
  canManageLabels: true,
  canManageDevices: true,
  canShareWallet: true,
  canDeleteWallet: true,
  canApproveTransaction: false,
  canManagePolicies: false,
  ownerMaxPermissions: null,
  lastModifiedBy: null,
};

const rows = new Map<string, Record<string, unknown>>();
type CompositeWhere = { where: { walletId_userId: { walletId: string; userId: string } } };
const keyOf = ({ where }: CompositeWhere) =>
  `${where.walletId_userId.walletId}:${where.walletId_userId.userId}`;

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    mobilePermission: {
      findUnique: vi.fn(async (args: CompositeWhere) => rows.get(keyOf(args)) ?? null),
      upsert: vi.fn(async (args: CompositeWhere & {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = keyOf(args);
        const existing = rows.get(key);
        const row = existing
          ? { ...existing, ...args.update }
          : { id: `perm-${rows.size + 1}`, ...SCHEMA_CREATE_DEFAULTS, ...args.create };
        rows.set(key, row);
        return row;
      }),
    },
  },
}));

vi.mock('../../../../src/services/accessControl', () => ({
  getUserWalletRoleUncached: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getUserWalletRoleUncached } from '../../../../src/services/accessControl';
import { mobilePermissionService } from '../../../../src/services/mobilePermissions';

describe('mobile permission row creation keeps role capabilities', () => {
  const walletId = 'wallet-1';
  const ownerId = 'owner-1';
  const approverId = 'approver-1';

  beforeEach(() => {
    rows.clear();
    (getUserWalletRoleUncached as Mock).mockImplementation(async (_wallet: string, user: string) =>
      user === ownerId ? 'owner' : 'approver'
    );
  });

  it('owner caps on an approver without a row keep approveTransaction at the role maximum', async () => {
    const before = await mobilePermissionService.getEffectivePermissions(walletId, approverId);
    expect(before.permissions.approveTransaction).toBe(true);

    const after = await mobilePermissionService.setMaxPermissions(
      walletId, approverId, ownerId, { broadcast: false }
    );

    expect(after.permissions.approveTransaction).toBe(before.permissions.approveTransaction);
    expect(await mobilePermissionService.canPerformAction(walletId, approverId, 'approveTransaction'))
      .toBe(true);

    // An owner cap alone is not a restriction the user set (hasSelfRestrictions).
    const reread = await mobilePermissionService.getEffectivePermissions(walletId, approverId);
    expect(reread.hasOwnerRestrictions).toBe(true);
    expect(reread.hasCustomRestrictions).toBe(false);
  });

  it('an approver restricting an unrelated action keeps approveTransaction', async () => {
    const after = await mobilePermissionService.updateOwnPermissions(
      walletId, approverId, { viewUtxos: false }
    );

    expect(after.permissions.viewUtxos).toBe(false);
    expect(after.permissions.approveTransaction).toBe(true);
  });

  it('an owner restricting an unrelated action keeps managePolicies and approveTransaction', async () => {
    const after = await mobilePermissionService.updateOwnPermissions(
      walletId, ownerId, { broadcast: false }
    );

    expect(after.permissions.broadcast).toBe(false);
    expect(after.permissions.approveTransaction).toBe(true);
    expect(after.permissions.managePolicies).toBe(true);
  });
});
