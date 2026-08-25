import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  getExpectedGenesisHash,
  hashBlockHeader,
  previousBlockHashFromHeader,
} from '../bitcoin/networkIdentity';
import { withTimeout } from '../../utils/async';
import { ElectrumResponseValidationError } from '../bitcoin/electrum/types';
import type {
  NetworkHeaderReconciliationFailureClass,
  NetworkHeaderReconciliationState,
  ObserveNetworkHeaderInput,
  ReconciledHeaderRecord,
  ReconciliationFence,
} from '../../repositories/networkHeaderReconciliationTypes';
import { HeaderReconciliationOwnershipError } from '../../repositories/networkHeaderReconciliationTypes';
import type {
  HeaderRangeFetcher,
  HeaderReconciliationAttemptResult,
  NetworkHeaderReconcilerDependencies,
  RawHeaderObservation,
} from './networkHeaderReconcilerTypes';

export type {
  HeaderRangeFetcher,
  HeaderReconciliationAttemptResult,
  HeaderReconciliationRepositoryPort,
  NetworkHeaderReconcilerDependencies,
  RawHeaderObservation,
} from './networkHeaderReconcilerTypes';

export const NETWORK_HEADER_RECONCILIATION_PAGE_SIZE = 2016;
export const NETWORK_HEADER_RECONCILIATION_ATTEMPT_TIMEOUT_MS = 20_000;
export const NETWORK_HEADER_RECONCILIATION_RETRY_MS = 5_000;

class HeaderProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeaderProofError';
  }
}

class HeaderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeaderEndpointError';
  }
}

function fence(state: NetworkHeaderReconciliationState): ReconciliationFence {
  return {
    network: state.network,
    generation: state.generation,
    ownerToken: state.ownerToken,
  };
}

function assertActive(isActive: () => boolean): void {
  if (!isActive()) throw new HeaderReconciliationOwnershipError();
}

function parseHeaders(
  startHeight: number,
  headerHexes: string[],
  observedAt: Date,
): ReconciledHeaderRecord[] {
  try {
    return headerHexes.map((hex, index) => ({
      height: startHeight + index,
      hash: hashBlockHeader(hex),
      previousHash: previousBlockHashFromHeader(hex),
      observedAt,
    }));
  } catch (error) {
    throw new HeaderProofError(String(error));
  }
}

function assertLinked(headers: ReconciledHeaderRecord[], parentHash?: string): void {
  let expectedParent = parentHash;
  for (const header of headers) {
    if (expectedParent !== undefined && header.previousHash !== expectedParent) {
      throw new HeaderProofError(`Header ${header.height} does not extend the proven parent`);
    }
    expectedParent = header.hash;
  }
}

function expectedGenesis(network: NetworkType): string {
  return getExpectedGenesisHash(network);
}

function observationInput(
  network: NetworkType,
  ownerToken: string,
  observation: RawHeaderObservation,
  now: () => Date,
): ObserveNetworkHeaderInput {
  const observedAt = observation.observedAt ?? now();
  return {
    network,
    ownerToken,
    height: observation.height,
    hash: hashBlockHeader(observation.hex),
    previousHash: previousBlockHashFromHeader(observation.hex),
    headerHex: observation.hex,
    observedAt,
    genesisHash: expectedGenesis(network),
  };
}

async function exactFetch(
  fetchHeaders: HeaderRangeFetcher,
  startHeight: number,
  count: number,
  timeoutMs: number,
): Promise<string[]> {
  let headers: string[];
  try {
    headers = await withTimeout(
      fetchHeaders(startHeight, count),
      timeoutMs,
      `Header range ${startHeight}+${count} timed out`,
    );
  } catch (error) {
    if (error instanceof ElectrumResponseValidationError) {
      throw new HeaderProofError(error.message);
    }
    throw new HeaderEndpointError(
      error instanceof Error ? error.message : 'Header endpoint request failed',
    );
  }
  if (headers.length !== count) {
    throw new HeaderProofError(`Header range ${startHeight}+${count} returned ${headers.length}`);
  }
  return headers;
}

async function verifyGenesis(
  state: NetworkHeaderReconciliationState,
  fetchHeaders: HeaderRangeFetcher,
  timeoutMs: number,
  now: () => Date,
): Promise<ReconciledHeaderRecord> {
  const [genesis] = parseHeaders(
    0,
    await exactFetch(fetchHeaders, 0, 1, timeoutMs),
    now(),
  );
  if (genesis.hash !== expectedGenesis(state.network) || genesis.previousHash !== '0'.repeat(64)) {
    throw new HeaderProofError(`Genesis identity mismatch for ${state.network}`);
  }
  return genesis;
}

function matchingAncestor(
  local: ReconciledHeaderRecord[],
  remote: ReconciledHeaderRecord[],
): ReconciledHeaderRecord | null {
  const remoteHashes = new Map(remote.map(header => [header.height, header.hash]));
  return local.find(header => remoteHashes.get(header.height) === header.hash) ?? null;
}

