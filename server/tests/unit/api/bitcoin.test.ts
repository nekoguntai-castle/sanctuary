/**
 * Bitcoin API Tests
 *
 * Registrar for Bitcoin API route contract modules.
 */

import { beforeAll, beforeEach, describe } from 'vitest';
import { registerBitcoinAddressRouteTests } from './bitcoin/bitcoin.address.contracts';
import { registerBitcoinFeeRouteTests } from './bitcoin/bitcoin.fee.contracts';
import { registerBitcoinNetworkRouteTests } from './bitcoin/bitcoin.network.contracts';
import { registerBitcoinSyncRouteTests } from './bitcoin/bitcoin.sync.contracts';
import { registerBitcoinTransactionRouteTests } from './bitcoin/bitcoin.transaction.contracts';
import { setupBitcoinApiApp, setupBitcoinApiMocks } from './bitcoin/bitcoinTestHarness';

describe('Bitcoin API', () => {
  beforeAll(setupBitcoinApiApp);
  beforeEach(setupBitcoinApiMocks);

  registerBitcoinNetworkRouteTests();
  registerBitcoinFeeRouteTests();
  registerBitcoinAddressRouteTests();
  registerBitcoinTransactionRouteTests();
  registerBitcoinSyncRouteTests();
});
