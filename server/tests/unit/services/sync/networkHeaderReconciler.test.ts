import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNetworkHeaderReconciler,
  type HeaderReconciliationRepositoryPort,
  type RawHeaderObservation,
} from '../../../../src/services/sync/networkHeaderReconciler';
import {
  hashBlockHeader,
  previousBlockHashFromHeader,
} from '../../../../src/services/bitcoin/networkIdentity';
import type {
  NetworkHeaderFinalizationResult,
  NetworkHeaderReconciliationState,
  ObserveNetworkHeaderInput,
  ReconciledHeaderRecord,
  ReconciliationFence,
} from '../../../../src/repositories/networkHeaderReconciliationTypes';
import { HeaderReconciliationOwnershipError } from '../../../../src/repositories/networkHeaderReconciliationTypes';
import { ElectrumResponseValidationError } from '../../../../src/services/bitcoin/electrum/types';

const REGTEST_GENESIS =
  '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff7f2002000000';
const OBSERVED_AT = new Date('2026-08-24T10:00:00.000Z');
const OWNER = 'owner-token-1234567890';

function childHeader(parentHash: string, nonce: number): string {
  const version = '01000000';
  const parent = Buffer.from(parentHash, 'hex').reverse().toString('hex');
  const tail = `${nonce.toString(16).padStart(8, '0')}${'00'.repeat(40)}`;
  const header = `${version}${parent}${tail}`;
  expect(header).toHaveLength(160);
  return header;
}

function chain(length: number): string[] {
  const headers = [REGTEST_GENESIS];
  while (headers.length < length) {
    headers.push(childHeader(hashBlockHeader(headers[headers.length - 1]), headers.length));
  }
  return headers;
}

function record(height: number, hex: string): ReconciledHeaderRecord {
  return {
    height,
    hash: hashBlockHeader(hex),
    previousHash: previousBlockHashFromHeader(hex),
    observedAt: OBSERVED_AT,
  };
}

function stateFor(headers: string[], targetHeight: number): NetworkHeaderReconciliationState {
  return {
    network: 'regtest',
    generation: 1,
    ownerToken: OWNER,
    mode: 'genesis_rebuild',
    targetHeight,
    targetHash: hashBlockHeader(headers[targetHeight]),
    targetHeaderHex: headers[targetHeight],
    targetObservedAt: OBSERVED_AT,
    anchorHeight: 0,
    anchorHash: hashBlockHeader(headers[0]),
    cursorHeight: null,
    cursorHash: null,
    confirmationCursorWalletId: null,
    confirmationEnumerationComplete: false,
    pendingTargetHeight: null,
    pendingTargetHash: null,
    pendingTargetPreviousHash: null,
    pendingTargetHeaderHex: null,
    pendingTargetObservedAt: null,
    pendingTargetGenesisHash: null,
    gapStartedAt: OBSERVED_AT,
    lastAttemptAt: null,
    lastFailureClass: null,
    consecutiveFailureCount: 0,
    retryEligibleAt: OBSERVED_AT,
  };
}

function observation(headers: string[], height: number): RawHeaderObservation {
  return { height, hex: headers[height], observedAt: OBSERVED_AT };
}

