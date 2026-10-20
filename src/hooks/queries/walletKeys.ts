import { createQueryKeys } from './factory';

// Base keys from factory, extended with wallet-specific sub-resources
const baseKeys = createQueryKeys('wallets');

// Query key factory for wallet-related queries
// Note: Params are spread into the key array to ensure stable references
export const walletKeys = {
  ...baseKeys,
  utxos: (id: string) => [...baseKeys.all, 'utxos', id] as const,
  addresses: (id: string) => [...baseKeys.all, 'addresses', id] as const,
  transactions: (id: string, params?: { page?: number; limit?: number; offset?: number }) =>
    [...baseKeys.all, 'transactions', id, params?.page, params?.limit, params?.offset] as const,
  balance: (id: string) => [...baseKeys.all, 'balance', id] as const,
};
