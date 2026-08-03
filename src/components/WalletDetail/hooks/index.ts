/**
 * WalletDetail Custom Hooks
 *
 * Barrel file re-exporting all hooks extracted from WalletDetail.tsx.
 */

export { useWalletData } from './useWalletData';
export { useWalletSync } from './useWalletSync';
export { useWalletSharing } from './useWalletSharing';
export { useAITransactionFilter } from './useAITransactionFilter';
export { useWalletWebSocket } from './useWalletWebSocket';
export { useAddressLabels } from './useAddressLabels';
export { useUtxoActions } from './useUtxoActions';
export { useWalletMutations } from './useWalletMutations';
export { useTransactionFilters } from './useTransactionFilters';

// Re-export types for convenience
export type { UseWalletDataParams, UseWalletDataReturn } from './useWalletData';
export type { UseWalletSyncParams, UseWalletSyncReturn } from './useWalletSync';
export type { UseWalletSharingParams, UseWalletSharingReturn } from './useWalletSharing';
export type { UseAITransactionFilterParams, UseAITransactionFilterReturn } from './useAITransactionFilter';
export type { UseAddressLabelsParams, UseAddressLabelsReturn } from './useAddressLabels';
export type { UseUtxoActionsParams, UseUtxoActionsReturn } from './useUtxoActions';
export type { UseWalletMutationsParams, UseWalletMutationsReturn } from './useWalletMutations';
export type { UseTransactionFiltersParams, UseTransactionFiltersReturn, TransactionFilters, TxTypeFilter, ConfirmationFilter, DatePreset } from './useTransactionFilters';
