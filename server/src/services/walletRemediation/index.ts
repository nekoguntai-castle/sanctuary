import { ConflictError, InvalidInputError, NotFoundError, WalletNotFoundError } from '../../errors';
import { walletRemediationRepository } from '../../repositories';
import { isSerializableTransactionConflict } from '../../utils/prismaSerializableConflict';
import { createLogger } from '../../utils/logger';
import {
  remediationDigest,
  remediationProofDigest,
  remediationProposalId,
} from '../../utils/walletRemediationCanonicalDocument';
import { buildWalletRemediationDocument } from './proof';
import {
  parseWalletRemediationDocument,
  parseWalletRemediationProposalView,
} from './schema';
import type {
  WalletRemediationActor,
  WalletRemediationDocument,
  WalletRemediationEventView,
  WalletRemediationProposalView,
} from './types';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const log = createLogger('WALLET_REMEDIATION:SVC');

function validateProposalIdentity(proposalId: string, proposalDigest: string): void {
  if (!/^wallet-remediation-v1:[0-9a-f]{64}$/.test(proposalId)
    || !/^[0-9a-f]{64}$/.test(proposalDigest)) {
    throw new InvalidInputError('Exact remediation proposal ID and digest are required');
  }
}

function documentFromJson(value: unknown): WalletRemediationDocument {
  try {
    return parseWalletRemediationDocument(value);
  } catch {
    throw new ConflictError('Remediation evidence is invalid');
  }
}

function assertDocumentIdentity(
  document: WalletRemediationDocument,
  proposalId: string,
  proposalDigest: string,
): void {
  if (remediationDigest(document) !== proposalDigest
    || remediationProposalId(proposalDigest) !== proposalId
    || remediationProofDigest(document) !== document.proofDigest) {
    throw new ConflictError('Remediation proposal digest does not match its immutable document');
  }
}

function proposalView(
  proposal: Awaited<ReturnType<typeof walletRemediationRepository.findExactProposal>>,
): WalletRemediationProposalView {
  if (!proposal) throw new NotFoundError('Remediation proposal not found');
  const document = documentFromJson(proposal.document);
  const applied = proposal.events.find((event) => event.kind === 'approved_applied');
  const cancelled = proposal.events.some((event) => event.kind === 'cancelled');
  return parseWalletRemediationProposalView({
    ...document,
    proposalId: proposal.id,
    proposalDigest: proposal.proposalDigest,
    createdAt: proposal.createdAt.toISOString(),
    state: applied ? 'applied' : cancelled ? 'cancelled' : !document.eligible ? 'blocked' : 'pending',
    ...(applied ? { appliedAt: applied.createdAt.toISOString() } : {}),
    ...(applied ? {
      backout: {
        state: 'forward-fix-only' as const,
        message: 'Applied proof metadata is immutable; use capability disablement and a reviewed forward fix.',
      },
    } : {}),
  });
}

function verifiedEventViews(
  proposalId: string,
  proposalDigest: string,
  events: NonNullable<Awaited<ReturnType<typeof walletRemediationRepository.findExactProposal>>>['events'],
): WalletRemediationEventView[] {
  let previousEventDigest: string | null = null;
  let terminalSeen = false;
  return events.map((event, index) => {
    const details = event.details as Record<string, string | number> | null;
    const expectedDigest = remediationDigest({
      proposalId,
      proposalDigest,
      sequence: index + 1,
      kind: event.kind,
      actorUserId: event.actorUserId,
      actorUsername: event.actorUsername,
      details,
      previousEventDigest,
    });
    if (event.proposalId !== proposalId || event.proposalDigest !== proposalDigest
      || event.sequence !== index + 1 || event.previousEventDigest !== previousEventDigest
      || event.eventDigest !== expectedDigest || !details || terminalSeen
      || !['approved_applied', 'cancelled', 'failed'].includes(event.kind)) {
      throw new ConflictError('Remediation event chain is invalid');
    }
    if (event.kind !== 'failed') terminalSeen = true;
    previousEventDigest = event.eventDigest;
    return {
      id: event.id,
      proposalId: event.proposalId,
      sequence: event.sequence,
      proposalDigest: event.proposalDigest,
      kind: event.kind as WalletRemediationEventView['kind'],
      actorUserId: event.actorUserId,
      actorUsername: event.actorUsername,
      details,
      previousEventDigest: event.previousEventDigest,
      eventDigest: event.eventDigest,
      createdAt: event.createdAt.toISOString(),
    };
  });
}

export async function createWalletRemediationProposal(
  walletId: string,
  actor: WalletRemediationActor,
): Promise<WalletRemediationProposalView> {
  const snapshot = await walletRemediationRepository.loadSnapshot(walletId);
  if (!snapshot) throw new WalletNotFoundError(walletId);
  if (!snapshot.ownerUserIds.includes(actor.userId)) {
    throw new ConflictError('Wallet ownership changed before remediation preview');
  }
  const document = buildWalletRemediationDocument(snapshot);
  const digest = remediationDigest(document);
  const id = remediationProposalId(digest);
  await walletRemediationRepository.createProposal({ id, digest, document, actor });
  const proposal = await walletRemediationRepository.findExactProposal(walletId, id, digest);
  return proposalView(proposal);
}

