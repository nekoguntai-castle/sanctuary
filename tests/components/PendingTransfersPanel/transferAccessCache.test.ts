import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { walletKeys } from '../../../src/hooks/queries/useWallets';
import { deviceKeys } from '../../../src/hooks/queries/useDevices';
import { removeTransferredResourceAccess } from '../../../src/components/PendingTransfersPanel/transferAccessCache';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('removeTransferredResourceAccess', () => {
  it.each([
    ['wallet', walletKeys],
    ['device', deviceKeys],
  ] as const)('evicts the inaccessible %s before list invalidation settles', async (_label, keys) => {
    const queryClient = new QueryClient();
    const invalidation = createDeferred();
    queryClient.setQueryData(keys.lists(), [
      { id: 'transferred', name: 'Transferred' },
      { id: 'retained', name: 'Retained' },
    ]);
    queryClient.setQueryData([...keys.lists(), { page: 2 }], [
      { id: 'transferred', name: 'Transferred duplicate' },
    ]);
    queryClient.setQueryData(keys.detail('transferred'), { id: 'transferred' });
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation.promise);

    const reconciliation = removeTransferredResourceAccess(
      queryClient,
      'transferred',
      keys.lists(),
      keys.detail('transferred'),
    );

    expect(queryClient.getQueryData(keys.lists())).toEqual([
      { id: 'retained', name: 'Retained' },
    ]);
    expect(queryClient.getQueryData([...keys.lists(), { page: 2 }])).toEqual([]);
    expect(queryClient.getQueryData(keys.detail('transferred'))).toBeUndefined();

    invalidation.resolve();
    await reconciliation;
  });

  it('preserves unexpected list cache data and tolerates invalidation failure', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(walletKeys.lists(), { pages: [] });
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('offline'));

    await expect(removeTransferredResourceAccess(
      queryClient,
      'wallet-1',
      walletKeys.lists(),
      walletKeys.detail('wallet-1'),
    )).resolves.toBeUndefined();
    expect(queryClient.getQueryData(walletKeys.lists())).toEqual({ pages: [] });
  });
});
