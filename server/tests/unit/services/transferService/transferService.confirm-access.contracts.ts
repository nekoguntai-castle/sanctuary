import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { deviceId, mockAuditLog, ownerId, recipientId, transferId, walletId } from './transferServiceTestHarness';
import { confirmTransfer } from '../../../../src/services/transferService';

type ResourceType = 'wallet' | 'device';

interface AccessFixture {
  resourceType: ResourceType;
  keepExistingUsers: boolean;
  /** Rows the confirm should find for users other than the new owner. */
  otherMembers: Array<{ id: string; userId: string }>;
  groupId: string | null;
  /** Whether the final transfer fetch carries the initiator relation. */
  withFromUser?: boolean;
}

function buildAccessTx(fixture: AccessFixture) {
  const prefix = fixture.resourceType === 'wallet' ? 'wu' : 'du';
  const memberDelegate = {
    findFirst: vi.fn()
      .mockResolvedValueOnce({ id: `${prefix}-owner`, userId: ownerId, role: 'owner' })
      .mockResolvedValueOnce(null),
    findMany: vi.fn().mockResolvedValue(fixture.otherMembers),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: fixture.otherMembers.length }),
  };
  const resourceDelegate = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ groupId: fixture.groupId }),
    update: vi.fn().mockResolvedValue({}),
  };
  return { memberDelegate, resourceDelegate };
}

function arrangeAccessConfirm(fixture: AccessFixture) {
  const baseTransfer = {
    id: transferId,
    resourceType: fixture.resourceType,
    resourceId: fixture.resourceType === 'wallet' ? walletId : deviceId,
    fromUserId: ownerId,
    toUserId: recipientId,
    status: 'accepted',
    keepExistingUsers: fixture.keepExistingUsers,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  };
  const relations = fixture.withFromUser === false
    ? { fromUser: null, toUser: { id: recipientId, username: 'recipient' } }
    : { fromUser: { id: ownerId, username: 'owner' }, toUser: { id: recipientId, username: 'recipient' } };
  mockPrismaClient.ownershipTransfer.findUnique
    .mockResolvedValueOnce(baseTransfer)
    .mockResolvedValueOnce({ ...baseTransfer, status: 'confirmed', ...relations });

  const { memberDelegate, resourceDelegate } = buildAccessTx(fixture);
  mockPrismaClient.$transaction.mockImplementation(async (callback) => {
    const txMock = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      ownershipTransfer: {
        findUnique: vi.fn().mockResolvedValue(baseTransfer),
        update: vi.fn().mockResolvedValue({}),
      },
      [fixture.resourceType === 'wallet' ? 'walletUser' : 'deviceUser']: memberDelegate,
      [fixture.resourceType]: resourceDelegate,
    };
    return callback(txMock as any);
  });
  return { memberDelegate, resourceDelegate };
}

function expectAccessRevoked(
  spies: ReturnType<typeof arrangeAccessConfirm>,
  fixture: AccessFixture,
) {
  const resourceKey = fixture.resourceType === 'wallet' ? 'walletId' : 'deviceId';
  const resourceId = fixture.resourceType === 'wallet' ? walletId : deviceId;
  expect(spies.memberDelegate.findMany).toHaveBeenCalledWith({
    where: { [resourceKey]: resourceId, userId: { not: recipientId } },
    select: { id: true, userId: true },
  });
  if (fixture.otherMembers.length > 0) {
    expect(spies.memberDelegate.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: fixture.otherMembers.map(member => member.id) } },
    });
  } else {
    expect(spies.memberDelegate.deleteMany).not.toHaveBeenCalled();
  }
  expect(spies.memberDelegate.delete).not.toHaveBeenCalled();
  const groupClear = {
    where: { id: resourceId },
    data: { groupId: null, groupRole: 'viewer' },
  };
  if (fixture.groupId) {
    expect(spies.resourceDelegate.update).toHaveBeenCalledWith(groupClear);
  } else {
    expect(spies.resourceDelegate.update).not.toHaveBeenCalledWith(groupClear);
  }
}

