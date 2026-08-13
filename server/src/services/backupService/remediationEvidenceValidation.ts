import { z } from 'zod';
import { getErrorMessage } from '../../utils/errors';
import {
  remediationDigest,
  remediationProposalId,
} from '../../utils/walletRemediationCanonicalDocument';
import { parseWalletRemediationDocument } from '../walletRemediation/schema';
import type { BackupRecord } from './types';

type RemediationEventKind = 'approved_applied' | 'cancelled' | 'failed';

interface ValidatedProposal {
  id: string;
  digest: string;
}

interface ValidatedEvent {
  id: string;
  proposalId: string;
  proposalDigest: string;
  sequence: number;
  kind: RemediationEventKind;
  actorUserId: string;
  actorUsername: string;
  details: Record<string, string | number>;
  previousEventDigest: string | null;
  eventDigest: string;
}

const nonEmptyStringSchema = z.string().min(1);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const remediationEventSchema = z.object({
  id: nonEmptyStringSchema,
  proposalId: nonEmptyStringSchema,
  proposalDigest: digestSchema,
  sequence: z.number().int().positive(),
  kind: z.enum(['approved_applied', 'cancelled', 'failed']),
  actorUserId: nonEmptyStringSchema,
  actorUsername: nonEmptyStringSchema,
  details: z.record(z.string(), z.union([z.string(), z.number().finite()])),
  previousEventDigest: digestSchema.nullable(),
  eventDigest: digestSchema,
  createdAt: z.string().datetime(),
}).strict();

const validateProposal = (record: BackupRecord): ValidatedProposal => {
  const document = parseWalletRemediationDocument(record.document);
  const digest = remediationDigest(document);
  const id = remediationProposalId(digest);
  if (record.id !== id) throw new Error('content-addressed ID does not match its document');
  if (record.proposalDigest !== digest) throw new Error('digest does not match its document');
  if (record.walletId !== document.walletId) throw new Error('wallet ID does not match its document');
  if (record.schemaVersion !== document.schemaVersion) {
    throw new Error('schema version does not match its document');
  }
  return { id, digest };
};

const parseEvent = (record: BackupRecord): ValidatedEvent => {
  const parsed = remediationEventSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error('has an invalid immutable event shape');
  }
  return parsed.data;
};

const expectedEventDigest = (event: ValidatedEvent): string => remediationDigest({
  proposalId: event.proposalId,
  proposalDigest: event.proposalDigest,
  sequence: event.sequence,
  kind: event.kind,
  actorUserId: event.actorUserId,
  actorUsername: event.actorUsername,
  details: event.details,
  previousEventDigest: event.previousEventDigest,
});

const validateEventChain = (
  proposal: ValidatedProposal,
  events: readonly ValidatedEvent[],
): void => {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  let previousDigest: string | null = null;
  let terminalSeen = false;
  for (const [index, event] of ordered.entries()) {
    if (event.proposalDigest !== proposal.digest) {
      throw new Error(`event ${event.id} does not match its exact proposal identity`);
    }
    if (event.sequence !== index + 1) {
      throw new Error(`event ${event.id} breaks the contiguous sequence`);
    }
    if (event.previousEventDigest !== previousDigest) {
      throw new Error(`event ${event.id} breaks the previous digest chain`);
    }
    if (event.eventDigest !== expectedEventDigest(event)) {
      throw new Error(`event ${event.id} has an invalid event digest`);
    }
    if (terminalSeen) throw new Error(`event ${event.id} appears after a terminal event`);
    if (event.kind !== 'failed') terminalSeen = true;
    previousDigest = event.eventDigest;
  }
};

const recordFailClosed = (issues: string[], context: string, error: unknown): void => {
  issues.push(`${context}: ${getErrorMessage(error)}`);
};

const collectProposals = (
  records: readonly BackupRecord[],
  issues: string[],
): Map<string, ValidatedProposal> => {
  const proposalById = new Map<string, ValidatedProposal>();
  for (const record of records) {
    try {
      const proposal = validateProposal(record);
      if (proposalById.has(proposal.id)) throw new Error('has a duplicate proposal ID');
      proposalById.set(proposal.id, proposal);
    } catch (error) {
      recordFailClosed(issues, 'Invalid immutable remediation proposal', error);
    }
  }
  return proposalById;
};

const collectEvents = (
  records: readonly BackupRecord[],
  issues: string[],
): Map<string, ValidatedEvent[]> => {
  const eventsByProposal = new Map<string, ValidatedEvent[]>();
  const eventIds = new Set<string>();
  for (const record of records) {
    try {
      const event = parseEvent(record);
      if (eventIds.has(event.id)) throw new Error(`duplicate event ID ${event.id}`);
      eventIds.add(event.id);
      const proposalEvents = eventsByProposal.get(event.proposalId) ?? [];
      proposalEvents.push(event);
      eventsByProposal.set(event.proposalId, proposalEvents);
    } catch (error) {
      recordFailClosed(issues, 'Invalid immutable remediation event', error);
    }
  }
  return eventsByProposal;
};

const validateChains = (
  proposalById: ReadonlyMap<string, ValidatedProposal>,
  eventsByProposal: ReadonlyMap<string, ValidatedEvent[]>,
  issues: string[],
): void => {
  for (const [proposalId, proposalEvents] of eventsByProposal) {
    const proposal = proposalById.get(proposalId);
    if (!proposal) {
      issues.push(`Invalid immutable remediation events: proposal ${proposalId} is missing`);
      continue;
    }
    try {
      validateEventChain(proposal, proposalEvents);
    } catch (error) {
      recordFailClosed(issues, `Invalid immutable remediation events for ${proposalId}`, error);
    }
  }
};

/**
 * Validates content addressing and event-chain integrity before restore can
 * enter the transaction that deletes ordinary application data.
 */
export function validateRemediationEvidenceForRestore(
  data: Record<string, BackupRecord[]>,
): string[] {
  const proposals = data.walletRemediationProposal;
  const events = data.walletRemediationEvent;
  if (proposals === undefined && events === undefined) return [];
  if (!Array.isArray(proposals) || !Array.isArray(events)) {
    return ['Immutable remediation proposal and event tables must both be arrays'];
  }

  const issues: string[] = [];
  const proposalById = collectProposals(proposals, issues);
  const eventsByProposal = collectEvents(events, issues);
  validateChains(proposalById, eventsByProposal, issues);
  return issues;
}
