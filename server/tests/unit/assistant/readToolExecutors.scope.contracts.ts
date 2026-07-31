import { expect, it, type Mock } from 'vitest';
import {
  assistantReadToolRegistry,
  type AssistantToolContext,
} from '../../../src/assistant/tools';

interface ScopeTestDependencies {
  mocks: {
    walletSharingRepository: {
      findWalletIdsByUserRole: Mock;
    };
    approvalService: {
      getPendingApprovalsForUser: Mock;
    };
    deviceAccess: {
      getUserAccessibleDevices: Mock;
    };
  };
  createContext: () => AssistantToolContext;
  walletId: string;
  secondWalletId: string;
}

export function registerReadToolScopeTests({
  mocks,
  createContext,
  walletId,
  secondWalletId,
}: ScopeTestDependencies): void {
  const thirdWalletId = '33333333-3333-4333-8333-333333333333';

  it('intersects pending approvals with subset and empty wallet scopes before counting', async () => {
    const scopedContext = {
      ...createContext(),
      walletScopeIds: [secondWalletId, thirdWalletId],
    };
    const emptyContext = {
      ...createContext(),
      walletScopeIds: [],
    };
    const nullContext = {
      ...createContext(),
      walletScopeIds: null,
    } as unknown as AssistantToolContext;
    mocks.walletSharingRepository.findWalletIdsByUserRole
      .mockResolvedValueOnce([walletId, secondWalletId, secondWalletId, thirdWalletId])
      .mockResolvedValueOnce([walletId, secondWalletId, thirdWalletId])
      .mockResolvedValueOnce([walletId, secondWalletId, thirdWalletId]);
    const pendingApprovals = [
      {
        id: 'approval-in-scope',
        draftTransactionId: 'draft-in-scope',
        status: 'pending',
        requiredApprovals: 1,
        expiresAt: null,
        createdAt: new Date('2026-04-26T11:00:00.000Z'),
        votes: [],
        draftTransaction: {
          walletId: secondWalletId,
          amount: 100n,
        },
      },
      {
        id: 'approval-out-of-scope',
        draftTransactionId: 'draft-out-of-scope',
        status: 'pending',
        requiredApprovals: 1,
        expiresAt: null,
        createdAt: new Date('2026-04-26T11:00:00.000Z'),
        votes: [],
        draftTransaction: {
          walletId,
          amount: 200n,
        },
      },
    ];
    mocks.approvalService.getPendingApprovalsForUser
      .mockResolvedValueOnce(pendingApprovals)
      .mockResolvedValueOnce(pendingApprovals);

    const scoped = await assistantReadToolRegistry.execute(
      'get_pending_approvals',
      {},
      scopedContext
    );
    const empty = await assistantReadToolRegistry.execute(
      'get_pending_approvals',
      {},
      emptyContext
    );
    const unrestricted = await assistantReadToolRegistry.execute(
      'get_pending_approvals',
      {},
      nullContext
    );

    expect(mocks.approvalService.getPendingApprovalsForUser).toHaveBeenCalledTimes(2);
    expect(mocks.approvalService.getPendingApprovalsForUser).toHaveBeenNthCalledWith(
      1,
      [secondWalletId, thirdWalletId]
    );
    expect(mocks.approvalService.getPendingApprovalsForUser).toHaveBeenNthCalledWith(
      2,
      [walletId, secondWalletId, thirdWalletId]
    );
    expect(scoped.data).toMatchObject({
      total: 1,
      approvals: [{ id: 'approval-in-scope', walletId: secondWalletId }],
    });
    expect(scoped.facts.items).toEqual(expect.arrayContaining([
      { label: 'pending_approval_count', value: 1 },
      { label: 'approve_wallet_count', value: 2 },
    ]));
    expect(scoped.audit).toMatchObject({ walletCount: 2, rowCount: 1 });
    expect(empty.data).toEqual({ approvals: [], total: 0 });
    expect(empty.audit).toMatchObject({ walletCount: 0, rowCount: 0 });
    expect(unrestricted.data).toMatchObject({ total: 2 });
    expect(unrestricted.audit).toMatchObject({ walletCount: 3, rowCount: 2 });
  });

  it('intersects device results and wallet counts with subset and empty wallet scopes', async () => {
    const baseDevice = {
      userId: 'owner-1',
      modelId: null,
      type: 'coldcard',
      fingerprint: 'secret',
      derivationPath: null,
      xpub: 'secret-xpub',
      groupId: null,
      groupRole: 'viewer',
      createdAt: new Date('2026-04-25T00:00:00.000Z'),
      updatedAt: new Date('2026-04-26T00:00:00.000Z'),
      isOwner: false,
      userRole: 'viewer',
      model: null,
      accounts: [],
    };
    const devices = [
      {
        ...baseDevice,
        id: 'device-subset',
        label: 'Subset signer',
        walletCount: 2,
        wallets: [
          { wallet: { id: walletId } },
          { wallet: { id: secondWalletId } },
        ],
      },
      {
        ...baseDevice,
        id: 'device-outside',
        label: 'Outside signer',
        walletCount: 1,
        wallets: [{ wallet: { id: walletId } }],
      },
      {
        ...baseDevice,
        id: 'device-third',
        label: 'Third signer',
        walletCount: 1,
        wallets: [{ wallet: { id: thirdWalletId } }],
      },
    ];
    mocks.deviceAccess.getUserAccessibleDevices
      .mockResolvedValueOnce(devices)
      .mockResolvedValueOnce(devices)
      .mockResolvedValueOnce(devices);

    const subset = await assistantReadToolRegistry.execute(
      'list_devices',
      {},
      { ...createContext(), walletScopeIds: [secondWalletId, thirdWalletId] }
    );
    const empty = await assistantReadToolRegistry.execute(
      'list_devices',
      {},
      { ...createContext(), walletScopeIds: [] }
    );
    const unrestricted = await assistantReadToolRegistry.execute(
      'list_devices',
      {},
      {
        ...createContext(),
        walletScopeIds: null,
      } as unknown as AssistantToolContext
    );

    expect(subset.data).toMatchObject({
      count: 2,
      devices: [
        { id: 'device-subset', walletCount: 1 },
        { id: 'device-third', walletCount: 1 },
      ],
    });
    expect(subset.audit).toMatchObject({ walletCount: 2, rowCount: 2 });
    expect(subset.facts.items).toContainEqual({ label: 'device_count', value: 2 });
    expect(JSON.stringify(subset.data)).not.toContain(walletId);
    expect(empty.data).toEqual({ count: 0, devices: [] });
    expect(empty.audit).toMatchObject({ walletCount: 0, rowCount: 0 });
    expect(unrestricted.data).toMatchObject({ count: 3 });
    expect(unrestricted.audit).toMatchObject({ walletCount: 3, rowCount: 3 });
  });
}
