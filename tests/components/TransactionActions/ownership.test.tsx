import { StrictMode, useEffect } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransactionActions } from '../../../src/components/TransactionActions/useTransactionActions';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as draftsApi from '../../../src/api/drafts';
import * as transactionsApi from '../../../src/api/transactions';
vi.mock('../../../src/api/bitcoin', () => ({ checkRBF: vi.fn(), createRBFTransaction: vi.fn(), createCPFPTransaction: vi.fn() }));
vi.mock('../../../src/api/drafts', () => ({ createDraft: vi.fn() }));
vi.mock('../../../src/api/transactions', () => ({ getTransaction: vi.fn() }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => ({ error: logError }) }));
it('does not redirect a reader who left the RBF route while its draft response was pending', async () => {
  vi.mocked(bitcoinApi.checkRBF).mockResolvedValue({ replaceable: true, currentFeeRate: 10, minNewFeeRate: 15 } as never);
  vi.mocked(transactionsApi.getTransaction).mockResolvedValue({ label: 'Original' } as never);
  vi.mocked(bitcoinApi.createRBFTransaction).mockResolvedValue({
    feeRate: 20, fee: 2000, psbtBase64: 'test',
    inputs: [{ txid: 'previous', vout: 0, value: 50000 }],
    outputs: [{ address: 'recipient', value: 48000 }],
  } as never);
  let resolveDraft!: (value: unknown) => void;
  vi.mocked(draftsApi.createDraft).mockReturnValue(new Promise(resolve => { resolveDraft = resolve; }) as never);
  const onActionComplete = vi.fn();
  const unmounted = vi.fn();
  let actions!: ReturnType<typeof useTransactionActions>;
  function RbfRoute() {
    actions = useTransactionActions({ txid: 'original', walletId: 'A', confirmed: false,
      isReceived: false, navigate: useNavigate(), onActionComplete });
    useEffect(() => () => unmounted(), []);
    return <div>Wallet A transaction</div>;
  }
  const router = createMemoryRouter([
    { path: '/wallets/A', element: <RbfRoute /> },
    { path: '/elsewhere', element: <div>Chosen destination</div> },
    { path: '/wallets/A/send', element: <div>Old RBF send form</div> },
  ], { initialEntries: ['/elsewhere', '/wallets/A'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(actions.state.loading).toBe(false));
  let work!: Promise<void>;
  act(() => { work = actions.handlers.handleRBF(); });
  await waitFor(() => expect(draftsApi.createDraft).toHaveBeenCalledTimes(1));
  await act(async () => { await router.navigate(-1); });
  expect(router.state.location.pathname).toBe('/elsewhere');
  expect(unmounted).toHaveBeenCalledTimes(1);
  await act(async () => { resolveDraft({ id: 'accepted-draft' }); await work; });
  expect({ path: router.state.location.pathname, callbackCalls: onActionComplete.mock.calls.length })
    .toEqual({ path: '/elsewhere', callbackCalls: 0 });
});

type Boundary = 'transaction' | 'replacement' | 'draft';
const status = { replaceable: true, currentFeeRate: 10, minNewFeeRate: 15 } as Awaited<ReturnType<typeof bitcoinApi.checkRBF>>;
const original = { label: 'Original' } as Awaited<ReturnType<typeof transactionsApi.getTransaction>>;
const replacement = {
  feeRate: 20, fee: 2000, psbtBase64: 'test',
  inputs: [{ txid: 'previous', vout: 0, value: 50000 }],
  outputs: [{ address: 'recipient', value: 48000 }],
} as Awaited<ReturnType<typeof bitcoinApi.createRBFTransaction>>;
const draft = { id: 'draft' } as Awaited<ReturnType<typeof draftsApi.createDraft>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function deferBoundary(boundary: Boundary) {
  if (boundary === 'transaction') {
    const pending = deferred<typeof original>();
    vi.mocked(transactionsApi.getTransaction).mockReturnValueOnce(pending.promise);
    return { reject: pending.reject, resolve: () => pending.resolve(original), mock: transactionsApi.getTransaction };
  }
  if (boundary === 'replacement') {
    const pending = deferred<typeof replacement>();
    vi.mocked(bitcoinApi.createRBFTransaction).mockReturnValueOnce(pending.promise);
    return { reject: pending.reject, resolve: () => pending.resolve(replacement), mock: bitcoinApi.createRBFTransaction };
  }
  const pending = deferred<typeof draft>();
  vi.mocked(draftsApi.createDraft).mockReturnValueOnce(pending.promise);
  return { reject: pending.reject, resolve: () => pending.resolve(draft), mock: draftsApi.createDraft };
}
async function setup(strict = false) {
  const navigate = vi.fn();
  const complete = vi.fn();
  const hook = renderHook(({ walletId, txid, confirmed }) => useTransactionActions({
    walletId, txid, confirmed, isReceived: false, navigate, onActionComplete: complete,
  }), { initialProps: { walletId: 'A', txid: 'tx-A', confirmed: false }, wrapper: strict ? StrictMode : undefined });
  await waitFor(() => expect(hook.result.current.state.loading).toBe(false));
  return { ...hook, navigate, complete };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bitcoinApi.checkRBF).mockResolvedValue(status);
  vi.mocked(transactionsApi.getTransaction).mockResolvedValue(original);
  vi.mocked(bitcoinApi.createRBFTransaction).mockResolvedValue(replacement);
  vi.mocked(draftsApi.createDraft).mockResolvedValue(draft);
  vi.mocked(bitcoinApi.createCPFPTransaction).mockResolvedValue({ effectiveFeeRate: 25 } as never);
});

