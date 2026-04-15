import { describe } from 'vitest';

import { registerWalletDetailWrapperGuardContracts } from './WalletDetailWrapper/WalletDetailWrapper.guards.contracts';
import { registerWalletDetailWrapperInteractionContracts } from './WalletDetailWrapper/WalletDetailWrapper.interactions.contracts';
import { registerWalletDetailWrapperStateContracts } from './WalletDetailWrapper/WalletDetailWrapper.states.contracts';
import { setupWalletDetailWrapperHarness } from './WalletDetailWrapper/WalletDetailWrapperTestHarness';

describe('WalletDetail wrapper behaviors', () => {
  setupWalletDetailWrapperHarness();

  registerWalletDetailWrapperStateContracts();
  registerWalletDetailWrapperInteractionContracts();
  registerWalletDetailWrapperGuardContracts();
});
