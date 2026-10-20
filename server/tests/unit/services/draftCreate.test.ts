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
  transactionSigningIntentRepository: {
    lockDraftableIntent: vi.fn().mockResolvedValue(true),
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

const intentSnapshot = vi.hoisted(() => ({
  version: 2,
  walletId: 'wallet-456',
  network: 'testnet4',
  transaction: { version: 2, locktime: 0, inputs: [], outputs: [] },
}));

vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  loadSigningIntent: vi.fn().mockResolvedValue({
    unsignedPsbtSha256: 'psbt-hash',
    signingContext: { version: 1 },
    snapshot: intentSnapshot,
  }),
  unsignedPsbtSha256: vi.fn().mockReturnValue('psbt-hash'),
  deriveIntentSpend: vi.fn(),
  hasPayjoinReplacement: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/services/vaultPolicy/policyEvaluationEngine', () => ({
  policyEvaluationEngine: { evaluatePolicies: vi.fn() },
}));

vi.mock('../../../src/services/bitcoin/transactions/replacementLink', () => ({
  findVerifiedReplacement: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => loggerMocks,
}));

vi.mock('../../../src/constants', () => ({
  DEFAULT_DRAFT_EXPIRATION_DAYS: 7,
}));

import { draftRepository, systemSettingRepository, transactionSigningIntentRepository } from '../../../src/repositories';
import { lockUtxosForDraft, resolveUtxoIds } from '../../../src/services/draftLockService';
import { dispatchDraftNotification } from '../../../src/services/notifications/dispatch';
import { approvalService } from '../../../src/services/vaultPolicy/approvalService';
import {
  deriveIntentSpend,
  hasPayjoinReplacement,
  loadSigningIntent,
  unsignedPsbtSha256,
} from '../../../src/services/bitcoin/signingIntent';
import { policyEvaluationEngine } from '../../../src/services/vaultPolicy/policyEvaluationEngine';
import { findVerifiedReplacement } from '../../../src/services/bitcoin/transactions/replacementLink';
import { ForbiddenError } from '../../../src/errors';
import {
  createDraft,
  runDraftCreatedSideEffects,
  dispatchDraftCreatedPostCommitNotifications,
} from '../../../src/services/draftCreate';

// A spend whose canonical fee is 1000: one 120000 input, the 100000 external
// payment and a 19000 change output.
const externalSpend = (overrides: Record<string, unknown> = {}) => ({
  inputs: [{ txid: 'a'.repeat(64), vout: 1, address: 'tb1qwallet', amount: 120000 }],
  outputs: [
    { address: 'tb1qexternal', amount: 100000 },
    { address: 'tb1qchange', amount: 19000 },
  ],
  externalOutputs: [{ address: 'tb1qexternal', amount: 100000 }],
  amount: 100000,
  ...overrides,
});

// Draft metadata that matches externalSpend() exactly.
const boundDraftInput = {
  recipient: 'tb1qexternal',
  amount: 100000,
  effectiveAmount: 100000,
  fee: 1000,
  feeRate: 5,
  psbtBase64: 'cHNidP8...',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  selectedUtxoIds: ['a'.repeat(64) + ':1'],
};

