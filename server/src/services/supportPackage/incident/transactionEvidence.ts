import { transactionRepository } from '../../../repositories';
import type {
  IncidentExpectedDirection,
  IncidentRole,
  IncidentReceiverMatchEvidence,
  IncidentSelectors,
  IncidentTimingRelation,
  IncidentTransactionEvidence,
  IncidentTransactionEvidenceSnapshot,
} from './types';

const INCIDENT_TIME_WINDOW_MS = 15 * 60_000;

interface TransactionLookupRepository {
  findByTxid: (
    txid: string,
    walletId: string,
    options: { select: typeof INCIDENT_TRANSACTION_SELECT },
  ) => Promise<TransactionLookupRow | null>;
}

interface TransactionLookupRow {
  type: string;
  createdAt: Date;
  wallet: { network: string };
  address: { walletId: string; createdAt: Date } | null;
}

const INCIDENT_TRANSACTION_SELECT = {
  type: true,
  createdAt: true,
  wallet: { select: { network: true } },
  address: { select: { walletId: true, createdAt: true } },
} as const;

interface RoleSelector {
  role: IncidentRole;
  expectedDirection: IncidentExpectedDirection;
  walletId: string;
}

function roleSelectors(selectors: IncidentSelectors): readonly [RoleSelector, RoleSelector] {
  return [
    { role: 'sender', expectedDirection: 'sent', walletId: selectors.senderWalletId },
    { role: 'receiver', expectedDirection: 'received', walletId: selectors.receiverWalletId },
  ];
}

function timingRelation(
  createdAt: Date,
  approximateIncidentAt: Date,
): IncidentTimingRelation {
  const createdMs = createdAt.getTime();
  const incidentMs = approximateIncidentAt.getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(incidentMs)) return 'unknown';
  if (createdMs < incidentMs - INCIDENT_TIME_WINDOW_MS) return 'predates_incident';
  if (createdMs > incidentMs + INCIDENT_TIME_WINDOW_MS) return 'postdates_incident';
  return 'within_window';
}

async function readRoleTransaction(
  txid: string,
  approximateIncidentAt: Date,
  selector: RoleSelector,
  repository: TransactionLookupRepository,
): Promise<{ evidence: IncidentTransactionEvidence; row: TransactionLookupRow | null }> {
  try {
    const row = await repository.findByTxid(txid, selector.walletId, {
      select: INCIDENT_TRANSACTION_SELECT,
    });
    if (!row) {
      return { evidence: {
        role: selector.role,
        expectedDirection: selector.expectedDirection,
        lookupStatus: 'observed',
        transactionRow: {
          present: 'observed_false',
          directionMatches: 'not_observed',
          timing: 'unknown',
        },
      }, row: null };
    }
    return { evidence: {
      role: selector.role,
      expectedDirection: selector.expectedDirection,
      lookupStatus: 'observed',
      transactionRow: {
        present: 'observed_true',
        directionMatches: row.type === selector.expectedDirection
          ? 'observed_true'
          : 'observed_false',
        timing: timingRelation(row.createdAt, approximateIncidentAt),
      },
    }, row };
  } catch {
    return { evidence: unavailableTransactionEvidence(selector), row: null };
  }
}

function receiverMatchEvidence(
  sender: TransactionLookupRow | null,
  receiver: TransactionLookupRow | null,
  selectors: IncidentSelectors,
): IncidentReceiverMatchEvidence {
  return {
    ownsSelectedOutput: receiver?.address
      ? receiver.address.walletId === selectors.receiverWalletId
        ? 'observed_true'
        : 'observed_false'
      : 'not_observed',
    networkMatches: sender && receiver
      ? sender.wallet.network === receiver.wallet.network
        ? 'observed_true'
        : 'observed_false'
      : 'not_observed',
    addressTiming: receiver?.address
      ? timingRelation(receiver.address.createdAt, selectors.approximateIncidentAt)
      : 'unknown',
  };
}

function unavailableTransactionEvidence(
  selector: Pick<RoleSelector, 'role' | 'expectedDirection'>,
): IncidentTransactionEvidence {
  return {
    role: selector.role,
    expectedDirection: selector.expectedDirection,
    lookupStatus: 'unavailable',
    transactionRow: {
      present: 'not_observed',
      directionMatches: 'not_observed',
      timing: 'unknown',
    },
  };
}

/**
 * Resolve only the two exact `(txid, walletId)` transaction rows. Repository
 * results are immediately reduced to fixed categories; identifiers and dates
 * never cross this boundary in the returned value.
 */
export async function readIncidentTransactionEvidence(
  selectors: IncidentSelectors,
  repository?: TransactionLookupRepository,
): Promise<IncidentTransactionEvidenceSnapshot> {
  const lookupRepository: TransactionLookupRepository = repository ?? {
    findByTxid: (txid, walletId, options) => transactionRepository.findByTxid(
      txid,
      walletId,
      options,
    ),
  };
  const [sender, receiver] = roleSelectors(selectors);
  const evidence = await Promise.all([
    readRoleTransaction(
      selectors.txid,
      selectors.approximateIncidentAt,
      sender,
      lookupRepository,
    ),
    readRoleTransaction(
      selectors.txid,
      selectors.approximateIncidentAt,
      receiver,
      lookupRepository,
    ),
  ]);
  return {
    roles: [evidence[0].evidence, evidence[1].evidence],
    receiverMatch: receiverMatchEvidence(evidence[0].row, evidence[1].row, selectors),
  };
}
