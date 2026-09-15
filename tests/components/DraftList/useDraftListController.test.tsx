/**
 * Tests for useDraftListController wallet-switch scoping.
 *
 * Finding: `draftlist-wallet-switch-stale-load-overwrite`. DraftsTab mounts
 * DraftList without a `key`, so the same controller instance survives a
 * wallet switch — a load started for the previous wallet must not be
 * allowed to apply its result (or its error) once the wallet has moved on,
 * and the visible list must clear synchronously the moment `walletId`
 * changes, before any new load resolves.
 */

import { act,renderHook,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useDraftListController } from '../../../src/components/DraftList/useDraftListController';
import { DraftTransaction } from '../../../src/api/drafts';
import { WalletType } from '../../../src/types';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  usePriceFreeFormatter: () => ({ format: (sats: number) => `${sats} sats` }),
}));

const mockGetDrafts = vi.fn();
vi.mock('../../../src/api/drafts', () => ({
  getDrafts: (...args: unknown[]) => mockGetDrafts(...args),
  deleteDraft: vi.fn(),
  updateDraft: vi.fn(),
}));

const makeDraft = (overrides: Partial<DraftTransaction> = {}): DraftTransaction => ({
  id: 'draft-1',
  walletId: 'wallet-A',
  name: 'Draft',
  status: 'unsigned',
  recipient: 'bc1qrecipient...',
  effectiveAmount: 50000,
  fee: 1000,
  feeRate: 10,
  totalInput: 60000,
  totalOutput: 59000,
  changeAmount: 8000,
  changeAddress: 'bc1qchange...',
  psbtBase64: 'cHNidP8=',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  outputs: [{ address: 'bc1qrecipient...', amount: 50000 }],
  ...overrides,
} as DraftTransaction);

describe('useDraftListController wallet switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes a resolved load to the currently mounted wallet when a stale load resolves late', async () => {
    const deferreds: Deferred<DraftTransaction[]>[] = [];
    mockGetDrafts.mockImplementation(() => {
      const deferred = createDeferred<DraftTransaction[]>();
      deferreds.push(deferred);
      return deferred.promise;
    });
    const onDraftsChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ walletId }: { walletId: string }) => useDraftListController({
        walletId,
        walletType: WalletType.SINGLE_SIG,
        onDraftsChange,
      }),
      { initialProps: { walletId: 'wallet-A' } },
    );

    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalledTimes(1));

    // Switch to wallet B while A's load is still pending.
    rerender({ walletId: 'wallet-B' });

    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalledTimes(2));

    // Resolve B's load first, then A's stale load late.
    await act(async () => {
      deferreds[1].resolve([makeDraft({ id: 'draft-b', walletId: 'wallet-B' })]);
    });
    await act(async () => {
      deferreds[0].resolve([makeDraft({ id: 'draft-a1' }), makeDraft({ id: 'draft-a2' })]);
    });

    await waitFor(() => expect(result.current.drafts).toHaveLength(1));
    expect(result.current.drafts[0].id).toBe('draft-b');
    expect(onDraftsChange).toHaveBeenLastCalledWith(1);
    expect(onDraftsChange).not.toHaveBeenCalledWith(2);
  });

  it('clears the list synchronously when the wallet switches, before any refetch resolves', async () => {
    mockGetDrafts.mockResolvedValue([makeDraft({ id: 'draft-a' })]);

    const { result, rerender } = renderHook(
      ({ walletId }: { walletId: string }) => useDraftListController({
        walletId,
        walletType: WalletType.SINGLE_SIG,
      }),
      { initialProps: { walletId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.drafts).toHaveLength(1));

    rerender({ walletId: 'wallet-B' });
    expect(result.current.drafts).toHaveLength(0);

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('does not surface a stale load error when the wallet switches before the fetch rejects', async () => {
    const deferreds: Deferred<DraftTransaction[]>[] = [];
    mockGetDrafts.mockImplementation(() => {
      const deferred = createDeferred<DraftTransaction[]>();
      deferreds.push(deferred);
      return deferred.promise;
    });

    const { result, rerender } = renderHook(
      ({ walletId }: { walletId: string }) => useDraftListController({
        walletId,
        walletType: WalletType.SINGLE_SIG,
      }),
      { initialProps: { walletId: 'wallet-A' } },
    );

    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalledTimes(1));

    rerender({ walletId: 'wallet-B' });

    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalledTimes(2));

    await act(async () => {
      deferreds[1].resolve([]);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deferreds[0].reject(new Error('stale wallet-A load failure'));
    });

    expect(result.current.displayError).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
