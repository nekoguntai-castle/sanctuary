import { vi, Mock } from 'vitest';
/**
 * Draft Create Atomicity Tests
 *
 * Focused coverage for approval-required draft creation: atomic same-client
 * persistence (draft + UTXO locks + approvals in one transaction), pending-at-
 * birth status, post-commit side-effect ordering, error propagation/rollback
 * with retry isolation, external-client deferral, and non-required passthrough.
 */

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const txTracker = vi.hoisted(() => {
  const clients: Array<Record<string, unknown>> = [];
  let nextId = 0;
  const withTransaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = { __txId: ++nextId };
    clients.push(tx);
    return fn(tx);
  };
  return { withTransaction, clients };
});

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    create: vi.fn(),
    remove: vi.fn(),
    withTransaction: txTracker.withTransaction,
  },
  systemSettingRepository: {
    getParsed: vi.fn(),
  },
  walletRepository: {
    findByIdWithSigningDevices: vi.fn(),
  },
}));

vi.mock('../../../src/services/draftLockService', () => ({
  lockUtxosForDraft: vi.fn(),
  resolveUtxoIds: vi.fn(),
}));

vi.mock('../../../src/services/notifications/dispatch', () => ({
  dispatchDraftNotification: vi.fn(),
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: {
    createApprovalRequestsForDraft: vi.fn().mockResolvedValue([]),
    dispatchApprovalRequestedNotification: vi.fn(),
  },
}));

vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  loadSigningIntent: vi.fn().mockResolvedValue({
    unsignedPsbtSha256: 'psbt-hash',
    signingContext: { version: 1 },
  }),
  unsignedPsbtSha256: vi.fn().mockReturnValue('psbt-hash'),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => loggerMocks,
}));

vi.mock('../../../src/constants', () => ({
  DEFAULT_DRAFT_EXPIRATION_DAYS: 7,
}));

import { draftRepository, systemSettingRepository } from '../../../src/repositories';
import { lockUtxosForDraft, resolveUtxoIds } from '../../../src/services/draftLockService';
import { dispatchDraftNotification } from '../../../src/services/notifications/dispatch';
import { approvalService } from '../../../src/services/vaultPolicy/approvalService';
import { loadSigningIntent } from '../../../src/services/bitcoin/signingIntent';
import {
  createDraft,
  runDraftCreatedSideEffects,
  dispatchDraftCreatedPostCommitNotifications,
} from '../../../src/services/draftCreate';