function createHarness(initial: NetworkHeaderReconciliationState) {
  let state = { ...initial };
  const history: ReconciledHeaderRecord[] = [];
  let confirmationRetryWalletIds: string[] = [];
  const repository = {
    observe: vi.fn(async (_input: ObserveNetworkHeaderInput) => state),
    recordCursor: vi.fn(async (
      input: Parameters<HeaderReconciliationRepositoryPort['recordCursor']>[0],
    ) => {
      const last = input.headers[input.headers.length - 1];
      state = {
        ...state,
        mode: 'forward',
        cursorHeight: last.height,
        cursorHash: last.hash,
      };
      return state;
    }),
    recordNetworkHeaderConfirmationPage: vi.fn(async (input: ReconciliationFence & {
      expectedCursor: string | null;
      cursor: string | null;
      enumerationComplete: boolean;
      attemptedWalletIds: string[];
      failedWalletIds: string[];
    }) => {
      confirmationRetryWalletIds = [
        ...new Set([...confirmationRetryWalletIds, ...input.failedWalletIds]),
      ];
      state = {
        ...state,
        confirmationCursorWalletId: input.cursor,
        confirmationEnumerationComplete: input.enumerationComplete,
      };
      return state;
    }),
    findNetworkHeaderConfirmationRetries: vi.fn(async () => confirmationRetryWalletIds),
    recordNetworkHeaderConfirmationRetryResult: vi.fn(async (input: ReconciliationFence & {
      attemptedWalletIds: string[];
      failedWalletIds: string[];
    }) => {
      const attempted = new Set(input.attemptedWalletIds);
      confirmationRetryWalletIds = confirmationRetryWalletIds.filter(walletId => (
        !attempted.has(walletId) || input.failedWalletIds.includes(walletId)
      ));
      return state;
    }),
    resetCursor: vi.fn(async (
      input: Parameters<HeaderReconciliationRepositoryPort['resetCursor']>[0],
    ) => {
      state = {
        ...state,
        generation: state.generation + 1,
        mode: input.mode,
        anchorHeight: input.anchorHeight,
        anchorHash: input.anchorHash,
        cursorHeight: null,
        cursorHash: null,
      };
      return state;
    }),
    recordFailure: vi.fn(async (input: Parameters<HeaderReconciliationRepositoryPort['recordFailure']>[0]) => {
      state = {
        ...state,
        lastFailureClass: input.failureClass,
        consecutiveFailureCount: state.consecutiveFailureCount + 1,
      };
      return true;
    }),
    findHistory: vi.fn(async () => history),
    finalize: vi.fn(async (): Promise<NetworkHeaderFinalizationResult> => ({
      checkpoint: {
        network: state.network,
        lastProcessedHeight: state.targetHeight,
        lastProcessedHash: state.targetHash,
        observedAt: state.targetObservedAt,
        coverageGapStartedAt: null,
      },
      continuation: null,
    })),
  };
  const refreshConfirmations = vi.fn().mockResolvedValue({
    walletIds: [],
    failures: [],
    nextCursor: null,
    enumerationComplete: true,
  });
  const refreshConfirmationRetryWallets = vi.fn().mockResolvedValue({ failures: [] });
  const setAuthoritativeHeight = vi.fn();
  const dependencies = {
    repository: repository as unknown as HeaderReconciliationRepositoryPort,
    refreshConfirmations,
    refreshConfirmationRetryWallets,
    setAuthoritativeHeight,
    now: () => OBSERVED_AT,
    pageSize: 2,
    attemptTimeoutMs: 1_000,
    retryDelayMs: 250,
  };
  const reconciler = createNetworkHeaderReconciler(dependencies);
  return {
    get state() { return state; },
    get confirmationRetryWalletIds() { return confirmationRetryWalletIds; },
    setConfirmationRetryWalletIds(walletIds: string[]) {
      confirmationRetryWalletIds = [...walletIds];
    },
    history,
    repository,
    refreshConfirmations,
    refreshConfirmationRetryWallets,
    setAuthoritativeHeight,
    reconciler,
  };
}

function rangeFetcher(headers: string[]) {
  return vi.fn(async (start: number, count: number) => headers.slice(start, start + count));
}

beforeEach(() => vi.clearAllMocks());

