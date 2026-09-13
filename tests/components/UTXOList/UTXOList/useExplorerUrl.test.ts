import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as bitcoinApi from '../../../../src/api/bitcoin';
import { useExplorerUrl } from '../../../../src/components/UTXOList/UTXOList/useExplorerUrl';

vi.mock('../../../../src/api/bitcoin', () => ({ getStatus: vi.fn() }));

/**
 * The hook used to call `bitcoinApi.getStatus()` with no argument. That
 * signature defaults to 'mainnet', so every non-mainnet wallet silently
 * received the mainnet explorer base and a configured per-network explorer was
 * discarded — and with a customised mainnet explorer, a testnet address was
 * linked to a mainnet host.
 */
describe('useExplorerUrl', () => {
  beforeEach(() => {
    vi.mocked(bitcoinApi.getStatus).mockReset();
  });

  it.each(['mainnet', 'testnet3', 'testnet4', 'signet'])(
    'asks for the %s explorer specifically',
    async network => {
      vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
        explorerUrl: `https://explorer.example/${network}`,
      } as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);

      const { result } = renderHook(() => useExplorerUrl(network));

      await waitFor(() => {
        expect(result.current).toBe(`https://explorer.example/${network}`);
      });
      expect(bitcoinApi.getStatus).toHaveBeenCalledWith(network);
    }
  );

  it('returns null without calling the API when the network is unknown', async () => {
    const { result } = renderHook(() => useExplorerUrl(undefined));

    expect(result.current).toBeNull();
    expect(bitcoinApi.getStatus).not.toHaveBeenCalled();
  });

  it('returns null rather than a stale base when the request fails', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useExplorerUrl('testnet4'));

    await waitFor(() => {
      expect(bitcoinApi.getStatus).toHaveBeenCalledWith('testnet4');
    });
    expect(result.current).toBeNull();
  });

  it('returns null when the server reports no explorer for that network', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({} as Awaited<
      ReturnType<typeof bitcoinApi.getStatus>
    >);

    const { result } = renderHook(() => useExplorerUrl('signet'));

    await waitFor(() => {
      expect(bitcoinApi.getStatus).toHaveBeenCalledWith('signet');
    });
    expect(result.current).toBeNull();
  });

  it('re-resolves when the active network changes', async () => {
    vi.mocked(bitcoinApi.getStatus).mockImplementation(
      async (network?: string | null) =>
        ({ explorerUrl: `https://explorer.example/${network}` }) as Awaited<
          ReturnType<typeof bitcoinApi.getStatus>
        >
    );

    const { result, rerender } = renderHook(({ n }) => useExplorerUrl(n), {
      initialProps: { n: 'mainnet' as string },
    });

    await waitFor(() => expect(result.current).toBe('https://explorer.example/mainnet'));

    rerender({ n: 'testnet4' });

    await waitFor(() => expect(result.current).toBe('https://explorer.example/testnet4'));
    expect(bitcoinApi.getStatus).toHaveBeenLastCalledWith('testnet4');
  });
  it('ignores a late success after the consumer unmounted', async () => {
    type StatusResult = Awaited<ReturnType<typeof bitcoinApi.getStatus>>;
    let resolveStatus: (value: StatusResult) => void = () => {};
    vi.mocked(bitcoinApi.getStatus).mockReturnValue(
      new Promise<StatusResult>(resolve => {
        resolveStatus = resolve;
      })
    );

    const { result, unmount } = renderHook(() => useExplorerUrl('testnet4'));
    unmount();
    resolveStatus({ explorerUrl: 'https://late.example' } as StatusResult);

    await Promise.resolve();
    expect(result.current).toBeNull();
  });

  it('ignores a late failure after the consumer unmounted', async () => {
    let rejectStatus: (reason: unknown) => void = () => {};
    vi.mocked(bitcoinApi.getStatus).mockReturnValue(
      new Promise<Awaited<ReturnType<typeof bitcoinApi.getStatus>>>((_resolve, reject) => {
        rejectStatus = reject;
      })
    );

    const { result, unmount } = renderHook(() => useExplorerUrl('signet'));
    unmount();
    rejectStatus(new Error('offline'));

    await Promise.resolve();
    expect(result.current).toBeNull();
  });

});