function expectUnshareAudit(fixture: AccessFixture, username: string) {
  expect(mockAuditLog).toHaveBeenCalledTimes(1);
  expect(mockAuditLog).toHaveBeenCalledWith({
    userId: ownerId,
    username,
    action: fixture.resourceType === 'wallet' ? 'wallet.unshare' : 'device.unshare',
    category: fixture.resourceType,
    details: {
      reason: 'ownership_transfer',
      transferId,
      removedUserIds: fixture.otherMembers.map(member => member.userId),
      removedGroupId: fixture.groupId,
    },
  });
}

function expectAccessKept(spies: ReturnType<typeof arrangeAccessConfirm>, prefix: string) {
  expect(spies.memberDelegate.findMany).not.toHaveBeenCalled();
  expect(spies.memberDelegate.deleteMany).not.toHaveBeenCalled();
  expect(spies.memberDelegate.delete).not.toHaveBeenCalled();
  expect(spies.memberDelegate.update).toHaveBeenCalledWith({
    where: { id: `${prefix}-owner` },
    data: { role: 'viewer' },
  });
  expect(spies.resourceDelegate.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: { groupId: null, groupRole: 'viewer' } }),
  );
  expect(mockAuditLog).not.toHaveBeenCalled();
}

const sharedWalletMembers = [
  { id: 'wu-owner', userId: ownerId },
  { id: 'wu-signer', userId: 'signer-1' },
];
const sharedDeviceMembers = [
  { id: 'du-owner', userId: ownerId },
  { id: 'du-viewer', userId: 'viewer-1' },
];

export const registerTransferConfirmAccessContracts = () => {
  describe('confirmTransfer keepExistingUsers', () => {
    it('removes wallet members without touching a missing group grant', async () => {
      const fixture: AccessFixture = {
        resourceType: 'wallet', keepExistingUsers: false, otherMembers: sharedWalletMembers, groupId: null,
      };
      const spies = arrangeAccessConfirm(fixture);

      await confirmTransfer(ownerId, transferId);

      expectAccessRevoked(spies, fixture);
      expect(spies.resourceDelegate.update).not.toHaveBeenCalled();
      expectUnshareAudit(fixture, 'owner');
    });

    it('removes device members without a group grant and audits without an initiator relation', async () => {
      const fixture: AccessFixture = {
        resourceType: 'device',
        keepExistingUsers: false,
        otherMembers: sharedDeviceMembers,
        groupId: null,
        withFromUser: false,
      };
      const spies = arrangeAccessConfirm(fixture);

      await confirmTransfer(ownerId, transferId);

      expectAccessRevoked(spies, fixture);
      expect(spies.resourceDelegate.update).toHaveBeenCalledTimes(1);
      expectUnshareAudit(fixture, 'unknown');
    });

    it.each(['wallet', 'device'] as const)('skips the %s member delete when only the group grant needs clearing', async (resourceType) => {
      const fixture: AccessFixture = {
        resourceType, keepExistingUsers: false, otherMembers: [], groupId: 'g1',
      };
      const spies = arrangeAccessConfirm(fixture);

      await confirmTransfer(ownerId, transferId);

      expectAccessRevoked(spies, fixture);
      expectUnshareAudit(fixture, 'owner');
    });

    it('keeps wallet members and the group grant when true', async () => {
      const spies = arrangeAccessConfirm({
        resourceType: 'wallet', keepExistingUsers: true, otherMembers: sharedWalletMembers, groupId: 'g1',
      });

      await confirmTransfer(ownerId, transferId);

      expectAccessKept(spies, 'wu');
    });

    it('keeps device members and the group grant when true', async () => {
      const spies = arrangeAccessConfirm({
        resourceType: 'device', keepExistingUsers: true, otherMembers: sharedDeviceMembers, groupId: 'g1',
      });

      await confirmTransfer(ownerId, transferId);

      expectAccessKept(spies, 'du');
    });
  });
};
