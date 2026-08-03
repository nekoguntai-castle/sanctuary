/**
 * useUtxoActions Hook
 *
 * Manages UTXO freeze/unfreeze, selection, and send-from-selected state and
 * handlers. Extracted from WalletDetail.tsx to isolate UTXO interaction concerns.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import * as transactionsApi from '../../../api/transactions';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import type { UTXO } from '../../../types';
import type { NavigateFunction } from 'react-router-dom';

const log = createLogger('useUtxoActions');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseUtxoActionsParams {
  /** Wallet ID – used for navigation and resetting selection */
  walletId: string | undefined;
  /** Current list of UTXOs */
  utxos: UTXO[];
  /** Setter to optimistically update the UTXO list */
  setUTXOs: React.Dispatch<React.SetStateAction<UTXO[]>>;
  /** Setter to optimistically update the UTXO stats list */
  setUtxoStats: React.Dispatch<React.SetStateAction<UTXO[]>>;
  /** Unified error handler (from useErrorHandler) */
  handleError: (error: unknown, title: string) => void;
  /** React Router navigate function */
  navigate: NavigateFunction;
}

export interface UseUtxoActionsReturn {
  /** Set of currently selected UTXO identifiers (txid:vout) */
  selectedUtxos: Set<string>;
  /** Database identifiers for UTXOs with an in-flight freeze request */
  pendingFreezeIds: Set<string>;
  /** Toggle freeze/unfreeze for a specific UTXO */
  handleToggleFreeze: (txid: string, vout: number) => Promise<void>;
  /** Toggle selection state of a UTXO */
  handleToggleSelect: (id: string) => void;
  /** Navigate to the send page with the currently selected UTXOs */
  handleSendSelected: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUtxoActions({
  walletId,
  utxos,
  setUTXOs,
  setUtxoStats,
  handleError,
  navigate,
}: UseUtxoActionsParams): UseUtxoActionsReturn {
  const [selectedUtxos, setSelectedUtxos] = useState<Set<string>>(new Set());
  const [pendingFreezeIds, setPendingFreezeIds] = useState<Set<string>>(new Set());
  const pendingFreezeRef = useRef(new Map<string, { walletGeneration: number; operation: number }>());
  const walletGenerationRef = useRef(0);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);
  const previousWalletIdRef = useRef(walletId);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      walletGenerationRef.current += 1;
      pendingFreezeRef.current.clear();
    };
  }, []);

  // Invalidate old-wallet operations before the newly rendered wallet can be used.
  useLayoutEffect(() => {
    if (previousWalletIdRef.current === walletId) return;

    previousWalletIdRef.current = walletId;
    walletGenerationRef.current += 1;
    pendingFreezeRef.current.clear();
    setPendingFreezeIds(new Set());
  }, [walletId]);

  // Reset UTXO selection when wallet changes
  useEffect(() => {
    setSelectedUtxos(new Set());
  }, [walletId]);

  const handleToggleFreeze = useCallback(async (txid: string, vout: number) => {
    // Find the UTXO to toggle
    const utxo = utxos.find(u => u.txid === txid && u.vout === vout);
    if (!utxo || !utxo.id) {
      log.error('UTXO not found or missing ID');
      return;
    }

    const utxoId = utxo.id;
    if (pendingFreezeRef.current.has(utxoId)) return;

    const token = {
      walletGeneration: walletGenerationRef.current,
      operation: operationRef.current + 1,
    };
    operationRef.current = token.operation;
    pendingFreezeRef.current.set(utxoId, token);
    setPendingFreezeIds(current => new Set(current).add(utxoId));

    const previousFrozenState = Boolean(utxo.frozen);
    const newFrozenState = !previousFrozenState;
    const isCurrentOperation = () => (
      mountedRef.current
      && walletGenerationRef.current === token.walletGeneration
      && pendingFreezeRef.current.get(utxoId) === token
    );

    // Optimistic update
    setUTXOs(current =>
      current.map(u =>
        u.id === utxoId ? { ...u, frozen: newFrozenState } : u
      )
    );
    setUtxoStats(current =>
      current.map(u =>
        u.id === utxoId ? { ...u, frozen: newFrozenState } : u
      )
    );

    try {
      await transactionsApi.freezeUTXO(utxoId, newFrozenState);
    } catch (err) {
      if (!isCurrentOperation()) return;

      logError(log, err, 'Failed to freeze UTXO');
      handleError(err, 'Failed to Freeze UTXO');
      // Revert optimistic update on error
      setUTXOs(current =>
        current.map(u =>
          u.id === utxoId ? { ...u, frozen: previousFrozenState } : u
        )
      );
      setUtxoStats(current =>
        current.map(u =>
          u.id === utxoId ? { ...u, frozen: previousFrozenState } : u
        )
      );
    } finally {
      if (isCurrentOperation()) {
        pendingFreezeRef.current.delete(utxoId);
        setPendingFreezeIds(current => {
          const next = new Set(current);
          next.delete(utxoId);
          return next;
        });
      }
    }
  }, [utxos, setUTXOs, setUtxoStats, handleError]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedUtxos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSendSelected = useCallback(() => {
    navigate(`/wallets/${walletId}/send`, { state: { preSelected: Array.from(selectedUtxos) } });
  }, [walletId, selectedUtxos, navigate]);

  return {
    selectedUtxos,
    pendingFreezeIds,
    handleToggleFreeze,
    handleToggleSelect,
    handleSendSelected,
  };
}
