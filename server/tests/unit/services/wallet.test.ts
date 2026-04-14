/**
 * Wallet Service Tests
 *
 * Tests for wallet service functions including:
 * - createWallet with device account selection
 * - Account selection based on wallet type and script type
 */

import { describe } from 'vitest';
import { registerWalletAccessQueryTests } from './wallet/access-queries.contracts';
import { registerWalletAddressDescriptorStatsTests } from './wallet/address-descriptor-stats.contracts';
import { registerWalletCreateAccountSelectionTests } from './wallet/create-account-selection.contracts';
import { registerWalletMutationMaintenanceTests } from './wallet/mutations-maintenance.contracts';
import { setupWalletServiceTestHooks } from './wallet/walletTestHarness';

describe('Wallet Service', () => {
  setupWalletServiceTestHooks();
  registerWalletCreateAccountSelectionTests();
  registerWalletAccessQueryTests();
  registerWalletMutationMaintenanceTests();
  registerWalletAddressDescriptorStatsTests();
});