// The placeholder approval dispatch was removed; the mock key pins its absence.
const removedApprovalDispatch = (approvalService as unknown as Record<string, Mock>).dispatchApprovalRequestedNotification;

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

  const approvalInput = boundDraftInput;

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
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend());
    (policyEvaluationEngine.evaluatePolicies as Mock).mockResolvedValue({ allowed: true, triggered: [] });
    (findVerifiedReplacement as Mock).mockResolvedValue(null);
  });

  const enforcedApproval = {
    allowed: true,
    triggered: [
      { policyId: 'pa', policyName: 'Approve', type: 'approval_required' as const, action: 'approval_required' as const, reason: 'always' },
    ],
  };

  describe('server-side policy evaluation when the caller supplies none', () => {
    it('creates an approval-required human draft as pending with its approval requests', async () => {
      (policyEvaluationEngine.evaluatePolicies as Mock).mockResolvedValueOnce(enforcedApproval);

      await createDraft(walletId, userId, approvalInput);

      expect(policyEvaluationEngine.evaluatePolicies).toHaveBeenCalledWith({
        walletId, userId, recipient: 'tb1qexternal', amount: BigInt(100000),
        outputs: [{ address: 'tb1qexternal', amount: 100000 }],
      });
      expect(draftRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ approvalStatus: 'pending' }),
        txTracker.clients[0],
      );
      expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledOnce();
      expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
        mockDraft.id, walletId, userId, enforcedApproval.triggered, txTracker.clients[0],
      );
    });

    it('evaluates a verified RBF replacement as a bump on the full amount', async () => {
      const replacementTxid = 'c'.repeat(64);
      (deriveIntentSpend as Mock).mockResolvedValueOnce(externalSpend({ replacementTxid }));
      (findVerifiedReplacement as Mock).mockResolvedValueOnce({ id: 'orig', label: null, amount: BigInt(90000) });

      await createDraft(walletId, userId, { ...approvalInput, isRBF: true });

      expect(findVerifiedReplacement).toHaveBeenCalledWith(
        walletId, replacementTxid, [expect.objectContaining({ txid: 'a'.repeat(64), vout: 1 })], undefined,
      );
      expect(policyEvaluationEngine.evaluatePolicies).toHaveBeenCalledWith(expect.objectContaining({
        amount: BigInt(100000), replacedAmount: BigInt(90000), isReplacementBump: true,
      }));
    });

    it('refuses a draft that an enforce-mode policy blocks', async () => {
      (policyEvaluationEngine.evaluatePolicies as Mock).mockResolvedValueOnce({ allowed: false, triggered: [] });

      await expect(createDraft(walletId, userId, approvalInput)).rejects.toBeInstanceOf(ForbiddenError);
      expect(draftRepository.create).not.toHaveBeenCalled();
    });

    it('skips evaluation when the intent pays nothing outside the wallet', async () => {
      (deriveIntentSpend as Mock).mockResolvedValueOnce(externalSpend({ externalOutputs: [], amount: 0 }));

      await createDraft(walletId, userId, approvalInput);

      expect(policyEvaluationEngine.evaluatePolicies).not.toHaveBeenCalled();
      expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: undefined }), expect.anything());
    });

    it('does not re-evaluate when the caller already supplies an evaluation', async () => {
      await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: { allowed: true, triggered: [] } });

      // The spend is still derived once, to bind the draft metadata to the intent.
      expect(deriveIntentSpend).toHaveBeenCalledOnce();
      expect(policyEvaluationEngine.evaluatePolicies).not.toHaveBeenCalled();
    });
  });

  it('persists pending draft, locks UTXOs, and creates approvals once in one transaction on the same client', async () => {
    const result = await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation });

    expect(txTracker.clients).toHaveLength(1);
    const tx = txTracker.clients[0];

    // A new draft needs an unexpired intent: no live-draft extension (A4).
    expect(loadSigningIntent).toHaveBeenCalledWith(
      { intentId: 'intent-1', intentDigest: 'a'.repeat(64) },
      walletId,
    );
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
      tx
    );
    expect(result).toEqual(mockDraft);
  });

  it('succeeds without creating an approval request when only a monitor-mode time_delay policy triggers', async () => {
    // Monitor-mode time_delay is informational only (action 'monitored') and
    // never 'approval_required', so requiresApproval must stay false and no
    // approval request should be created — the same misrouting that produced
    // the Prisma non-nullable-requiredApprovals failure in the real
    // approvalService if 'approval_required' were ever mistakenly emitted.
    const timeDelayEvaluation = {
      allowed: true,
      triggered: [
        {
          policyId: 'p-delay',
          policyName: 'Cooling Period',
          type: 'time_delay' as const,
          action: 'monitored' as const,
          reason: 'time-delay enforcement is not available; switch this policy to monitor mode or disable it',
        },
      ],
    };

    const result = await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: timeDelayEvaluation });

    expect(result).toEqual(mockDraft);
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    const createArgs = (draftRepository.create as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(createArgs.approvalStatus).toBeUndefined();
  });

  it('does not create an approval request for a blocked (fail-closed) enforce-mode time_delay trigger', async () => {
    // An enforce-mode time_delay policy is refused before createDraft is ever
    // reached (the route checks policyResult.allowed and throws), but this
    // guards the draft-creation contract in isolation: even if a 'blocked'
    // trigger somehow reached createDraft, it must never be treated as
    // 'approval_required'.
    const blockedEvaluation = {
      allowed: false,
      triggered: [
        {
          policyId: 'p-delay',
          policyName: 'Cooling Period',
          type: 'time_delay' as const,
          action: 'blocked' as const,
          reason: 'time-delay enforcement is not available; switch this policy to monitor mode or disable it',
        },
      ],
    };

    const result = await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: blockedEvaluation });

    expect(result).toEqual(mockDraft);
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    const createArgs = (draftRepository.create as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(createArgs.approvalStatus).toBeUndefined();
  });

  it('dispatches a single real draft notification marked approval-required after commit', async () => {
    (draftRepository.create as Mock).mockResolvedValue({ ...mockDraft, approvalStatus: 'pending' });

    await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation });

    expect(removedApprovalDispatch).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
    expect(dispatchDraftNotification).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({ amount: mockDraft.amount, recipient: mockDraft.recipient, approvalRequired: true }),
      userId,
      undefined
    );
    // Approval setup ran exactly once (inside the transaction); post-commit only dispatches.
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(1);
  });

  it('marks the draft notification approvalRequired:false when approval is not required', async () => {
    await createDraft(walletId, userId, approvalInput);

    expect(dispatchDraftNotification).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({ approvalRequired: false }),
      userId,
      undefined
    );
  });

  it('propagates approval setup errors, skips post-commit dispatch, and retries in a fresh transaction', async () => {
    (approvalService.createApprovalRequestsForDraft as Mock).mockRejectedValueOnce(new Error('approval service down'));

    await expect(createDraft(walletId, userId, { ...approvalInput, policyEvaluation: approvalEvaluation }))
      .rejects.toThrow('approval service down');

    expect(removedApprovalDispatch).not.toHaveBeenCalled();
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
    expect(transactionSigningIntentRepository.lockDraftableIntent).toHaveBeenCalledWith(
      approvalInput.intentId, walletId, client,
    );
    expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'pending' }), client);
    expect(lockUtxosForDraft).toHaveBeenCalledWith(mockDraft.id, ['utxo-id-1'], { isRBF: false, client });
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledTimes(1);
    expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
      mockDraft.id,
      walletId,
      userId,
      approvalEvaluation.triggered,
      client
    );
    expect(removedApprovalDispatch).not.toHaveBeenCalled();
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
    expect(removedApprovalDispatch).not.toHaveBeenCalled();
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
    expect(removedApprovalDispatch).not.toHaveBeenCalled();
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

    expect(removedApprovalDispatch).not.toHaveBeenCalled();
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
      client
    );
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
  });

  it('dispatchDraftCreatedPostCommitNotifications dispatches one approval-marked draft notification without persisting approvals', async () => {
    await dispatchDraftCreatedPostCommitNotifications(
      walletId,
      userId,
      { ...mockDraft, approvalStatus: 'pending' } as never,
      { ...approvalInput, policyEvaluation: approvalEvaluation }
    );

    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(removedApprovalDispatch).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
    expect(dispatchDraftNotification).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({ approvalRequired: true }),
      userId,
      undefined
    );
  });

  it('dispatchDraftCreatedPostCommitNotifications dispatches only the draft notification when approval is not required', async () => {
    await dispatchDraftCreatedPostCommitNotifications(walletId, userId, mockDraft as never, approvalInput);

    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(removedApprovalDispatch).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps the default not_required flow for non-required, null, and empty evaluations', async () => {
    // No policyEvaluation at all. The draft is still inserted in its own
    // transaction, behind the signing-intent row lock.
    await createDraft(walletId, userId, approvalInput);

    expect(txTracker.clients).toHaveLength(1);
    const [tx] = txTracker.clients;
    expect(transactionSigningIntentRepository.lockDraftableIntent).toHaveBeenCalledWith(
      approvalInput.intentId, walletId, tx,
    );
    expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: undefined }), tx);
    expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    expect(dispatchDraftNotification).toHaveBeenCalledTimes(1);

    // Empty triggered array.
    await createDraft(walletId, userId, { ...approvalInput, policyEvaluation: { allowed: true, triggered: [] } });

    expect(txTracker.clients).toHaveLength(2);
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

    expect(txTracker.clients).toHaveLength(3);
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

