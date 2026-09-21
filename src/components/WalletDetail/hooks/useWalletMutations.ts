/** Wallet name editing with ordered, optimistic writes for each wallet and user. */

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as walletsApi from '../../../api/wallets';
import { createLogger } from '../../../utils/logger';
import type { Wallet } from '../../../types';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';
import { beginWalletRenameWrite } from './walletRenameEpoch';

const log = createLogger('useWalletMutations');

export interface UseWalletMutationsParams {
  wallet: Wallet | null;
  walletId: string | undefined;
  ownershipKey?: string;
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
  handleError: (error: unknown, title: string) => void;
}

export interface UseWalletMutationsReturn {
  isEditingName: boolean;
  setIsEditingName: (editing: boolean) => void;
  editedName: string;
  setEditedName: (name: string) => void;
  handleUpdateWallet: (updatedData: { name: string }) => Promise<void>;
}

interface RenameQueue {
  pending: Promise<void> | null;
  latestRequest: number;
  confirmedName: string;
}

// A pending server write can outlive its hook when Wallet Detail remounts.
// Idle entries are removed as soon as the final queued write settles.
const renameQueues = new Map<string, RenameQueue>();

function renameQueueKey(id: string, ownershipKey: string): string {
  const prefix = `${id}:`;
  if (!ownershipKey.startsWith(prefix)) return id;
  return `${id}:${ownershipKey.slice(prefix.length).split(':', 1)[0]}`;
}

function getRenameQueue(key: string, confirmedName: string): RenameQueue {
  let queue = renameQueues.get(key);
  if (!queue) {
    queue = { pending: null, latestRequest: 0, confirmedName };
    renameQueues.set(key, queue);
  }
  return queue;
}

function revertFailedName(
  setWallet: UseWalletMutationsParams['setWallet'],
  id: string,
  attemptedName: string,
  confirmedName: string,
): void {
  // Keep unrelated fields from a newer sync snapshot and never replace its name.
  setWallet(current => current?.id === id && current.name === attemptedName
    ? { ...current, name: confirmedName }
    : current);
}

export function useWalletMutations({
  wallet,
  walletId,
  ownershipKey = walletId ?? '',
  setWallet,
  handleError,
}: UseWalletMutationsParams): UseWalletMutationsReturn {
  const ownership = useWalletRouteOwnership(ownershipKey);
  const currentWalletId = useRef(walletId);
  const currentQueueKey = useRef(renameQueueKey(walletId ?? '', ownershipKey));
  const walletRouteGeneration = useRef(0);
  const mounted = useRef(true);
  currentWalletId.current = walletId;
  const nextQueueKey = renameQueueKey(walletId ?? '', ownershipKey);
  if (currentQueueKey.current !== nextQueueKey) walletRouteGeneration.current += 1;
  currentQueueKey.current = nextQueueKey;
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    setIsEditingName(false);
    setEditedName('');
  }, [ownershipKey]);

  const handleUpdateWallet = useCallback(async (updatedData: { name: string }) => {
    if (!wallet || !walletId || wallet.id !== walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownership.isRouteOwner(token)) return;

    const key = renameQueueKey(id, ownershipKey);
    const generation = walletRouteGeneration.current;
    const queue = getRenameQueue(key, wallet.name);
    const request = ++queue.latestRequest;
    const finishWrite = beginWalletRenameWrite(key);
    const stillOnWallet = (): boolean => (
      mounted.current
      && currentWalletId.current === id
      && currentQueueKey.current === key
      && walletRouteGeneration.current === generation
    );

    setWallet(current => current?.id === id ? { ...current, name: updatedData.name } : current);

    const persist = async (): Promise<void> => {
      try {
        // A network switch keeps this wallet's queued writes; leaving the wallet drops them.
        if (!stillOnWallet()) return;
        const saved = await walletsApi.updateWallet(id, { name: updatedData.name });
        queue.confirmedName = saved?.name ?? updatedData.name;
        if (queue.confirmedName !== updatedData.name
          && request === queue.latestRequest && stillOnWallet()) {
          setWallet(current => current?.id === id && current.name === updatedData.name
            ? { ...current, name: queue.confirmedName }
            : current);
        }
      } catch (err) {
        log.error('Failed to update wallet', { error: err });
        if (request !== queue.latestRequest || !stillOnWallet()) return;
        revertFailedName(setWallet, id, updatedData.name, queue.confirmedName);
        handleError(err, 'Update Failed');
      } finally {
        finishWrite();
      }
    };
    // A reporting failure must not cancel later accepted writes for this wallet.
    const pending = queue.pending ? queue.pending.then(persist, persist) : persist();
    queue.pending = pending;
    const clearSettledQueue = () => {
      if (queue.pending !== pending) return;
      queue.pending = null;
      renameQueues.delete(key);
    };
    void pending.then(clearSettledQueue, clearSettledQueue);
    await pending;
  }, [handleError, ownership, ownershipKey, setWallet, wallet, walletId]);

  return {
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    handleUpdateWallet,
  };
}
