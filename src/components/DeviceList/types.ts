/**
 * DeviceList Component Types
 *
 * Shared type aliases used across DeviceList subcomponents.
 */

export type ViewMode = 'list' | 'grouped';
export type SortField = 'label' | 'type' | 'fingerprint' | 'wallets';
export type SortOrder = 'asc' | 'desc';
export type OwnershipFilter = 'all' | 'owned' | 'shared';
export type WalletFilter = 'all' | 'unassigned' | (string & {}); // string & {} preserves autocomplete for 'all'/'unassigned'

export interface DeviceGroupedEditState {
  editingId: string | null;
  editValue: string;
  editType: string;
  setEditingId: (id: string | null) => void;
  setEditValue: (value: string) => void;
  setEditType: (value: string) => void;
}

export interface DeviceGroupedDeleteState {
  deleteConfirmId: string | null;
  deleteError: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  setDeleteError: (error: string | null) => void;
}

/** Shared class for the "Exclusive" badge shown when a device belongs to only one wallet */
export const EXCLUSIVE_BADGE_CLASS = 'text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20';
