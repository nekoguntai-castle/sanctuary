import * as labelsApi from '../../src/api/labels';
import type { Label } from '../../types';
import { createQueryKeys, createDetailQuery } from './factory';

export const walletLabelKeys = createQueryKeys('walletLabels');

/**
 * Hook to fetch all labels for a wallet.
 * Uses React Query for caching and deduplication — multiple components
 * on the same wallet detail page share a single API call.
 */
export const useWalletLabels = createDetailQuery<Label[]>(walletLabelKeys, labelsApi.getLabels);
