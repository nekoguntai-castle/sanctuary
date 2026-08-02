import { createHash } from 'node:crypto';

const PARTICIPANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export interface CaptureMembershipBarrier {
  generation: number;
  digest: string;
  expectedParticipants: readonly string[];
}

export function normalizeParticipantId(participantId: string): string {
  const normalized = participantId.trim().toLowerCase();
  if (!PARTICIPANT_ID_PATTERN.test(normalized)) {
    throw new Error('capture_participant_id_invalid');
  }
  return normalized;
}

/** Builds a deterministic barrier from service-role identifiers, never user identifiers. */
export function createMembershipBarrier(
  generation: number,
  participantIds: readonly string[],
): CaptureMembershipBarrier {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('capture_membership_generation_invalid');
  }

  const expectedParticipants = [...new Set(participantIds.map(normalizeParticipantId))].sort();
  if (expectedParticipants.length === 0) {
    throw new Error('capture_participant_roster_empty');
  }

  const digest = createHash('sha256')
    .update(`${generation}\n${expectedParticipants.join('\n')}`, 'utf8')
    .digest('hex');

  return Object.freeze({
    generation,
    digest,
    expectedParticipants: Object.freeze(expectedParticipants),
  });
}

export function membershipBarriersEqual(
  expected: CaptureMembershipBarrier,
  observed: Pick<CaptureMembershipBarrier, 'generation' | 'digest'>,
): boolean {
  return expected.generation === observed.generation
    && expected.digest === observed.digest;
}
