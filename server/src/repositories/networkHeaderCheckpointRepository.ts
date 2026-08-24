/**
 * Network Header Checkpoint Repository
 *
 * Durable per-network chain-tip progress, plus the pure classifier that decides
 * what a freshly observed header means relative to the persisted one.
 *
 * The reader never reports coverage it cannot prove:
 *  - an absent row reads as UNKNOWN (`null`), never as "the tip is current", so
 *    a freshly migrated database reconciles instead of trusting a gap-free
 *    story it cannot support;
 *  - a restored database keeps its row, but that row sits BEHIND the chain, so
 *    the next observation classifies as `missed_gap` and reconciles the span;
 *  - a row that violates the persisted-shape contract is discarded down to
 *    UNKNOWN and logged, because a checkpoint we cannot trust would suppress
 *    exactly the reconciliation it should trigger.
 *
 * No writer is wired yet — the persistence contract lands before the producer
 * that depends on it.
 */

import prisma from '../models/prisma';
import { resolvePersistedBitcoinNetwork, type BitcoinNetwork } from '../constants/bitcoinNetworks';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('REPO:HEADER_CHECKPOINT');

/** Block hashes are the reversed double-SHA256 of an 80-byte header. */
const BLOCK_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Mirrors the database CHECK on `lastProcessedHeight`; INTEGER is 32-bit. */
const MAX_BLOCK_HEIGHT = 2_147_483_647;

export interface NetworkHeaderCheckpointState {
  network: BitcoinNetwork;
  lastProcessedHeight: number;
  lastProcessedHash: string;
  observedAt: Date;
  coverageGapStartedAt: Date | null;
}

export interface HeaderObservation {
  height: number;
  hash: string;
  /**
   * The observed header's parent, from `previousBlockHashFromHeader`. Required:
   * heights alone cannot distinguish extending the known tip from replacing it,
   * because a one-block reorg also advances the height by exactly one.
   */
  previousHash: string;
}

export type HeaderObservationClassification =
  /** No persisted checkpoint: coverage before this height is unknown. */
  | 'first_observation'
  /** Exactly the persisted header again — no progress, nothing missed. */
  | 'duplicate'
  /** The next height, built on the persisted header — the only proven advance. */
  | 'contiguous'
  /** The next height, but built on a different parent: the tip was replaced. */
  | 'reorg_at_parent'
  /** Same height, different hash: the persisted header was reorganised away. */
  | 'same_height_different_hash'
  /** Below the persisted height: a reorg, a restore, or a different chain. */
  | 'height_decrease'
  /** Advanced by more than one block: the intervening headers were never seen. */
  | 'missed_gap';

export interface HeaderObservationVerdict {
  classification: HeaderObservationClassification;
  /**
   * True only when the observation proves no header was missed. Every other
   * classification — including the ambiguous ones — requires reconciliation.
   */
  covered: boolean;
  /** Inclusive span of heights never observed; null unless `missed_gap`. */
  missedHeights: { from: number; to: number } | null;
}

function assertValidHash(hash: string, description: string): void {
  if (typeof hash !== 'string' || !BLOCK_HASH_PATTERN.test(hash)) {
    throw new Error(`Invalid ${description} in header observation: expected 64 lowercase hex characters`);
  }
}

function assertValidObservation(observation: HeaderObservation): void {
  const { height } = observation;
  if (!Number.isInteger(height) || height < 0 || height > MAX_BLOCK_HEIGHT) {
    throw new Error(`Invalid block height in header observation: ${String(height)}`);
  }
  assertValidHash(observation.hash, 'block hash');
  assertValidHash(observation.previousHash, 'parent block hash');
}

/**
 * Decide what an observed header means relative to the persisted checkpoint.
 *
 * Pure and total: every ordering of the two heights maps to exactly one
 * classification, and only `duplicate` and `contiguous` report coverage.
 */
