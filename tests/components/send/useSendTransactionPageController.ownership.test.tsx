import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSendTransactionPageData } from '../../../components/send/SendTransactionPage/loadSendTransactionPageData';
import type {
  LoadedSendTransactionPageData,
  SendTransactionLoadResult,
} from '../../../components/send/SendTransactionPage/types';
import { useSendTransactionPageController } from '../../../components/send/SendTransactionPage/useSendTransactionPageController';

const routeMocks = vi.hoisted(() => ({
  locationState: null as Record<string, unknown> | null,
  navigate: vi.fn(),
  params: { id: 'wallet-a' as string | undefined },
  showInfo: vi.fn(),
  user: { id: 'user-1', username: 'alice' },
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: routeMocks.locationState }),
  useNavigate: () => routeMocks.navigate,
  useParams: () => routeMocks.params,
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({ isLoading: false, user: routeMocks.user }),
}));

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    showInfo: routeMocks.showInfo,
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../components/send/SendTransactionPage/loadSendTransactionPageData', () => ({
  loadSendTransactionPageData: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function loadedData(walletId: string): LoadedSendTransactionPageData {
  return {
    devices: [],
    fees: null,
    mempoolBlocks: [],
    queuedBlocksSummary: null,
    utxos: [],
    wallet: {
      balance: 0,
      id: walletId,
      name: walletId,
      network: 'mainnet',
      scriptType: 'native_segwit',
      type: 'single_sig',
    },
    walletAddresses: [],
  };
}

describe('useSendTransactionPageController request ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.locationState = null;
    routeMocks.params.id = 'wallet-a';
  });

  it('keeps stale success data and notifications from replacing a newer wallet request', async () => {
    const walletA = createDeferred<SendTransactionLoadResult>();
    const walletB = createDeferred<SendTransactionLoadResult>();
    vi.mocked(loadSendTransactionPageData).mockImplementation(async (params) => {
      const result = await (params.walletId === 'wallet-a' ? walletA.promise : walletB.promise);
      params.showInfo(`loaded ${params.walletId}`);
      return result;
    });

    const { result, rerender } = renderHook(() => useSendTransactionPageController());
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(1));

    routeMocks.params.id = 'wallet-b';
    rerender();
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(2));

    act(() => {
      walletA.resolve({ data: loadedData('wallet-a'), kind: 'loaded' });
    });
    await act(async () => {
      await walletA.promise;
    });

    expect(result.current.wallet).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(routeMocks.showInfo).not.toHaveBeenCalledWith('loaded wallet-a');

    act(() => {
      walletB.resolve({ data: loadedData('wallet-b'), kind: 'loaded' });
    });
    await waitFor(() => expect(result.current.wallet?.id).toBe('wallet-b'));

    expect(result.current.loading).toBe(false);
    expect(routeMocks.showInfo).toHaveBeenCalledWith('loaded wallet-b');
  });

  it('keeps a stale failure from clearing loading or setting an error for the current wallet', async () => {
    const walletA = createDeferred<SendTransactionLoadResult>();
    const walletB = createDeferred<SendTransactionLoadResult>();
    vi.mocked(loadSendTransactionPageData).mockImplementation(
      ({ walletId }) => walletId === 'wallet-a' ? walletA.promise : walletB.promise,
    );

    const { result, rerender } = renderHook(() => useSendTransactionPageController());
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(1));

    routeMocks.params.id = 'wallet-b';
    rerender();
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(2));

    await act(async () => {
      walletA.reject(new Error('wallet A failed'));
      await expect(walletA.promise).rejects.toThrow('wallet A failed');
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    act(() => {
      walletB.resolve({ data: loadedData('wallet-b'), kind: 'loaded' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.wallet?.id).toBe('wallet-b');
  });

  it('prevents a stale read-only result from redirecting the newer wallet route', async () => {
    const walletA = createDeferred<SendTransactionLoadResult>();
    const walletB = createDeferred<SendTransactionLoadResult>();
    vi.mocked(loadSendTransactionPageData).mockImplementation(
      ({ walletId }) => walletId === 'wallet-a' ? walletA.promise : walletB.promise,
    );

    const { result, rerender } = renderHook(() => useSendTransactionPageController());
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(1));

    routeMocks.params.id = 'wallet-b';
    rerender();
    await waitFor(() => expect(loadSendTransactionPageData).toHaveBeenCalledTimes(2));

    act(() => {
      walletA.resolve({ kind: 'readOnly' });
    });
    await act(async () => {
      await walletA.promise;
    });

    expect(routeMocks.navigate).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    act(() => {
      walletB.resolve({ data: loadedData('wallet-b'), kind: 'loaded' });
    });
    await waitFor(() => expect(result.current.wallet?.id).toBe('wallet-b'));
    expect(routeMocks.navigate).not.toHaveBeenCalled();
  });
});