describe('createDraft binds draft metadata to the signing intent', () => {
  const walletId = 'wallet-456';
  const userId = 'user-123';
  const unsafe = Number.MAX_SAFE_INTEGER + 2;

  beforeEach(() => {
    vi.clearAllMocks();
    (draftRepository.create as Mock).mockResolvedValue({ id: 'draft-789', amount: BigInt(100000), recipient: 'tb1qexternal' });
    (resolveUtxoIds as Mock).mockResolvedValue({ found: ['utxo-id-1'], notFound: [] });
    (lockUtxosForDraft as Mock).mockResolvedValue({ success: true, lockedCount: 1 });
    (systemSettingRepository.getParsed as Mock).mockResolvedValue(7);
    (dispatchDraftNotification as Mock).mockResolvedValue(undefined);
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend());
    (policyEvaluationEngine.evaluatePolicies as Mock).mockResolvedValue({ allowed: true, triggered: [] });
  });

  const expectMismatch = async (overrides: Record<string, unknown>, field: string) => {
    await expect(createDraft(walletId, userId, { ...boundDraftInput, ...overrides } as typeof boundDraftInput))
      .rejects.toMatchObject({ details: expect.objectContaining({ field, reason: 'metadata_mismatch' }) });
    expect(draftRepository.create).not.toHaveBeenCalled();
    expect(lockUtxosForDraft).not.toHaveBeenCalled();
    expect(policyEvaluationEngine.evaluatePolicies).not.toHaveBeenCalled();
  };

  const expectAccepted = async (overrides: Record<string, unknown>) => {
    await createDraft(walletId, userId, { ...boundDraftInput, ...overrides } as typeof boundDraftInput);
    expect(draftRepository.create).toHaveBeenCalledOnce();
  };

  it.each([
    ['a different recipient', { recipient: 'tb1qattacker' }, 'recipient'],
    ['a different effectiveAmount', { effectiveAmount: 99000 }, 'amount'],
    ['a sendMax draft with a different effectiveAmount', { sendMax: true, effectiveAmount: 90000 }, 'amount'],
    ['a subtractFees draft with a different recipient', { subtractFees: true, recipient: 'tb1qattacker' }, 'recipient'],
    ['a fee that is not inputs minus outputs', { fee: 500 }, 'fee'],
    ['an omitted fee (counts as 0)', { fee: undefined }, 'fee'],
    ['an unsafe-integer fee', { fee: unsafe }, 'fee'],
    ['an unsafe-integer effectiveAmount', { effectiveAmount: String(unsafe) }, 'amount'],
    ['selected UTXOs missing a canonical outpoint', { selectedUtxoIds: [] }, 'selectedUtxoIds'],
    ['an omitted selectedUtxoIds (counts as [])', { selectedUtxoIds: undefined }, 'selectedUtxoIds'],
    ['an unrelated selected UTXO', { selectedUtxoIds: ['b'.repeat(64) + ':0'] }, 'selectedUtxoIds'],
    ['a duplicated selected UTXO', { selectedUtxoIds: ['a'.repeat(64) + ':1', 'A'.repeat(64) + ':1'] }, 'selectedUtxoIds'],
    ['isRBF on an intent with no replacement target', { isRBF: true }, 'isRBF'],
    ['a totalInput that is not the input sum', { totalInput: 119000, totalOutput: 119000 }, 'totalInput'],
    ['a totalOutput that is not the output sum', { totalInput: 120000, totalOutput: 100000 }, 'totalOutput'],
    ['an unsafe-integer totalInput', { totalInput: String(unsafe) }, 'totalInput'],
  ])('rejects %s', async (_name, overrides, field) => {
    await expectMismatch(overrides, field);
  });

  it.each([
    ['a non-numeric fee', { fee: 'abc' }],
    ['a fractional effectiveAmount', { effectiveAmount: 1000.5 }],
  ])('rejects %s before persisting', async (_name, overrides) => {
    await expect(createDraft(walletId, userId, { ...boundDraftInput, ...overrides } as typeof boundDraftInput))
      .rejects.toThrow();
    expect(draftRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an intent whose canonical sums are not safe integers', async () => {
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend({
      inputs: [
        { txid: 'a'.repeat(64), vout: 1, address: 'tb1qwallet', amount: Number.MAX_SAFE_INTEGER },
        { txid: 'a'.repeat(64), vout: 2, address: 'tb1qwallet', amount: 10 },
      ],
    }));

    await expectMismatch({ selectedUtxoIds: ['a'.repeat(64) + ':1', 'a'.repeat(64) + ':2'] }, 'fee');
  });

  it.each([
    ['numeric-string fee, effectiveAmount and totals', { fee: '1000', effectiveAmount: '100000', totalInput: '120000', totalOutput: '119000' }],
    ['a matching non-zero total pair', { totalInput: 120000, totalOutput: 119000 }],
    ['zero totals (skipped)', { totalInput: 0, totalOutput: '0' }],
    ['a sendMax draft whose outputs carry 0', { sendMax: true, outputs: [{ address: 'tb1qexternal', amount: 0, sendMax: true }] }],
    ['a subtractFees draft with unreduced outputs', { subtractFees: true, outputs: [{ address: 'tb1qexternal', amount: 101000 }] }],
    ['an amount-only draft (effectiveAmount omitted)', { effectiveAmount: undefined }],
  ])('accepts %s', async (_name, overrides) => {
    await expectAccepted(overrides);
  });

  it('accepts an upper-case txid and locks the normalised outpoint', async () => {
    await expectAccepted({ selectedUtxoIds: ['A'.repeat(64) + ':1'] });

    expect(resolveUtxoIds).toHaveBeenCalledWith(walletId, ['a'.repeat(64) + ':1'], expect.anything());
    expect(draftRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      selectedUtxoIds: ['a'.repeat(64) + ':1'],
    }), expect.anything());
  });

  it('accepts isRBF when the intent carries its replacement target', async () => {
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend({ replacementTxid: 'c'.repeat(64) }));

    await expectAccepted({ isRBF: true });
    expect(lockUtxosForDraft).not.toHaveBeenCalled();
  });

  it('skips recipient and amount for a consolidation that pays nothing outside the wallet', async () => {
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend({ externalOutputs: [], amount: 0 }));

    await expectAccepted({ recipient: 'tb1qchange', effectiveAmount: 119000 });
  });

  it('binds a multi-recipient draft to the first external output and the summed amount', async () => {
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend({
      outputs: [
        { address: 'tb1qexternal', amount: 60000 },
        { address: 'tb1qsecond', amount: 40000 },
        { address: 'tb1qchange', amount: 19000 },
      ],
      externalOutputs: [{ address: 'tb1qexternal', amount: 60000 }, { address: 'tb1qsecond', amount: 40000 }],
      amount: 100000,
    }));

    await expectAccepted({});
    expect(deriveIntentSpend).toHaveBeenCalledOnce();
  });
});

