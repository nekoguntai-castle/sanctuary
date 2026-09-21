import { describe, expect, it, vi } from 'vitest';
import {
  beginWalletRenameWrite,
  captureWalletNameRead,
  releaseWalletNameReads,
  subscribeWalletRenameDrain,
} from '../../../../src/components/WalletDetail/hooks/walletRenameEpoch';

describe('wallet rename read/write epochs', () => {
  it('invalidates a pre-write read even after the write drains', () => {
    const key = 'wallet-epoch:user-a';
    const read = captureWalletNameRead(key);
    expect(read.canCommit()).toBe(true);
    const finish = beginWalletRenameWrite(key);
    expect(read.canCommit()).toBe(false);
    finish();
    expect(read.canCommit()).toBe(false);
    read.release();

    const fresh = captureWalletNameRead(key);
    expect(fresh.canCommit()).toBe(true);
    expect(read.canCommit()).toBe(false);
    fresh.release();
  });

  it('notifies only after the last accepted write settles', () => {
    const key = 'wallet-epoch:user-b';
    const onDrain = vi.fn();
    const unsubscribe = subscribeWalletRenameDrain(key, onDrain);
    const finishFirst = beginWalletRenameWrite(key);
    const finishSecond = beginWalletRenameWrite(key);
    const read = captureWalletNameRead(key);
    expect(read.canCommit()).toBe(false);

    finishFirst();
    expect(onDrain).not.toHaveBeenCalled();
    finishSecond();
    finishSecond();
    expect(onDrain).toHaveBeenCalledOnce();
    expect(read.canCommit()).toBe(false);
    read.release();
    unsubscribe();
    const nextRead = captureWalletNameRead(key);
    unsubscribe();
    expect(nextRead.canCommit()).toBe(true);
    nextRead.release();
  });

  it('keeps a new read when a drain listener replaces its own coordinator entry', () => {
    const key = 'wallet-epoch:user-c';
    let unsubscribe!: () => void;
    let replacement!: ReturnType<typeof captureWalletNameRead>;
    unsubscribe = subscribeWalletRenameDrain(key, () => {
      unsubscribe();
      replacement = captureWalletNameRead(key);
    });

    beginWalletRenameWrite(key)();
    expect(replacement.canCommit()).toBe(true);
    replacement.release();
  });

  it('releases abandoned GET reads on owner teardown', () => {
    const key = 'wallet-epoch:user-d';
    const abandoned = captureWalletNameRead(key);
    const pending = new Set([abandoned]);

    releaseWalletNameReads(pending);

    expect(pending.size).toBe(0);
    const nextOwnerRead = captureWalletNameRead(key);
    expect(nextOwnerRead.canCommit()).toBe(true);
    expect(abandoned.canCommit()).toBe(false);
    nextOwnerRead.release();
  });
});