describe('transaction action ownership', () => {
  it.each([
    ['transaction', 'success'], ['transaction', 'error'],
    ['replacement', 'success'], ['replacement', 'error'],
    ['draft', 'success'], ['draft', 'error'],
  ] as const)('retires the %s await on unmount before %s', async (boundary, outcome) => {
    const pending = deferBoundary(boundary);
    const { result, unmount, navigate, complete } = await setup();
    let work!: Promise<void>;
    act(() => { work = result.current.handlers.handleRBF(); });
    await waitFor(() => expect(pending.mock).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      if (outcome === 'success') pending.resolve(); else pending.reject(new Error('retired failure'));
      await work;
    });
    if (boundary === 'transaction') expect(bitcoinApi.createRBFTransaction).not.toHaveBeenCalled();
    if (boundary !== 'draft') expect(draftsApi.createDraft).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each(['transaction', 'replacement', 'draft'] as const)('keeps current %s errors retryable', async boundary => {
    const pending = deferBoundary(boundary);
    const { result, navigate, complete } = await setup();
    let work!: Promise<void>;
    act(() => { work = result.current.handlers.handleRBF(); });
    await waitFor(() => expect(pending.mock).toHaveBeenCalledTimes(1));
    await act(async () => { pending.reject(new Error('current failure')); await work; });
    expect(result.current.state.error).toBe('current failure');
    expect(result.current.state.processing).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { await result.current.handlers.handleRBF(); });
    expect(navigate).toHaveBeenCalledWith('/wallets/A/send', { state: { draft: { ...draft, replacesTxid: 'tx-A' } } });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each(['wallet', 'transaction', 'roundtrip', 'confirmed'] as const)('retires pending draft and resets action state on %s changes', async change => {
    const pending = deferBoundary('draft');
    const { result, rerender, navigate } = await setup();
    act(() => { result.current.handlers.openRBFModal(); result.current.handlers.setTargetFeeRate(30); });
    let work!: Promise<void>;
    act(() => { work = result.current.handlers.handleRBF(); });
    await waitFor(() => expect(draftsApi.createDraft).toHaveBeenCalledTimes(1));
    rerender({ walletId: change === 'transaction' || change === 'confirmed' ? 'A' : 'B', txid: change === 'transaction' ? 'tx-B' : 'tx-A', confirmed: change === 'confirmed' });
    if (change === 'roundtrip') rerender({ walletId: 'A', txid: 'tx-A', confirmed: false });
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.processing).toBe(false);
    expect(result.current.state.showRBFModal).toBe(false);
    expect(result.current.state.targetFeeRate).toBe(0);
    await act(async () => { pending.resolve(); await work; });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not reuse old eligibility when the new wallet status lookup fails', async () => {
    const { result, rerender } = await setup();
    vi.mocked(bitcoinApi.checkRBF).mockRejectedValueOnce(new Error('lookup failed'));
    rerender({ walletId: 'B', txid: 'tx-A', confirmed: false });
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.rbfStatus).toBeNull();
    expect(result.current.state.newFeeRate).toBe(0);
    await act(async () => { await result.current.handlers.handleRBF(); });
    expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)('ignores old lookup %s while current scope loads', async outcome => {
    const old = deferred<typeof status>();
    const current = deferred<typeof status>();
    const { result, rerender } = await setup();
    vi.mocked(bitcoinApi.checkRBF).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    rerender({ walletId: 'B', txid: 'tx-A', confirmed: false });
    rerender({ walletId: 'C', txid: 'tx-A', confirmed: false });
    await act(async () => { if (outcome === 'success') old.resolve(status); else old.reject(new Error('obsolete lookup')); });
    expect(result.current.state.loading).toBe(true);
    expect(result.current.state.rbfStatus).toBeNull();
    expect(logError).not.toHaveBeenCalled();
    await act(async () => { current.resolve({ ...status, minNewFeeRate: 40 }); });
    expect(result.current.state.newFeeRate).toBe(40);
  });

  it.each(['success', 'error'] as const)('retires CPFP %s after unmount', async outcome => {
    const pending = deferred<Awaited<ReturnType<typeof bitcoinApi.createCPFPTransaction>>>();
    vi.mocked(bitcoinApi.createCPFPTransaction).mockReturnValueOnce(pending.promise);
    const { result, unmount, complete } = await setup();
    act(() => result.current.handlers.setTargetFeeRate(25));
    let work!: Promise<void>;
    act(() => { work = result.current.handlers.handleCPFP(); });
    unmount();
    await act(async () => { if (outcome === 'success') pending.resolve({ effectiveFeeRate: 25 } as never); else pending.reject(new Error('retired')); await work; });
    expect(complete).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('old RBF finally cannot clear newer CPFP processing', async () => {
    const old = deferBoundary('draft');
    const current = deferred<Awaited<ReturnType<typeof bitcoinApi.createCPFPTransaction>>>();
    vi.mocked(bitcoinApi.createCPFPTransaction).mockReturnValueOnce(current.promise);
    const { result, navigate, complete } = await setup();
    act(() => result.current.handlers.setTargetFeeRate(25));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.handlers.handleRBF(); });
    await waitFor(() => expect(draftsApi.createDraft).toHaveBeenCalled());
    act(() => { second = result.current.handlers.handleCPFP(); });
    await act(async () => { old.resolve(); await first; });
    expect(result.current.state.processing).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { current.resolve({ effectiveFeeRate: 25 } as never); await second; });
    expect(result.current.state.success).toContain('25.00');
    expect(result.current.state.processing).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('permits current RBF after StrictMode replay and ordinary mounted rerenders', async () => {
    const { result, rerender, navigate, complete } = await setup(true);
    rerender({ walletId: 'A', txid: 'tx-A', confirmed: false });
    await act(async () => { await result.current.handlers.handleRBF(); });
    expect(draftsApi.createDraft).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each(['wallet', 'roundtrip', 'unmount'] as const)('rejects retained action handlers after %s retirement', async change => {
    const { result, rerender, unmount } = await setup();
    act(() => result.current.handlers.setTargetFeeRate(25));
    const old = result.current.handlers;
    if (change === 'unmount') unmount();
    else {
      rerender({ walletId: 'B', txid: 'tx-A', confirmed: false });
      if (change === 'roundtrip') rerender({ walletId: 'A', txid: 'tx-A', confirmed: false });
    }
    await act(async () => { await old.handleRBF(); await old.handleCPFP(); });
    expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    expect(bitcoinApi.createCPFPTransaction).not.toHaveBeenCalled();
  });

  it('does not admit CPFP for a confirmed transaction', async () => {
    const { result, rerender } = await setup();
    rerender({ walletId: 'A', txid: 'tx-A', confirmed: true });
    act(() => result.current.handlers.setTargetFeeRate(25));
    await act(async () => { await result.current.handlers.handleCPFP(); });
    expect(bitcoinApi.createCPFPTransaction).not.toHaveBeenCalled();
  });

  it('does not invoke completion if navigation synchronously retires the owner', async () => {
    const { result, navigate, unmount, complete } = await setup();
    navigate.mockImplementationOnce(unmount);
    await act(async () => { await result.current.handlers.handleRBF(); });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });


  it('keeps a new action busy when CPFP completion reenters the hook', async () => {
    const pending = deferBoundary('transaction');
    const { result, complete } = await setup();
    act(() => result.current.handlers.setTargetFeeRate(25));
    let next!: Promise<void>;
    complete.mockImplementationOnce(() => { next = result.current.handlers.handleRBF(); });
    await act(async () => { await result.current.handlers.handleCPFP(); });
    expect(result.current.state.processing).toBe(true);
    await act(async () => { pending.resolve(); await next; });
    expect(result.current.state.processing).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
  });

});