/**
 * Build the resumable header state machine: verify genesis, prove an existing
 * anchor (or search the bounded tail), advance parent-linked pages, refresh one
 * durable confirmation-wallet page, then atomically promote the exact target.
 */
export function createNetworkHeaderReconciler(
  dependencies: NetworkHeaderReconcilerDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const pageSize = dependencies.pageSize ?? NETWORK_HEADER_RECONCILIATION_PAGE_SIZE;
  const timeoutMs = dependencies.attemptTimeoutMs
    ?? NETWORK_HEADER_RECONCILIATION_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = dependencies.retryDelayMs ?? NETWORK_HEADER_RECONCILIATION_RETRY_MS;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 2016) {
    throw new Error('Header reconciliation page size is invalid');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Header reconciliation timeout is invalid');
  }

  async function resetToGenesis(
    state: NetworkHeaderReconciliationState,
    isActive: () => boolean,
  ): Promise<NetworkHeaderReconciliationState> {
    assertActive(isActive);
    return dependencies.repository.resetCursor({
      ...fence(state),
      mode: 'genesis_rebuild',
      anchorHeight: 0,
      anchorHash: expectedGenesis(state.network),
    });
  }

  async function searchAncestor(
    state: NetworkHeaderReconciliationState,
    fetchHeaders: HeaderRangeFetcher,
    isActive: () => boolean,
  ): Promise<NetworkHeaderReconciliationState> {
    const local = await dependencies.repository.findHistory(
      state.network,
      state.targetHeight,
    );
    assertActive(isActive);
    if (local.length === 0) return resetToGenesis(state, isActive);
    const lowest = local[local.length - 1].height;
    const highest = local[0].height;
    const remote = parseHeaders(
      lowest,
      await exactFetch(fetchHeaders, lowest, highest - lowest + 1, timeoutMs),
      now(),
    );
    assertLinked(remote);
    assertActive(isActive);
    const ancestor = matchingAncestor(local, remote);
    if (!ancestor) return resetToGenesis(state, isActive);
    return dependencies.repository.resetCursor({
      ...fence(state),
      mode: 'forward',
      anchorHeight: ancestor.height,
      anchorHash: ancestor.hash,
    });
  }

  async function seedOrRevalidateCursor(
    state: NetworkHeaderReconciliationState,
    fetchHeaders: HeaderRangeFetcher,
    isActive: () => boolean,
  ): Promise<NetworkHeaderReconciliationState> {
    const height = state.cursorHeight ?? state.anchorHeight;
    const expectedHash = state.cursorHash ?? state.anchorHash;
    const [header] = parseHeaders(
      height,
      await exactFetch(fetchHeaders, height, 1, timeoutMs),
      now(),
    );
    assertActive(isActive);
    if (header.hash !== expectedHash) {
      return dependencies.repository.resetCursor({
        ...fence(state),
        mode: 'ancestor_search',
        anchorHeight: 0,
        anchorHash: expectedGenesis(state.network),
      });
    }
    if (state.cursorHeight !== null) return state;
    return dependencies.repository.recordCursor({
      ...fence(state),
      expectedCursor: null,
      headers: [header],
    });
  }

  async function advancePage(
    state: NetworkHeaderReconciliationState,
    fetchHeaders: HeaderRangeFetcher,
    isActive: () => boolean,
  ): Promise<NetworkHeaderReconciliationState> {
    if (state.cursorHeight === null || state.cursorHash === null) {
      throw new HeaderProofError('Header reconciliation cursor is unavailable');
    }
    const count = Math.min(pageSize, state.targetHeight - state.cursorHeight);
    const start = state.cursorHeight + 1;
    const headers = parseHeaders(
      start,
      await exactFetch(fetchHeaders, start, count, timeoutMs),
      now(),
    );
    assertLinked(headers, state.cursorHash);
    assertActive(isActive);
    const last = headers[headers.length - 1];
    if (last.height === state.targetHeight && last.hash !== state.targetHash) {
      throw new HeaderProofError('Fetched chain does not reach the observed target identity');
    }
    return dependencies.repository.recordCursor({
      ...fence(state),
      expectedCursor: { height: state.cursorHeight, hash: state.cursorHash },
      headers,
    });
  }

  async function finalizeIfComplete(
    state: NetworkHeaderReconciliationState,
    isActive: () => boolean,
  ): Promise<HeaderReconciliationAttemptResult | null> {
    if (state.cursorHeight !== state.targetHeight || state.cursorHash !== state.targetHash) {
      return null;
    }
    if (!state.confirmationEnumerationComplete) {
      let confirmation: Awaited<ReturnType<
        NetworkHeaderReconcilerDependencies['refreshConfirmations']
      >>;
      try {
        assertActive(isActive);
        confirmation = await dependencies.refreshConfirmations(
          state.network,
          state.targetHeight,
          state.confirmationCursorWalletId,
          isActive,
        );
        assertActive(isActive);
      } catch (_error) {
        assertActive(isActive);
        return defer(state, 'confirmation_failed', isActive);
      }
      assertActive(isActive);
      state = await dependencies.repository.recordNetworkHeaderConfirmationPage({
        ...fence(state),
        expectedCursor: state.confirmationCursorWalletId,
        cursor: confirmation.nextCursor,
        enumerationComplete: confirmation.enumerationComplete,
        attemptedWalletIds: confirmation.walletIds,
        failedWalletIds: confirmation.failures.map(({ walletId }) => walletId),
      });
      if (confirmation.failures.length > 0) {
        return defer(state, 'confirmation_failed', isActive);
      }
      return { status: 'progressed', state };
    }

    const retryWalletIds = await dependencies.repository.findNetworkHeaderConfirmationRetries(
      fence(state),
    );
    if (retryWalletIds.length > 0) {
      let retryResult: Awaited<ReturnType<
        NetworkHeaderReconcilerDependencies['refreshConfirmationRetryWallets']
      >>;
      try {
        assertActive(isActive);
        retryResult = await dependencies.refreshConfirmationRetryWallets(
          state.network,
          state.targetHeight,
          retryWalletIds,
          isActive,
        );
        assertActive(isActive);
      } catch (_error) {
        assertActive(isActive);
        return defer(state, 'confirmation_failed', isActive);
      }
      state = await dependencies.repository.recordNetworkHeaderConfirmationRetryResult({
        ...fence(state),
        attemptedWalletIds: retryWalletIds,
        failedWalletIds: retryResult.failures.map(({ walletId }) => walletId),
      });
      if (retryResult.failures.length > 0) {
        return defer(state, 'confirmation_failed', isActive);
      }
      return { status: 'progressed', state };
    }

    assertActive(isActive);
    const finalized = await dependencies.repository.finalize(fence(state));
    assertActive(isActive);
    if (finalized.continuation) {
      return { status: 'progressed', state: finalized.continuation };
    }
    dependencies.setAuthoritativeHeight(state.targetHeight, state.network);
    return { status: 'complete', height: state.targetHeight, hash: state.targetHash };
  }

  async function defer(
    state: NetworkHeaderReconciliationState,
    failureClass: NetworkHeaderReconciliationFailureClass,
    isActive: () => boolean,
  ): Promise<HeaderReconciliationAttemptResult> {
    assertActive(isActive);
    const recorded = await dependencies.repository.recordFailure({
      ...fence(state),
      failureClass,
      retryDelayMs,
    });
    return {
      status: 'deferred',
      failureClass: recorded ? failureClass : 'ownership_lost',
    };
  }

  function knownFailureClass(error: unknown): NetworkHeaderReconciliationFailureClass | null {
    if (error instanceof HeaderProofError) return 'validation_failed';
    if (error instanceof HeaderEndpointError) return 'endpoint_unavailable';
    return null;
  }

  async function attempt(
    initial: NetworkHeaderReconciliationState,
    fetchHeaders: HeaderRangeFetcher,
    isActive: () => boolean = () => true,
  ): Promise<HeaderReconciliationAttemptResult> {
    let state = initial;
    try {
      assertActive(isActive);
      await verifyGenesis(state, fetchHeaders, timeoutMs, now);
      assertActive(isActive);
      if (state.mode === 'ancestor_search') {
        state = await searchAncestor(state, fetchHeaders, isActive);
        return { status: 'progressed', state };
      }
      state = await seedOrRevalidateCursor(state, fetchHeaders, isActive);
      if (state.mode === 'ancestor_search') return { status: 'progressed', state };
      const beforeAdvance = await finalizeIfComplete(state, isActive);
      if (beforeAdvance) return beforeAdvance;
      state = await advancePage(state, fetchHeaders, isActive);
      const afterAdvance = await finalizeIfComplete(state, isActive);
      return afterAdvance ?? { status: 'progressed', state };
    } catch (error) {
      if (error instanceof HeaderReconciliationOwnershipError) {
        return { status: 'deferred', failureClass: 'ownership_lost' };
      }
      const classified = knownFailureClass(error);
      if (classified) return defer(state, classified, isActive);
      throw error;
    }
  }

  async function observe(
    network: NetworkType,
    ownerToken: string,
    observation: RawHeaderObservation,
    fetchHeaders: HeaderRangeFetcher,
    isActive: () => boolean = () => true,
  ): Promise<HeaderReconciliationAttemptResult> {
    assertActive(isActive);
    const state = await dependencies.repository.observe(
      observationInput(network, ownerToken, observation, now),
    );
    assertActive(isActive);
    if (state.lastFailureClass && state.retryEligibleAt.getTime() > now().getTime()) {
      return { status: 'deferred', failureClass: state.lastFailureClass };
    }
    return attempt(state, fetchHeaders, isActive);
  }

  return { attempt, observe };
}

export type NetworkHeaderReconciler = ReturnType<typeof createNetworkHeaderReconciler>;