describe('createDraft approval atomicity', () => {
  const walletId = 'wallet-456';
  const userId = 'user-123';

  const mockDraft = {
    id: 'draft-789',
    walletId,
    userId,
    recipient: 'tb1qtest...',
    amount: BigInt(100000),
    feeRate: 5,
    status: 'unsigned',
    signedDeviceIds: [],
    label: null,
  };

  const approvalInput = {
    recipient: 'tb1qtest...',
    amount: 100000,
    feeRate: 5,
    psbtBase64: 'cHNidP8...',
    intentId: 'intent-1',
    intentDigest: 'a'.repeat(64),
    selectedUtxoIds: ['utxo-1'],
  };

  const approvalEvaluation = {
    allowed: true,
    triggered: [
      { policyId: 'p1', policyName: 'Limit', type: 'spending_limit' as const, action: 'approval_required' as const, reason: 'Exceeded' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    txTracker.clients.length = 0;
    (draftRepository.create as Mock).mockResolvedValue(mockDraft);
    (resolveUtxoIds as Mock).mockResolvedValue({ found: ['utxo-id-1'], notFound: [] });
    (lockUtxosForDraft as Mock).mockResolvedValue({ success: true, lockedCount: 1 });
    (systemSettingRepository.getParsed as Mock).mockResolvedValue(7);
    (dispatchDraftNotification as Mock).mockResolvedValue(undefined);
  });

  it('persists pending draft, locks UTXOs, and creates approvals once in one transaction on the same client', async () => {
    const result = await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation });

    expect(txTracker.clients).toHaveLength(1);
    const tx = txTracker.clients[0];

    expect(draftRepository.create).toHaveBeenCalledTimes(1);
    expect(draftRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: 'pending' }),
      tx
    );
    expect(resolveUtxoIds).toHaveBeenCalledWith(walletId, approvalInput.selectedUtxoIds, tx);
    expect(lockUtxosForDraft).toHaveBeenCalledWith(mockDraft.id, ['utxo-id-1'], { isRBF: false, client: tx });
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(1);
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
      mockDraft.id,
      walletId,
      userId,
      approvalEvaluation.triggered,
      tx,
      true
    );
    expect(result).toEqual(mockDraft);
  });

  it('dispatches the approval notification before the draft-created notification after commit', async () => {
    await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation });

    expect(approvalService.dispatchApprovalRequestedNotification).toHaveBeenCalledTimes(1);
    expect(approvalService.dispatchApprovalRequestedNotification).toHaveBeenCalledWith(walletId, mockDraft.id, userId);
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
    // Approval setup ran exactly once (inside the transaction); post-commit only dispatches.
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(1);

    const approvalDispatchOrder = (approvalService.dispatchApprovalRequestedNotification as Mock).mock.invocationCallOrder[0];
    const draftNotifyOrder = (dispatchDraftNotification as Mock).mock.invocationCallOrder[0];
    expect(approvalDispatchOrder).toBeLessThan(draftNotifyOrder);
  });

  it('propagates approval setup errors, skips post-commit dispatch, and retries in a fresh transaction', async () => {
    (approvalService.createApprovalRequestsForDraft as Mock).mockRejectedValueOnce(new Error('approval service down'));

    await expect(createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }))
      .rejects.toThrow('approval service down');

    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).not.toHaveBeenCalled();

    // A retry after rollback starts a fresh, isolated transaction.
    (approvalService.createApprovalRequestsForDraft as Mock).mockResolvedValue([]);
    await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation });

    expect(txTracker.clients).toHaveLength(2);
    expect(txTracker.clients[0]).not.toBe(txTracker.clients[1]);
  });

  it('persists pending through the exact external client with runSideEffects:false and defers notifications', async () => {
    const client = { draftTransaction: {}, draftUtxoLock: {}, uTXO: {}, vaultPolicy: {}, approvalRequest: {} };

    const result = await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }, {
      client: client as never,
      runSideEffects: false,
    });

    expect(txTracker.clients).toHaveLength(0);
    expect(resolveUtxoIds).toHaveBeenCalledWith(walletId, approvalInput.selectedUtxoIds, client);
    expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'pending' }), client);
    expect(lockUtxosForDraft).toHaveBeenCalledWith(mockDraft.id, ['utxo-id-1'], { isRBF: false, client });
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(1);
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
      mockDraft.id,
      walletId,
      userId,
      approvalEvaluation.triggered,
      client,
      true
    );
    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).not.toHaveBeenCalled();
    expect(result).toEqual(mockDraft);
  });

  it('rejects an external client with omitted runSideEffects before load, persistence, locks, approvals, or notifications', async () => {
    const client = { draftTransaction: {}, draftUtxoLock: {}, uTXO: {}, vaultPolicy: {}, approvalRequest: {} };

    await expect(
      createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }, {
        client: client as never,
      })
    ).rejects.toThrow();

    expect(loadSigningIntent).not.toHaveBeenCalled();
    expect(draftRepository.create).not.toHaveBeenCalled();
    expect(resolveUtxoIds).not.toHaveBeenCalled();
    expect(lockUtxosForDraft).not.toHaveBeenCalled();
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).not.toHaveBeenCalled();
  });

  it('rejects an external client with runSideEffects:true before load, persistence, locks, approvals, or notifications', async () => {
    const client = { draftTransaction: {}, draftUtxoLock: {}, uTXO: {}, vaultPolicy: {}, approvalRequest: {} };

    await expect(
      createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }, {
        client: client as never,
        runSideEffects: true,
      })
    ).rejects.toThrow();

    expect(loadSigningIntent).not.toHaveBeenCalled();
    expect(draftRepository.create).not.toHaveBeenCalled();
    expect(resolveUtxoIds).not.toHaveBeenCalled();
    expect(lockUtxosForDraft).not.toHaveBeenCalled();
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).not.toHaveBeenCalled();
  });

  it('propagates external approval failures without dispatching notifications', async () => {
    const client = { draftTransaction: {}, draftUtxoLock: {}, uTXO: {}, vaultPolicy: {}, approvalRequest: {} };
    (approvalService.createApprovalRequestsForDraft as Mock).mockRejectedValueOnce(new Error('external approval down'));

    await expect(
      createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }, {
        client: client as never,
        runSideEffects: false,
      })
    ).rejects.toThrow('external approval down');

    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).not.toHaveBeenCalled();
  });

  it('runDraftCreatedSideEffects creates approvals through the provided client after commit', async () => {
    const client = { vaultPolicy: {}, approvalRequest: {} };

    await runDraftCreatedSideEffects(
      walletId,
      userId,
      mockDraft as never,
      { ...approvalInput, policyEvaluation: approvalEvaluation },
      client as never
    );

    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
      mockDraft.id,
      walletId,
      userId,
      approvalEvaluation.triggered,
      client,
      false
    );
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
  });

  it('dispatchDraftCreatedPostCommitNotifications dispatches approval before draft exactly once without persisting approvals', async () => {
    await dispatchDraftCreatedPostCommitNotifications(
      walletId,
      userId,
      mockDraft as never,
      { ...approvalInput, policyEvaluation: approvalEvaluation }
    );

    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(approvalService.dispatchApprovalRequestedNotification).toHaveBeenCalledTimes(1);
    expect(approvalService.dispatchApprovalRequestedNotification).toHaveBeenCalledWith(walletId, mockDraft.id, userId);
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);

    const approvalDispatchOrder = (approvalService.dispatchApprovalRequestedNotification as Mock).mock.invocationCallOrder[0];
    const draftNotifyOrder = (dispatchDraftNotification as Mock).mock.invocationCallOrder[0];
    expect(approvalDispatchOrder).toBeLessThan(draftNotifyOrder);
  });

  it('dispatchDraftCreatedPostCommitNotifications dispatches only the draft notification when approval is not required', async () => {
    await dispatchDraftCreatedPostCommitNotifications(walletId, userId, mockDraft as never, approvalInput);

    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(approvalService.dispatchApprovalRequestedNotification).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps the default not_required flow for non-required, null, and empty evaluations', async () => {
    // No policyEvaluation at all.
    await createDraft(walletId, userId, approvalInput);

    expect(txTracker.clients).toHaveLength(0);
    expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: undefined }));
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);

    // Empty triggered array.
    await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: { allowed: true, triggered: [] } });

    expect(txTracker.clients).toHaveLength(0);
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();

    // Non-approval triggers only.
    await createDraft(walletId, userId, {
      ...approvalInput,
      policyEvaluation: {
        allowed: true,
        triggered: [
          { policyId: 'p2', policyName: 'Alert', type: 'spending_limit' as const, action: 'monitored' as const, reason: 'watch' },
        ],
      },
    });

    expect(txTracker.clients).toHaveLength(0);
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
  });

  it('isolates concurrent approval-required creations in separate transactions', async () => {
    await Promise.all([
      createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }),
      createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }),
    ]);

    expect(txTracker.clients).toHaveLength(2);
    expect(txTracker.clients[0]).not.toBe(txTracker.clients[1]);

    expect(draftRepository.create).toHaveBeenCalledTimes(2);
    expect(draftRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ approvalStatus: 'pending' }),
      txTracker.clients[0]
    );
    expect(draftRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ approvalStatus: 'pending' }),
      txTracker.clients[1]
    );
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(2);
  });
});
