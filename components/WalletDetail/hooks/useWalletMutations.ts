/**
 * useWalletMutations Hook
 *
 * Manages wallet name editing state and the wallet update handler (name,
 * descriptor). Extracted from WalletDetail.tsx to isolate mutation concerns.
 */

import { useState, useCallback } from 'react';
import * as walletsApi from '../../../src/api/wallets';
import { createLogger } from '../../../utils/logger';
import type { Wallet } from '../../../types';

const log = createLogger('useWalletMutations');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletMutationsParams {
  /** Current wallet object (used for optimistic revert) */
  wallet: Wallet | null;
  /** Wallet ID */
  walletId: string | undefined;
  /** Setter to optimistically update the wallet object */
  setWallet: (wallet: Wallet) => void;
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
  /** Persist partial wallet updates (name, descriptor) */
  handleUpdateWallet: (updatedData: Partial<Wallet>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletMutations({
  wallet,
  walletId,
  setWallet,
  handleError,
}: UseWalletMutationsParams): UseWalletMutationsReturn {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  const handleUpdateWallet = useCallback(async (updatedData: Partial<Wallet>) => {
    if (!wallet || !walletId) return;

    try {
      // Optimistic update
      const updatedWallet = { ...wallet, ...updatedData };
      setWallet(updatedWallet);

      // Update via API (only name and descriptor are updateable)
      await walletsApi.updateWallet(walletId, {
        name: updatedData.name,
        descriptor: updatedData.descriptor,
      });
    } catch (err) {
      log.error('Failed to update wallet', { error: err });
      // Revert optimistic update on error
      setWallet(wallet);
      handleError(err, 'Update Failed');
    }
  }, [wallet, walletId, setWallet, handleError]);

  return {
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    handleUpdateWallet,
  };
}