async function approveAttempt(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  actor: WalletRemediationActor,
): Promise<WalletRemediationProposalView> {
  return walletRemediationRepository.withSerializableTransaction(async (tx) => {
    const locked = await walletRemediationRepository.lockApprovalGraph(
      tx, walletId, proposalId, proposalDigest,
    );
    const document = documentFromJson(locked.document);
    assertDocumentIdentity(document, proposalId, proposalDigest);
    const applied = locked.events.find((event) => event.kind === 'approved_applied');
    if (applied) return proposalView({ ...locked, events: locked.events });
    if (locked.events.some((event) => event.kind === 'cancelled') || !document.eligible) {
      throw new ConflictError('Remediation proposal is blocked');
    }
    const snapshot = await walletRemediationRepository.loadSnapshot(walletId, tx);
    if (!snapshot || !snapshot.ownerUserIds.includes(actor.userId)) {
      throw new ConflictError('Wallet ownership changed before remediation approval');
    }
    const freshDocument = buildWalletRemediationDocument(snapshot, document.attemptId);
    if (remediationDigest(freshDocument) !== proposalDigest) {
      throw new ConflictError('Wallet metadata changed; create and approve a new preview');
    }
    await walletRemediationRepository.applyChanges(tx, walletId, document.changes);
    const postSnapshot = await walletRemediationRepository.loadSnapshot(walletId, tx);
    if (!postSnapshot) throw new WalletNotFoundError(walletId);
    const postProof = buildWalletRemediationDocument(postSnapshot);
    if (!postProof.eligible || postProof.changes.length !== 0
      || postProof.proof.unchangedAddressCount !== postProof.proof.addressCount) {
      throw new ConflictError('Post-remediation proof did not converge to immutable safe metadata');
    }
    const event = await walletRemediationRepository.appendEvent(tx, {
      proposalId,
      proposalDigest,
      kind: 'approved_applied',
      actor,
      details: {
        changeCount: document.changes.length,
        addressCount: document.proof.addressCount,
      },
    });
    return parseWalletRemediationProposalView({
      ...document,
      proposalId,
      proposalDigest,
      createdAt: locked.createdAt.toISOString(),
      state: 'applied',
      appliedAt: event.createdAt.toISOString(),
      backout: {
        state: 'forward-fix-only',
        message: 'Applied proof metadata is immutable; use capability disablement and a reviewed forward fix.',
      },
    });
  });
}

async function recordFailedApproval(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  actor: WalletRemediationActor,
): Promise<void> {
  try {
    await walletRemediationRepository.withSerializableTransaction(async (tx) => {
      const locked = await walletRemediationRepository.lockApprovalGraph(
        tx, walletId, proposalId, proposalDigest,
      );
      const document = documentFromJson(locked.document);
      if (locked.events.some((event) => event.kind === 'approved_applied' || event.kind === 'cancelled')) {
        return;
      }
      try {
        assertDocumentIdentity(document, proposalId, proposalDigest);
      } catch {
        return;
      }
      const snapshot = await walletRemediationRepository.loadSnapshot(walletId, tx);
      if (!snapshot?.ownerUserIds.includes(actor.userId)) return;
      await walletRemediationRepository.appendEvent(tx, {
        proposalId,
        proposalDigest,
        kind: 'failed',
        actor,
        details: { reasonCode: 'approval_rejected' },
      });
    });
  } catch (error) {
    // Failure evidence is best-effort after the approval transaction has rolled back.
    // It must never mask the original fail-closed approval error.
    log.warn('Failed to record rejected wallet remediation approval', {
      walletId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function approveWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  actor: WalletRemediationActor,
): Promise<WalletRemediationProposalView> {
  validateProposalIdentity(proposalId, proposalDigest);
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await approveAttempt(walletId, proposalId, proposalDigest, actor);
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) {
        await recordFailedApproval(walletId, proposalId, proposalDigest, actor);
        throw error;
      }
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        await recordFailedApproval(walletId, proposalId, proposalDigest, actor);
        throw new ConflictError('Remediation approval conflicted; create a fresh preview');
      }
    }
  }
  throw new ConflictError('Remediation approval conflicted');
}

export async function cancelWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  actor: WalletRemediationActor,
): Promise<WalletRemediationProposalView> {
  validateProposalIdentity(proposalId, proposalDigest);
  return walletRemediationRepository.withSerializableTransaction(async (tx) => {
    const locked = await walletRemediationRepository.lockApprovalGraph(
      tx, walletId, proposalId, proposalDigest,
    );
    const document = documentFromJson(locked.document);
    assertDocumentIdentity(document, proposalId, proposalDigest);
    if (locked.events.some((event) => event.kind === 'approved_applied')) {
      throw new ConflictError('Applied remediation evidence cannot be cancelled');
    }
    if (!document.eligible) throw new ConflictError('Blocked remediation evidence cannot be cancelled');
    if (locked.events.some((event) => event.kind === 'cancelled')) {
      return proposalView(locked);
    }
    const snapshot = await walletRemediationRepository.loadSnapshot(walletId, tx);
    if (!snapshot?.ownerUserIds.includes(actor.userId)) {
      throw new ConflictError('Wallet ownership changed before remediation cancellation');
    }
    const event = await walletRemediationRepository.appendEvent(tx, {
      proposalId,
      proposalDigest,
      kind: 'cancelled',
      actor,
      details: { reasonCode: 'owner_cancelled' },
    });
    return proposalView({ ...locked, events: [...locked.events, event] });
  });
}

export async function exportWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
): Promise<import('./types').WalletRemediationExport> {
  const proposal = await walletRemediationRepository.findExactProposal(walletId, proposalId, proposalDigest);
  if (!proposal) {
    throw new NotFoundError('Remediation proposal not found');
  }
  const document = documentFromJson(proposal.document);
  assertDocumentIdentity(document, proposalId, proposalDigest);
  return {
    proposal: proposalView(proposal),
    events: verifiedEventViews(proposalId, proposalDigest, proposal.events),
  };
}

export * from './types';
