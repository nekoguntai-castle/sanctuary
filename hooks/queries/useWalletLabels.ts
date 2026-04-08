import * as labelsApi from '../../src/api/labels';
import type { Label } from '../../types';
import type { CreateLabelRequest, UpdateLabelRequest } from '../../src/api/labels';
import { createQueryKeys, createDetailQuery, createMutation, createInvalidateAll } from './factory';

export const walletLabelKeys = createQueryKeys('walletLabels');

/**
 * Hook to fetch all labels for a wallet.
 * Uses React Query for caching and deduplication — multiple components
 * on the same wallet detail page share a single API call.
 */
export const useWalletLabels = createDetailQuery<Label[]>(walletLabelKeys, labelsApi.getLabels);

export const useCreateWalletLabel = createMutation(
  ({ walletId, data }: { walletId: string; data: CreateLabelRequest }) =>
    labelsApi.createLabel(walletId, data),
  { invalidateKeys: (vars) => [walletLabelKeys.detail(vars.walletId)] }
);

export const useUpdateWalletLabel = createMutation(
  ({ walletId, labelId, data }: { walletId: string; labelId: string; data: UpdateLabelRequest }) =>
    labelsApi.updateLabel(walletId, labelId, data),
  { invalidateKeys: (vars) => [walletLabelKeys.detail(vars.walletId)] }
);

export const useDeleteWalletLabel = createMutation(
  ({ walletId, labelId }: { walletId: string; labelId: string }) =>
    labelsApi.deleteLabel(walletId, labelId),
  {
    invalidateKeys: (vars) => [walletLabelKeys.detail(vars.walletId)],
    removeKeys: (vars) => [walletLabelKeys.detail(vars.walletId)],
  }
);

export const useInvalidateWalletLabels = createInvalidateAll(walletLabelKeys);