export function classifyHeaderObservation(
  persisted: NetworkHeaderCheckpointState | null,
  observation: HeaderObservation,
): HeaderObservationVerdict {
  assertValidObservation(observation);

  if (!persisted) {
    return { classification: 'first_observation', covered: false, missedHeights: null };
  }

  if (observation.height < persisted.lastProcessedHeight) {
    return { classification: 'height_decrease', covered: false, missedHeights: null };
  }

  if (observation.height === persisted.lastProcessedHeight) {
    const same = observation.hash === persisted.lastProcessedHash;
    return {
      classification: same ? 'duplicate' : 'same_height_different_hash',
      covered: same,
      missedHeights: null,
    };
  }

  if (observation.height === persisted.lastProcessedHeight + 1) {
    // The parent link is the whole point: without it a reorg that replaces the
    // persisted tip is indistinguishable from extending it.
    const extendsPersisted = observation.previousHash === persisted.lastProcessedHash;
    return {
      classification: extendsPersisted ? 'contiguous' : 'reorg_at_parent',
      covered: extendsPersisted,
      missedHeights: null,
    };
  }

  return {
    classification: 'missed_gap',
    covered: false,
    missedHeights: {
      from: persisted.lastProcessedHeight + 1,
      to: observation.height - 1,
    },
  };
}

interface PersistedHeaderCheckpointRow {
  network: string;
  lastProcessedHeight: number;
  lastProcessedHash: string;
  observedAt: Date;
  coverageGapStartedAt: Date | null;
}

function assertValidDate(value: unknown, description: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Persisted header checkpoint has an invalid ${description}`);
  }
}

/**
 * Reject a stored row we cannot trust. The database CHECK constraints already
 * enforce this shape, but a dump restored from before those constraints — or a
 * direct write — could still land here.
 */
function toCheckpointState(row: PersistedHeaderCheckpointRow): NetworkHeaderCheckpointState {
  const network = resolvePersistedBitcoinNetwork(row.network);
  if (!Number.isInteger(row.lastProcessedHeight)
    || row.lastProcessedHeight < 0
    || row.lastProcessedHeight > MAX_BLOCK_HEIGHT) {
    throw new Error(`Persisted header checkpoint for ${network} has an out-of-range height`);
  }
  if (!BLOCK_HASH_PATTERN.test(row.lastProcessedHash)) {
    throw new Error(`Persisted header checkpoint for ${network} has a malformed block hash`);
  }
  assertValidDate(row.observedAt, 'observation time');
  if (row.coverageGapStartedAt !== null) {
    assertValidDate(row.coverageGapStartedAt, 'coverage gap start');
  }
  return {
    network,
    lastProcessedHeight: row.lastProcessedHeight,
    lastProcessedHash: row.lastProcessedHash,
    observedAt: row.observedAt,
    coverageGapStartedAt: row.coverageGapStartedAt,
  };
}

/**
 * Read the durable checkpoint for a network.
 *
 * Returns `null` when no row exists — or when the stored row cannot be trusted.
 * Both mean UNKNOWN: callers must treat it as "coverage cannot be proven",
 * never as "the tip is current".
 *
 * An untrustworthy row degrades to UNKNOWN rather than throwing so one bad
 * checkpoint cannot permanently wedge sync for a network in a long-lived
 * worker. It is logged at error level because after the CHECK constraints
 * landed it can only mean corruption or an out-of-band write.
 */
export async function findNetworkHeaderCheckpoint(
  network: unknown,
): Promise<NetworkHeaderCheckpointState | null> {
  const resolved = resolvePersistedBitcoinNetwork(network);
  const row = await prisma.networkHeaderCheckpoint.findUnique({ where: { network: resolved } });
  if (!row) return null;

  try {
    return toCheckpointState(row);
  } catch (error) {
    log.error('Discarding untrustworthy persisted header checkpoint', {
      network: resolved,
      error: getErrorMessage(error),
    });
    return null;
  }
}

export const networkHeaderCheckpointRepository = {
  findNetworkHeaderCheckpoint,
  classifyHeaderObservation,
};

export default networkHeaderCheckpointRepository;