describe('createDraft refuses payjoin intents (C-D9)', () => {
  const walletId = 'wallet-456';
  const userId = 'user-123';
  const storedIntent = {
    intentId: 'intent-1',
    unsignedPsbtSha256: 'psbt-hash',
    signingContext: { version: 1 },
    snapshot: intentSnapshot,
    source: 'standard',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (draftRepository.create as Mock).mockResolvedValue({ id: 'draft-789', amount: BigInt(100000), recipient: 'tb1qexternal' });
    (resolveUtxoIds as Mock).mockResolvedValue({ found: ['utxo-id-1'], notFound: [] });
    (lockUtxosForDraft as Mock).mockResolvedValue({ success: true, lockedCount: 1 });
    (systemSettingRepository.getParsed as Mock).mockResolvedValue(7);
    (deriveIntentSpend as Mock).mockResolvedValue(externalSpend());
    (policyEvaluationEngine.evaluatePolicies as Mock).mockResolvedValue({ allowed: true, triggered: [] });
    (hasPayjoinReplacement as Mock).mockResolvedValue(false);
    (unsignedPsbtSha256 as Mock).mockReset().mockReturnValue('psbt-hash');
  });

  it('refuses a payjoin replacement intent before the PSBT hash check', async () => {
    (loadSigningIntent as Mock).mockResolvedValueOnce({ ...storedIntent, source: 'payjoin' });
    // A mismatching PSBT would be a 400 if the hash check ran first.
    (unsignedPsbtSha256 as Mock).mockReturnValueOnce('stripped-proposal-hash');

    await expect(createDraft(walletId, userId, boundDraftInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Payjoin intents cannot be saved as drafts',
      details: { reason: 'payjoin_intent_not_draftable' },
    });
    expect(unsignedPsbtSha256).not.toHaveBeenCalled();
    expect(draftRepository.create).not.toHaveBeenCalled();
  });

  it('refuses an original that a payjoin proposal was minted from', async () => {
    (loadSigningIntent as Mock).mockResolvedValueOnce(storedIntent);
    (hasPayjoinReplacement as Mock).mockResolvedValueOnce(true);

    await expect(createDraft(walletId, userId, boundDraftInput)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'payjoin_intent_not_draftable' },
    });
    expect(hasPayjoinReplacement).toHaveBeenCalledWith(walletId, 'intent-1');
    expect(unsignedPsbtSha256).not.toHaveBeenCalled();
    expect(draftRepository.create).not.toHaveBeenCalled();
  });

  it('creates a draft for a standard intent with no payjoin replacement', async () => {
    (loadSigningIntent as Mock).mockResolvedValueOnce(storedIntent);

    await createDraft(walletId, userId, boundDraftInput);

    expect(hasPayjoinReplacement).toHaveBeenCalledWith(walletId, 'intent-1');
    expect(draftRepository.create).toHaveBeenCalledOnce();
  });

  it('refuses as payjoin-not-draftable when a payjoin replacement superseded the intent after the pre-check', async () => {
    (loadSigningIntent as Mock).mockResolvedValueOnce(storedIntent);
    (transactionSigningIntentRepository.lockDraftableIntent as Mock).mockResolvedValueOnce(false);
    (hasPayjoinReplacement as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(createDraft(walletId, userId, boundDraftInput)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'payjoin_intent_not_draftable' },
    });
    expect(draftRepository.create).not.toHaveBeenCalled();
    expect(lockUtxosForDraft).not.toHaveBeenCalled();
  });

  it('reports a stale intent when a non-payjoin successor superseded it after the pre-check', async () => {
    (loadSigningIntent as Mock).mockResolvedValueOnce(storedIntent);
    (transactionSigningIntentRepository.lockDraftableIntent as Mock).mockResolvedValueOnce(false);
    (hasPayjoinReplacement as Mock).mockResolvedValue(false);

    await expect(createDraft(walletId, userId, boundDraftInput)).rejects.toMatchObject({
      statusCode: 400,
      details: { reason: 'stale_intent' },
    });
    expect(draftRepository.create).not.toHaveBeenCalled();
  });
});