describe('networkHeaderReconciler', () => {
  it('bootstraps a high tip in bounded resumable pages and finalizes only at the target', async () => {
    const headers = chain(4);
    const harness = createHarness(stateFor(headers, 3));
    const fetch = rangeFetcher(headers);

    await expect(harness.reconciler.observe('regtest', OWNER, observation(headers, 3), fetch))
      .resolves.toMatchObject({ status: 'progressed', state: { cursorHeight: 2 } });
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.refreshConfirmations).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(1, 2);

    await expect(harness.reconciler.attempt(harness.state, fetch)).resolves.toMatchObject({
      status: 'progressed',
      state: { confirmationEnumerationComplete: true },
    });
    expect(harness.refreshConfirmations).toHaveBeenCalledWith(
      'regtest',
      3,
      null,
      expect.any(Function),
    );

    await expect(harness.reconciler.attempt(harness.state, fetch)).resolves.toEqual({
      status: 'complete',
      height: 3,
      hash: hashBlockHeader(headers[3]),
    });
    expect(harness.repository.finalize).toHaveBeenCalledOnce();
    expect(harness.setAuthoritativeHeight).toHaveBeenCalledWith(3, 'regtest');
    expect(fetch.mock.calls.every(([, count]) => count <= 2)).toBe(true);
  });

  it('retains the proven cursor and durable gap when a page is partial', async () => {
    const headers = chain(4);
    const initial = stateFor(headers, 3);
    initial.mode = 'forward';
    initial.cursorHeight = 0;
    initial.cursorHash = hashBlockHeader(headers[0]);
    const harness = createHarness(initial);
    const fetch = vi.fn(async (start: number, count: number) => (
      start === 1 ? headers.slice(1, 1 + count - 1) : headers.slice(start, start + count)
    ));

    await expect(harness.reconciler.attempt(harness.state, fetch)).resolves.toEqual({
      status: 'deferred',
      failureClass: 'validation_failed',
    });
    expect(harness.state.cursorHeight).toBe(0);
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'validation_failed',
      retryDelayMs: 250,
    }));
  });

  it('persists failed candidate IDs and continues from the enumerated page cursor', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    const harness = createHarness(initial);
    harness.refreshConfirmations
      .mockResolvedValueOnce({
        walletIds: ['wallet-z', 'wallet-a'],
        failures: [{ walletId: 'wallet-z', error: new Error('wallet locked') }],
        nextCursor: 'wallet-a',
        enumerationComplete: false,
      })
      .mockResolvedValueOnce({
        walletIds: ['wallet-c', 'wallet-d'],
        failures: [],
        nextCursor: 'wallet-d',
        enumerationComplete: true,
      });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'confirmation_failed' });
    expect(harness.state.confirmationCursorWalletId).toBe('wallet-a');
    expect(harness.repository.recordNetworkHeaderConfirmationPage).toHaveBeenCalledWith({
      network: 'regtest',
      generation: 1,
      ownerToken: OWNER,
      expectedCursor: null,
      cursor: 'wallet-a',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-z', 'wallet-a'],
      failedWalletIds: ['wallet-z'],
    });
    expect(harness.confirmationRetryWalletIds).toEqual(['wallet-z']);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toMatchObject({
        status: 'progressed',
        state: { confirmationCursorWalletId: 'wallet-d' },
      });
    expect(harness.refreshConfirmations).toHaveBeenNthCalledWith(
      2,
      'regtest',
      1,
      'wallet-a',
      expect.any(Function),
    );
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.setAuthoritativeHeight).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'confirmation_failed',
    }));
  });

  it('preserves and escalates backoff when every enumerated wallet fails', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    Object.assign(initial, {
      mode: 'forward',
      cursorHeight: 1,
      cursorHash: hashBlockHeader(headers[1]),
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 2,
    });
    const harness = createHarness(initial);
    harness.refreshConfirmations.mockResolvedValueOnce({
      walletIds: ['wallet-z', 'wallet-a'],
      failures: [
        { walletId: 'wallet-z', error: new Error('wallet locked') },
        { walletId: 'wallet-a', error: new Error('wallet locked') },
      ],
      nextCursor: 'wallet-a',
      enumerationComplete: true,
    });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'confirmation_failed' });

    expect(harness.repository.recordNetworkHeaderConfirmationPage).toHaveBeenCalledWith({
      network: 'regtest',
      generation: 1,
      ownerToken: OWNER,
      expectedCursor: null,
      cursor: 'wallet-a',
      enumerationComplete: true,
      attemptedWalletIds: ['wallet-z', 'wallet-a'],
      failedWalletIds: ['wallet-z', 'wallet-a'],
    });
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'confirmation_failed',
      retryDelayMs: 250,
    }));
    expect(harness.repository.recordNetworkHeaderConfirmationPage.mock.invocationCallOrder[0])
      .toBeLessThan(harness.repository.recordFailure.mock.invocationCallOrder[0]);
    expect(harness.state).toMatchObject({
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 3,
    });
  });

  it('resumes enumeration after restart and drains durable retry IDs before finalizing', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    initial.confirmationCursorWalletId = 'wallet-b';
    const harness = createHarness(initial);
    harness.setConfirmationRetryWalletIds(['wallet-a']);
    harness.refreshConfirmations.mockResolvedValueOnce({
      walletIds: ['wallet-c', 'wallet-d'],
      failures: [],
      nextCursor: 'wallet-d',
      enumerationComplete: true,
    });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toMatchObject({
        status: 'progressed',
        state: { confirmationCursorWalletId: 'wallet-d' },
      });
    expect(harness.refreshConfirmations).toHaveBeenCalledWith(
      'regtest',
      1,
      'wallet-b',
      expect.any(Function),
    );
    expect(harness.repository.finalize).not.toHaveBeenCalled();

    harness.refreshConfirmationRetryWallets.mockResolvedValueOnce({ failures: [] });
    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toMatchObject({ status: 'progressed' });
    expect(harness.repository.findNetworkHeaderConfirmationRetries).toHaveBeenCalledWith({
      network: 'regtest',
      generation: 1,
      ownerToken: OWNER,
    });
    expect(harness.refreshConfirmationRetryWallets).toHaveBeenCalledWith(
      'regtest',
      1,
      ['wallet-a'],
      expect.any(Function),
    );
    expect(harness.repository.recordNetworkHeaderConfirmationRetryResult).toHaveBeenCalledWith({
      network: 'regtest',
      generation: 1,
      ownerToken: OWNER,
      attemptedWalletIds: ['wallet-a'],
      failedWalletIds: [],
    });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toMatchObject({ status: 'complete' });
    expect(harness.repository.finalize).toHaveBeenCalledOnce();
    expect(harness.setAuthoritativeHeight).toHaveBeenCalledWith(1, 'regtest');
  });

  it('keeps a persistent retry failure unresolved without blocking later retry IDs', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    Object.assign(initial, { confirmationEnumerationComplete: true });
    const harness = createHarness(initial);
    harness.setConfirmationRetryWalletIds(['wallet-a', 'wallet-b']);
    harness.refreshConfirmationRetryWallets.mockResolvedValueOnce({
      failures: [{ walletId: 'wallet-a', error: new Error('still locked') }],
    });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'confirmation_failed' });
    expect(harness.refreshConfirmationRetryWallets).toHaveBeenCalledWith(
      'regtest',
      1,
      ['wallet-a', 'wallet-b'],
      expect.any(Function),
    );
    expect(harness.repository.recordNetworkHeaderConfirmationRetryResult).toHaveBeenCalledWith({
      network: 'regtest',
      generation: 1,
      ownerToken: OWNER,
      attemptedWalletIds: ['wallet-a', 'wallet-b'],
      failedWalletIds: ['wallet-a'],
    });
    expect(harness.confirmationRetryWalletIds).toEqual(['wallet-a']);
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'confirmation_failed',
    }));
  });

  it('classifies a rejected durable retry refresh as confirmation failure', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    Object.assign(initial, { confirmationEnumerationComplete: true });
    const harness = createHarness(initial);
    harness.setConfirmationRetryWalletIds(['wallet-a']);
    harness.refreshConfirmationRetryWallets.mockRejectedValueOnce(
      new Error('retry backend unavailable'),
    );

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'confirmation_failed' });

    expect(harness.repository.recordNetworkHeaderConfirmationRetryResult)
      .not.toHaveBeenCalled();
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'confirmation_failed',
    }));
  });

  it('reports progressed and suppresses old-target publication when finalize rolls forward', async () => {
    const headers = chain(3);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    Object.assign(initial, { confirmationEnumerationComplete: true });
    const continuation = {
      ...stateFor(headers, 2),
      generation: 2,
      mode: 'forward' as const,
      anchorHeight: 1,
      anchorHash: hashBlockHeader(headers[1]),
      cursorHeight: 1,
      cursorHash: hashBlockHeader(headers[1]),
    };
    const harness = createHarness(initial);
    harness.repository.finalize.mockResolvedValueOnce({
      checkpoint: {
        network: 'regtest',
        lastProcessedHeight: 1,
        lastProcessedHash: hashBlockHeader(headers[1]),
        observedAt: OBSERVED_AT,
        coverageGapStartedAt: OBSERVED_AT,
      },
      continuation,
    });

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'progressed', state: continuation });

    expect(harness.repository.finalize).toHaveBeenCalledOnce();
    expect(harness.setAuthoritativeHeight).not.toHaveBeenCalled();
  });

  it('publishes the completed target only when finalize has no continuation', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    Object.assign(initial, { confirmationEnumerationComplete: true });
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({
        status: 'complete',
        height: 1,
        hash: hashBlockHeader(headers[1]),
      });

    expect(harness.repository.finalize).toHaveBeenCalledOnce();
    expect(harness.setAuthoritativeHeight).toHaveBeenCalledWith(1, 'regtest');
  });

  it('does not let repeated observations bypass persisted failure backoff', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.lastFailureClass = 'validation_failed';
    initial.consecutiveFailureCount = 2;
    initial.retryEligibleAt = new Date(OBSERVED_AT.getTime() + 60_000);
    const harness = createHarness(initial);
    const fetch = rangeFetcher(headers);

    await expect(harness.reconciler.observe(
      'regtest',
      OWNER,
      observation(headers, 1),
      fetch,
    )).resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });

    expect(fetch).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).not.toHaveBeenCalled();
  });

  it('does not finalize or write failure evidence after runtime ownership is lost', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    const harness = createHarness(initial);
    let active = true;
    harness.refreshConfirmations.mockImplementationOnce(async () => {
      active = false;
      return { walletIds: [], failures: [], nextCursor: null, enumerationComplete: true };
    });

    await expect(harness.reconciler.attempt(
      harness.state,
      rangeFetcher(headers),
      () => active,
    )).resolves.toEqual({ status: 'deferred', failureClass: 'ownership_lost' });
    expect(harness.repository.finalize).not.toHaveBeenCalled();
    expect(harness.repository.recordFailure).not.toHaveBeenCalled();
    expect(harness.setAuthoritativeHeight).not.toHaveBeenCalled();
  });

  it('classifies a thrown confirmation updater failure as confirmation failure', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(headers[1]);
    const harness = createHarness(initial);
    harness.refreshConfirmations.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'confirmation_failed' });
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'confirmation_failed',
    }));
    expect(harness.repository.finalize).not.toHaveBeenCalled();
  });

  it('reports ownership loss without writing failure evidence through a stale fence', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 0;
    initial.cursorHash = hashBlockHeader(headers[0]);
    const harness = createHarness(initial);
    harness.repository.recordCursor = vi.fn().mockRejectedValue(
      new HeaderReconciliationOwnershipError(),
    );

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'ownership_lost' });
    expect(harness.repository.recordFailure).not.toHaveBeenCalled();
  });

  it('reports ownership loss when the failure-evidence CAS no longer matches', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 0;
    initial.cursorHash = hashBlockHeader(headers[0]);
    const harness = createHarness(initial);
    harness.repository.recordFailure = vi.fn().mockResolvedValue(false);
    const fetch = vi.fn().mockRejectedValue(new Error('endpoint offline'));

    await expect(harness.reconciler.attempt(harness.state, fetch))
      .resolves.toEqual({ status: 'deferred', failureClass: 'ownership_lost' });
  });

  it('classifies a rejected Electrum request as endpoint unavailability', async () => {
    const headers = chain(2);
    const harness = createHarness(stateFor(headers, 1));
    const fetch = vi.fn().mockRejectedValue(new Error('socket closed'));

    await expect(harness.reconciler.attempt(harness.state, fetch))
      .resolves.toEqual({ status: 'deferred', failureClass: 'endpoint_unavailable' });
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'endpoint_unavailable',
    }));
  });

  it('classifies a malformed Electrum range response as validation failure', async () => {
    const headers = chain(2);
    const harness = createHarness(stateFor(headers, 1));
    const fetch = vi.fn().mockRejectedValue(
      new ElectrumResponseValidationError('header count mismatch'),
    );

    await expect(harness.reconciler.attempt(harness.state, fetch))
      .resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });
    expect(harness.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureClass: 'validation_failed',
    }));
  });

  it('invalidates staged progress when cursor revalidation sees a reorg', async () => {
    const headers = chain(4);
    const replacement = [...headers];
    replacement[2] = childHeader(hashBlockHeader(headers[1]), 99);
    replacement[3] = childHeader(hashBlockHeader(replacement[2]), 100);
    const initial = stateFor(headers, 3);
    initial.mode = 'forward';
    initial.cursorHeight = 2;
    initial.cursorHash = hashBlockHeader(headers[2]);
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(replacement)))
      .resolves.toMatchObject({ status: 'progressed', state: { mode: 'ancestor_search' } });
    expect(harness.repository.resetCursor).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'ancestor_search',
    }));
    expect(harness.repository.finalize).not.toHaveBeenCalled();
  });

  it('switches to ancestor search when the next page no longer extends the proven cursor', async () => {
    const oldChain = chain(4);
    const replacement = oldChain.slice(0, 1);
    replacement.push(childHeader(hashBlockHeader(replacement[0]), 70));
    replacement.push(childHeader(hashBlockHeader(replacement[1]), 71));
    replacement.push(childHeader(hashBlockHeader(replacement[2]), 72));
    const initial = stateFor(replacement, 3);
    initial.mode = 'forward';
    initial.cursorHeight = 1;
    initial.cursorHash = hashBlockHeader(oldChain[1]);
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(replacement)))
      .resolves.toMatchObject({ status: 'progressed', state: { mode: 'ancestor_search' } });
    expect(harness.repository.resetCursor).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'ancestor_search',
    }));
    expect(harness.repository.recordFailure).not.toHaveBeenCalled();
  });

  it('finds the highest retained common ancestor before replaying a shallow reorg', async () => {
    const oldChain = chain(5);
    const liveChain = oldChain.slice(0, 3);
    liveChain.push(childHeader(hashBlockHeader(liveChain[2]), 90));
    liveChain.push(childHeader(hashBlockHeader(liveChain[3]), 91));
    const initial = stateFor(liveChain, 4);
    initial.mode = 'ancestor_search';
    const harness = createHarness(initial);
    harness.history.push(...oldChain.map((hex, height) => record(height, hex)).reverse());

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(liveChain)))
      .resolves.toMatchObject({
        status: 'progressed',
        state: { mode: 'forward', anchorHeight: 2, anchorHash: hashBlockHeader(oldChain[2]) },
      });
    expect(harness.repository.resetCursor).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'forward',
      anchorHeight: 2,
    }));
  });

  it('falls back to a resumable genesis rebuild when no retained ancestor matches', async () => {
    const oldChain = chain(3);
    const liveChain = [REGTEST_GENESIS];
    liveChain.push(childHeader(hashBlockHeader(liveChain[0]), 501));
    liveChain.push(childHeader(hashBlockHeader(liveChain[1]), 502));
    const initial = stateFor(liveChain, 2);
    initial.mode = 'ancestor_search';
    const harness = createHarness(initial);
    harness.history.push(...oldChain.slice(1).map((hex, index) => record(index + 1, hex)).reverse());

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(liveChain)))
      .resolves.toMatchObject({
        status: 'progressed',
        state: { mode: 'genesis_rebuild', anchorHeight: 0 },
      });
  });

  it('falls back to genesis when no canonical history is retained', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'ancestor_search';
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toMatchObject({
        status: 'progressed',
        state: { mode: 'genesis_rebuild', anchorHeight: 0 },
      });
    expect(harness.repository.findHistory).toHaveBeenCalledOnce();
  });

  it('rejects a remotely broken ancestor-search chain', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'ancestor_search';
    const harness = createHarness(initial);
    harness.history.push(record(1, headers[1]), record(0, headers[0]));
    const broken = [headers[0], childHeader('f'.repeat(64), 99)];

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(broken)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });
    expect(harness.repository.resetCursor).not.toHaveBeenCalled();
  });

  it('rejects malformed header bytes returned inside an exact range', async () => {
    const headers = chain(2);
    const harness = createHarness(stateFor(headers, 1));
    const fetch = vi.fn(async (start: number) => (
      start === 0 ? [headers[0]] : ['not-a-header']
    ));

    await expect(harness.reconciler.attempt(harness.state, fetch))
      .resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });
  });

  it('classifies a non-Error endpoint rejection without losing durable work', async () => {
    const headers = chain(2);
    const harness = createHarness(stateFor(headers, 1));

    await expect(harness.reconciler.attempt(
      harness.state,
      vi.fn().mockRejectedValue('offline'),
    )).resolves.toEqual({ status: 'deferred', failureClass: 'endpoint_unavailable' });
  });

  it('rejects an incomplete cursor before page advancement', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 0;
    initial.cursorHash = null;
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });
  });

  it('rejects a fetched page whose terminal identity differs from the observed target', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'forward';
    initial.cursorHeight = 0;
    initial.cursorHash = hashBlockHeader(headers[0]);
    initial.targetHash = 'f'.repeat(64);
    const harness = createHarness(initial);

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .resolves.toEqual({ status: 'deferred', failureClass: 'validation_failed' });
    expect(harness.repository.recordCursor).not.toHaveBeenCalled();
  });

  it('propagates an unexpected storage failure without misclassifying it', async () => {
    const headers = chain(2);
    const initial = stateFor(headers, 1);
    initial.mode = 'ancestor_search';
    const harness = createHarness(initial);
    harness.repository.findHistory = vi.fn().mockRejectedValue(new Error('storage unavailable'));

    await expect(harness.reconciler.attempt(harness.state, rangeFetcher(headers)))
      .rejects.toThrow('storage unavailable');
    expect(harness.repository.recordFailure).not.toHaveBeenCalled();
  });

  it('uses production defaults and timestamps an observation that omits observedAt', async () => {
    const headers = chain(1);
    const harness = createHarness(stateFor(headers, 0));
    const reconciler = createNetworkHeaderReconciler({
      repository: harness.repository,
      refreshConfirmations: harness.refreshConfirmations,
      refreshConfirmationRetryWallets: harness.refreshConfirmationRetryWallets,
      setAuthoritativeHeight: harness.setAuthoritativeHeight,
    });

    await expect(reconciler.observe(
      'regtest',
      OWNER,
      { height: 0, hex: headers[0] },
      rangeFetcher(headers),
    )).resolves.toMatchObject({
      status: 'progressed',
      state: { confirmationEnumerationComplete: true },
    });
    await expect(reconciler.attempt(
      harness.state,
      rangeFetcher(headers),
    )).resolves.toMatchObject({ status: 'complete', height: 0 });
    expect(harness.repository.observe).toHaveBeenCalledWith(expect.objectContaining({
      observedAt: expect.any(Date),
    }));
  });

  it.each([0, 2017, 1.5])('rejects invalid reconciliation page size %s', pageSize => {
    const headers = chain(1);
    const harness = createHarness(stateFor(headers, 0));
    expect(() => createNetworkHeaderReconciler({
      repository: harness.repository,
      refreshConfirmations: harness.refreshConfirmations,
      refreshConfirmationRetryWallets: harness.refreshConfirmationRetryWallets,
      setAuthoritativeHeight: harness.setAuthoritativeHeight,
      pageSize,
    })).toThrow('page size is invalid');
  });

  it.each([0, 1.5])('rejects invalid reconciliation timeout %s', attemptTimeoutMs => {
    const headers = chain(1);
    const harness = createHarness(stateFor(headers, 0));
    expect(() => createNetworkHeaderReconciler({
      repository: harness.repository,
      refreshConfirmations: harness.refreshConfirmations,
      refreshConfirmationRetryWallets: harness.refreshConfirmationRetryWallets,
      setAuthoritativeHeight: harness.setAuthoritativeHeight,
      attemptTimeoutMs,
    })).toThrow('timeout is invalid');
  });

  it('rejects a wrong-network genesis before cursor or confirmation work', async () => {
    const headers = chain(2);
    const harness = createHarness(stateFor(headers, 1));
    const wrongGenesis = `${'01'.repeat(4)}${'00'.repeat(76)}`;
    const fetch = vi.fn(async (start: number, count: number) => (
      start === 0 ? [wrongGenesis] : headers.slice(start, start + count)
    ));

    await expect(harness.reconciler.attempt(harness.state, fetch)).resolves.toEqual({
      status: 'deferred',
      failureClass: 'validation_failed',
    });
    expect(harness.repository.recordCursor).not.toHaveBeenCalled();
    expect(harness.refreshConfirmations).not.toHaveBeenCalled();
  });
});
