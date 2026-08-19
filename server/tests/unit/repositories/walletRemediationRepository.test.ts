import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type WalletRemediationProposal } from '../../../src/generated/prisma/client';
import type { PrismaTxClient } from '../../../src/models/prisma';
import type {
  RemediationChange,
  WalletRemediationDocument,
} from '../../../src/services/walletRemediation/types';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  proposalCreate: vi.fn(),
  proposalFindFirst: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    walletRemediationProposal: {
      create: mocks.proposalCreate,
      findFirst: mocks.proposalFindFirst,
    },
  },
}));

import {
  appendEvent,
  applyChanges,
  createProposal,
  findExactProposal,
  loadSnapshot,
  lockApprovalGraph,
  walletRemediationRepository,
  withSerializableTransaction,
} from '../../../src/repositories/walletRemediationRepository';
import { remediationDigest } from '../../../src/utils/walletRemediationCanonicalDocument';

const actor = { userId: 'user-1', username: 'alice' };
const document = {
  schemaVersion: 'sanctuary.wallet-remediation.v1',
  walletId: 'wallet-1',
  eligible: true,
  originalStateDigest: 'state-digest',
  changes: [{
    kind: 'wallet_policy',
    recordId: 'wallet-1',
    proposed: { descriptorPolicyVersion: 1 },
    evidenceIds: ['wallet:wallet-1'],
  }],
  blockers: [],
  proof: {
    preservedPolicyDigest: 'policy-digest',
    addressCount: 1,
    unchangedAddressCount: 1,
    scriptPubKeyCount: 1,
    unchangedScriptPubKeyCount: 1,
    recoveryStatus: 'recovery-proven', signingStatus: 'not-tested',
    recoveryEvidenceDigest: 'b'.repeat(64),
    evidenceIds: ['wallet:wallet-1'],
  },
  backout: { state: 'not-applied', message: 'Preview only.' },
} as unknown as WalletRemediationDocument;
const digest = remediationDigest(document);

function proposal(overrides: Partial<WalletRemediationProposal> = {}): WalletRemediationProposal {
  return {
    id: 'proposal-1',
    walletId: 'wallet-1',
    schemaVersion: document.schemaVersion,
    proposalDigest: digest,
    document: document as unknown as Prisma.JsonObject,
    createdByUserId: actor.userId,
    createdByUsername: actor.username,
    createdAt: new Date('2026-08-11T00:00:00Z'),
    ...overrides,
  };
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('database failure', {
    code,
    clientVersion: 'test',
  });
}

