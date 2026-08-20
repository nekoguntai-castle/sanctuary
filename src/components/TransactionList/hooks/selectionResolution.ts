import type { Transaction } from '../../../types';

export type SelectionStatus = 'idle' | 'loading' | 'resolved' | 'not-found' | 'error';

export interface SelectionResolution {
  key: string | null;
  status: SelectionStatus;
  selectedTx: Transaction | null;
  fullTxDetails: Transaction | null;
  error: string | null;
}

export const IDLE_SELECTION: SelectionResolution = {
  key: null,
  status: 'idle',
  selectedTx: null,
  fullTxDetails: null,
  error: null,
};

export const normalizeTxid = (value: string): string => value.trim().toLowerCase();

export const isValidTxid = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

export const selectionKey = (walletId: string, txid: string): string => `${walletId}:${txid}`;

export const isNotFoundError = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && 'status' in error
  && (error as { status?: unknown }).status === 404
);

export const selectionErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Failed to load transaction details'
);

export const isAbortError = (error: unknown): boolean => (
  error instanceof DOMException
  && error.name === 'AbortError'
);
