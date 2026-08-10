/**
 * useWalletMutations Hook
 *
 * Manages wallet name editing state and the wallet update handler.
 * Extracted from WalletDetail.tsx to isolate mutation concerns.
 */

import { useState, useCallback, useLayoutEffect } from 'react';
import * as walletsApi from '../../../api/wallets';
import { createLogger } from '../../../utils/logger';
import type { Wallet } from '../../../types';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';

const log = createLogger('useWalletMutations');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletMutationsParams {
  /** Current wallet object (used for optimistic revert) */
  wallet: Wallet | null;
  /** Wallet ID */
  walletId: string | undefined;
  ownershipKey?: string;
  /** Setter to optimistically update the wallet object */
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
  /** Unified error handler (from useErrorHandler) */
  handleError: (error: unknown, title: string) => void;
}

export interface UseWalletMutationsReturn {
  /** Whether the wallet name is currently being edited */
  isEditingName: boolean;
  /** Setter to toggle name editing mode */
  setIsEditingName: (editing: boolean) => void;
  /** The current draft value for the wallet name */
  editedName: string;
  /** Setter for the edited name value */
  setEditedName: (name: string) => void;
  /** Persist a wallet name update. */
  handleUpdateWallet: (updatedData: { name: string }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletMutations({
  wallet,
  walletId,
  ownershipKey = walletId ?? '',
  setWallet,
  handleError,
}: UseWalletMutationsParams): UseWalletMutationsReturn {
  const ownership = useWalletRouteOwnership(ownershipKey);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  useLayoutEffect(() => {
    setIsEditingName(false);
    setEditedName('');
  }, [ownershipKey]);

  const handleUpdateWallet = useCallback(async (updatedData: { name: string }) => {
    if (!wallet || !walletId || wallet.id !== walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownership.isRouteOwner(token)) return;

    try {
      // Optimistic update
      const updatedWallet = { ...wallet, ...updatedData };
      setWallet(updatedWallet);

      // Wallet identity material is immutable through the generic update API.
      await walletsApi.updateWallet(id, {
        name: updatedData.name,
      });
    } catch (err) {
      log.error('Failed to update wallet', { error: err });
      if (!ownership.isRouteOwner(token) || id !== walletId) return;
      // Revert optimistic update on error
      setWallet(current => current?.id === id ? wallet : current);
      handleError(err, 'Update Failed');
    }
  }, [handleError, ownership, ownershipKey, setWallet, wallet, walletId]);

  return {
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    handleUpdateWallet,
  };
}