describe('walletRemediationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the exact wallet graph and maps owner rows to user IDs', async () => {
    const wallet = { id: 'wallet-1', descriptor: 'wpkh(key/0/*)' };
    const signers = [{ id: 'link-1', walletId: 'wallet-1' }];
    const addresses = [{ id: 'address-1', walletId: 'wallet-1' }];
    mocks.queryRaw
      .mockResolvedValueOnce([wallet])
      .mockResolvedValueOnce(signers)
      .mockResolvedValueOnce(addresses)
      .mockResolvedValueOnce([{ userId: 'owner-1' }, { userId: 'owner-2' }]);

    await expect(loadSnapshot('wallet-1')).resolves.toEqual({
      wallet,
      signers,
      addresses,
      ownerUserIds: ['owner-1', 'owner-2'],
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
  });

  it('returns null immediately when the wallet does not exist', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(loadSnapshot('missing')).resolves.toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('creates a proposal with the immutable document and actor identity', async () => {
    const stored = proposal();
    mocks.proposalCreate.mockResolvedValue(stored);

    await expect(createProposal({ id: stored.id, digest, document, actor })).resolves.toBe(stored);
    expect(mocks.proposalCreate).toHaveBeenCalledWith({
      data: {
        id: stored.id,
        walletId: document.walletId,
        schemaVersion: document.schemaVersion,
        proposalDigest: digest,
        document,
        createdByUserId: actor.userId,
        createdByUsername: actor.username,
      },
    });
  });

  it('returns the exact existing proposal after an idempotent unique conflict', async () => {
    const stored = { ...proposal(), events: [] };
    mocks.proposalCreate.mockRejectedValue(knownRequestError('P2002'));
    mocks.proposalFindFirst.mockResolvedValue(stored);

    await expect(createProposal({ id: stored.id, digest, document, actor })).resolves.toBe(stored);
  });

  it.each([
    ['a non-unique Prisma error', knownRequestError('P2025')],
    ['a non-Prisma error', new Error('offline')],
  ])('preserves %s from proposal creation', async (_label, failure) => {
    mocks.proposalCreate.mockRejectedValue(failure);

    await expect(createProposal({ id: 'proposal-1', digest, document, actor })).rejects.toBe(failure);
    expect(mocks.proposalFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['no matching proposal', null],
    ['a proposal whose canonical document has drifted', { ...proposal(), document: { ...document, walletId: 'wallet-2' }, events: [] }],
  ])('preserves a unique conflict when there is %s', async (_label, existing) => {
    const failure = knownRequestError('P2002');
    mocks.proposalCreate.mockRejectedValue(failure);
    mocks.proposalFindFirst.mockResolvedValue(existing);

    await expect(createProposal({ id: 'proposal-1', digest, document, actor })).rejects.toBe(failure);
  });

  it('finds only the exact proposal identity and orders its event chain', async () => {
    const stored = { ...proposal(), events: [] };
    mocks.proposalFindFirst.mockResolvedValue(stored);

    await expect(findExactProposal('wallet-1', 'proposal-1', digest)).resolves.toBe(stored);
    expect(mocks.proposalFindFirst).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', id: 'proposal-1', proposalDigest: digest },
      include: { events: { orderBy: { sequence: 'asc' } } },
    });
  });

  it('opens remediation writes at serializable isolation with bounded waits', async () => {
    const callback = vi.fn(async () => 'result');
    mocks.transaction.mockImplementation(async (passedCallback, options) => {
      expect(options).toEqual({ isolationLevel: 'Serializable', maxWait: 10_000, timeout: 300_000 });
      return passedCallback({ marker: 'tx' });
    });

    await expect(withSerializableTransaction(callback)).resolves.toBe('result');
    expect(callback).toHaveBeenCalledWith({ marker: 'tx' });
  });

  it('locks the full approval graph before returning ordered events', async () => {
    const stored = proposal();
    const events = [{ id: 'event-1', sequence: 1 }];
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([stored])
        .mockResolvedValue([]),
      walletRemediationEvent: { findMany: vi.fn().mockResolvedValue(events) },
    } as unknown as PrismaTxClient;

    await expect(lockApprovalGraph(tx, 'wallet-1', 'proposal-1', digest)).resolves.toEqual({
      ...stored,
      events,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(8);
    expect(tx.walletRemediationEvent.findMany).toHaveBeenCalledWith({
      where: { proposalId: 'proposal-1' },
      orderBy: { sequence: 'asc' },
    });
  });

  it('rejects a missing exact proposal before taking downstream locks', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      walletRemediationEvent: { findMany: vi.fn() },
    } as unknown as PrismaTxClient;

    await expect(lockApprovalGraph(tx, 'wallet-1', 'missing', digest))
      .rejects.toThrow('Remediation proposal not found');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.walletRemediationEvent.findMany).not.toHaveBeenCalled();
  });

  const recoveryPatch = () => ({
    descriptorPolicyVersion: 1,
    descriptorSourceKind: 'recovered_legacy',
    changeDescriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub-change/1/*)',
    sourceDescriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub-receive/0/*)',
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
  });

  it('bounds a policy recovery to the exact pre-state it was proven against', async () => {
    const change: RemediationChange = {
      kind: 'wallet_policy_recovery', recordId: 'wallet-1', proposed: recoveryPatch(), evidenceIds: [],
    };
    const tx = {
      wallet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', [change])).resolves.toBeUndefined();
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wallet-1',
        descriptorPolicyVersion: null,
        canonicalPolicyId: null,
        descriptor: change.proposed.sourceDescriptor,
      },
      data: change.proposed,
    });
  });

  it('rejects a policy recovery whose patch is incomplete', async () => {
    const { sourceDescriptor: _omitted, ...partial } = recoveryPatch();
    const change: RemediationChange = {
      kind: 'wallet_policy_recovery', recordId: 'wallet-1', proposed: partial, evidenceIds: [],
    };
    const tx = { wallet: { updateMany: vi.fn() } } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', [change]))
      .rejects.toThrow('Incomplete remediation patch for wallet-1');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a policy recovery whose bounding value is not an exact string', async () => {
    const change: RemediationChange = {
      kind: 'wallet_policy_recovery',
      recordId: 'wallet-1',
      proposed: { ...recoveryPatch(), sourceDescriptor: '' },
      evidenceIds: [],
    };
    const tx = { wallet: { updateMany: vi.fn() } } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', [change]))
      .rejects.toThrow(/must be an exact string/);
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back a policy recovery when the wallet already acquired a policy', async () => {
    const change: RemediationChange = {
      kind: 'wallet_policy_recovery', recordId: 'wallet-1', proposed: recoveryPatch(), evidenceIds: [],
    };
    const tx = {
      wallet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', [change]))
      .rejects.toThrow('Remediation write count mismatch for wallet-1');
  });

  it('applies every supported exact patch to the scoped record', async () => {
    const changes: RemediationChange[] = [
      { kind: 'wallet_policy', recordId: 'wallet-1', proposed: { canonicalPolicyVersion: 1 }, evidenceIds: [] },
      { kind: 'signer_binding', recordId: 'link-1', proposed: { signerIndex: 0 }, evidenceIds: [] },
      { kind: 'address_coordinate', recordId: 'address-1', proposed: { branch: 1 }, evidenceIds: [] },
    ];
    const tx = {
      wallet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      walletDevice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      address: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', changes)).resolves.toBeUndefined();
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-1' }, data: { canonicalPolicyVersion: 1 },
    });
    expect(tx.walletDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'link-1', walletId: 'wallet-1' }, data: { signerIndex: 0 },
    });
    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { id: 'address-1', walletId: 'wallet-1' }, data: { branch: 1 },
    });
  });

  it.each([
    ['empty', { kind: 'wallet_policy', recordId: 'wallet-1', proposed: {}, evidenceIds: [] }],
    ['unknown', { kind: 'signer_binding', recordId: 'link-1', proposed: { descriptor: 'unsafe' }, evidenceIds: [] }],
  ] as const)('rejects an %s patch before issuing a write', async (_label, change) => {
    const tx = {
      wallet: { updateMany: vi.fn() },
      walletDevice: { updateMany: vi.fn() },
      address: { updateMany: vi.fn() },
    } as unknown as PrismaTxClient;

    await expect(applyChanges(tx, 'wallet-1', [change as unknown as RemediationChange]))
      .rejects.toThrow(`Unsafe remediation patch for ${change.recordId}`);
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.walletDevice.updateMany).not.toHaveBeenCalled();
    expect(tx.address.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back when an exact scoped write does not update one row', async () => {
    const tx = {
      wallet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaTxClient;
    const change: RemediationChange = {
      kind: 'wallet_policy', recordId: 'wallet-1', proposed: { descriptorPolicyVersion: 1 }, evidenceIds: [],
    };

    await expect(applyChanges(tx, 'wallet-1', [change]))
      .rejects.toThrow('Remediation write count mismatch for wallet-1');
  });

  it.each([
    [undefined, 1, null],
    [{ sequence: 4, eventDigest: 'previous-digest' }, 5, 'previous-digest'],
  ])('appends a canonical event to the immutable hash chain', async (previous, sequence, previousEventDigest) => {
    const create = vi.fn(async ({ data }) => ({ id: 'event-new', ...data }));
    const tx = {
      walletRemediationEvent: {
        findFirst: vi.fn().mockResolvedValue(previous),
        create,
      },
    } as unknown as PrismaTxClient;
    const input = {
      proposalId: 'proposal-1',
      proposalDigest: digest,
      kind: 'failed' as const,
      actor,
      details: { reasonCode: 'approval_rejected', attempt: 1 },
    };

    const result = await appendEvent(tx, input);

    expect(tx.walletRemediationEvent.findFirst).toHaveBeenCalledWith({
      where: { proposalId: 'proposal-1' }, orderBy: { sequence: 'desc' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        proposalId: input.proposalId,
        sequence,
        proposalDigest: digest,
        kind: input.kind,
        actorUserId: actor.userId,
        actorUsername: actor.username,
        details: input.details,
        previousEventDigest,
        eventDigest: remediationDigest({
          proposalId: input.proposalId,
          proposalDigest: digest,
          sequence,
          kind: input.kind,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          details: input.details,
          previousEventDigest,
        }),
      },
    });
    expect(result).toEqual(expect.objectContaining({ sequence, previousEventDigest }));
  });

  it('exports the complete repository surface', () => {
    expect(walletRemediationRepository).toEqual({
      loadSnapshot,
      createProposal,
      findExactProposal,
      withSerializableTransaction,
      lockApprovalGraph,
      applyChanges,
      appendEvent,
    });
  });
});
