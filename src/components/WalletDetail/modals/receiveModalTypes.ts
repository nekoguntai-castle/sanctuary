import type { Address } from '../../../types';

export interface ReceiveModalProps {
  walletId: string;
  addresses: Address[];
  onClose: () => void;
  onNavigateToSettings: () => void;
  /** Callback to fetch unused receive addresses when all loaded ones are exhausted. */
  onFetchUnusedAddresses?: (walletId: string) => Promise<Address[]>;
}
