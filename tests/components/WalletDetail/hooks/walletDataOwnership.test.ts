import { describe, expect, it } from 'vitest';
import { createRequestOwnership } from '../../../../src/hooks/requestOwnership';
import {
  applyOwnedWalletRead,
  keepOwnedValue,
} from '../../../../src/components/WalletDetail/hooks/walletDataOwnership';
import {
  beginWalletRenameWrite,
  captureWalletNameRead,
} from '../../../../src/components/WalletDetail/hooks/walletRenameEpoch';
import type { Wallet } from '../../../../src/types';

describe('wallet data updater ownership', () => {
  it('keeps loading and error state after a delayed wallet A updater loses route ownership', () => {
    const ownership = createRequestOwnership('wallet-a:user-1:mainnet');
    const request = ownership.beginFetch('wallet-a:user-1:mainnet');
    const ownsRequest = () => ownership.isFetchOwner(request);
    expect(keepOwnedValue(true, false, ownsRequest)).toBe(false);
    expect(keepOwnedValue<string | null>(null, 'A failed', ownsRequest)).toBe('A failed');

    ownership.setRoute('wallet-b:user-1:mainnet');
    expect(keepOwnedValue(true, false, ownsRequest)).toBe(true);
    expect(keepOwnedValue<string | null>(null, 'A failed', ownsRequest)).toBeNull();
  });

  it('rejects a delayed GET updater when a rename starts after its response', () => {
    const ownership = createRequestOwnership('wallet-1:user-1:mainnet');
    const request = ownership.beginFetch('wallet-1:user-1:mainnet');
    const ownsRequest = () => ownership.isFetchOwner(request);
    const read = captureWalletNameRead('wallet-1:user-1:mainnet');
    const current = { id: 'wallet-1', name: 'Optimistic' } as Wallet;
    const incoming = { id: 'wallet-1', name: 'Stale GET' } as Wallet;
    expect(applyOwnedWalletRead(current, incoming, read, ownsRequest)).toEqual(incoming);

    const finishWrite = beginWalletRenameWrite('wallet-1:user-1:mainnet');
    expect(applyOwnedWalletRead(current, incoming, read, ownsRequest)).toBe(current);
    finishWrite();
    read.release();
  });

  it('rejects an old wallet GET updater when the route changes', () => {
    const ownership = createRequestOwnership('wallet-a:user-1:mainnet');
    const request = ownership.beginFetch('wallet-a:user-1:mainnet');
    const read = captureWalletNameRead('wallet-a:user-1:mainnet');
    const current = { id: 'wallet-b', name: 'Wallet B' } as Wallet;
    const incoming = { id: 'wallet-a', name: 'Wallet A' } as Wallet;

    ownership.setRoute('wallet-b:user-1:mainnet');
    expect(applyOwnedWalletRead(current, incoming, read, () => ownership.isFetchOwner(request))).toBe(current);
    read.release();
  });
});
