import { describe } from 'vitest';

import { registerWalletRepositoryAccessContracts } from './walletRepository/walletRepository.access.contracts';
import { registerWalletRepositoryMutationContracts } from './walletRepository/walletRepository.mutations.contracts';
import { registerWalletRepositoryQueryContracts } from './walletRepository/walletRepository.query.contracts';
import { setupWalletRepositoryTestHarness } from './walletRepository/walletRepositoryTestHarness';

describe('Wallet Repository', () => {
  setupWalletRepositoryTestHarness();

  registerWalletRepositoryAccessContracts();
  registerWalletRepositoryQueryContracts();
  registerWalletRepositoryMutationContracts();
});
